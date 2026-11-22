import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  DebugLogEntry,
  DemoSpeed,
  Landmark,
  LanguageCode,
  Maneuver,
  PassedStop,
  Question,
  QuizPhase,
  Region,
  RouteData,
  SessionStats,
  SpeechChannel,
} from '../types';
import {
  detectOfferIntent,
  detectVoiceCommand,
  judgeAnswer,
  type VoiceCommand,
} from './answerMatcher';
import { HOST_SCRIPTS } from './i18n';
import {
  BASE_SPEED_MPS,
  collectRouteEvents,
  computeCumulativeRouteDistances,
  createFiredTriggers,
  DEFAULT_NAV_SETTINGS,
  getCurrentRegion,
  getNextLandmark,
  getNextManeuver,
  getNextRegion,
  isInDirectionsFirstZone,
  snapGpsFixToRoute,
  syncTriggersForJump,
  type FiredRouteTriggers,
} from './routeReplay';
import { VoiceClient } from './voiceClient';

interface ActiveQuizContext {
  question: Question;
  clueIndex: number;
  landmark?: Landmark;
  region?: Region;
  alreadyRepeatedAfterInterrupt?: boolean;
}

interface PendingRouteTrigger {
  kind: 'region' | 'landmark_fact';
  region?: Region;
  landmark?: Landmark;
  question?: Question;
}

function nowStamp(): string {
  return new Date().toTimeString().slice(0, 8);
}

export interface CoDriverState {
  language: LanguageCode;
  route: RouteData | null;
  progressM: number;
  isSimPlaying: boolean;
  isSimulatedMode: boolean;
  simSpeed: DemoSpeed;
  phase: QuizPhase;
  activeChannel: SpeechChannel;
  isHostSpeaking: boolean;
  isListening: boolean;
  isDirectionsFirst: boolean;
  nextManeuver: Maneuver | null;
  distanceToNextManeuverM: number | null;
  currentRegionName: string;
  hostCaption: string;
  heardCaption: string;
  lastFeedbackTone: 'neutral' | 'positive';
  activeQuestionType: Question['type'] | null;
  activeClueStep: { current: number; total: number } | null;
  stats: SessionStats;
  debugLogs: DebugLogEntry[];
  isLoading: boolean;
}

export interface CoDriverActions {
  startSession: (language: LanguageCode, route: RouteData | null) => Promise<void>;
  stopSession: () => Promise<void>;
  togglePause: () => void;
  skipCurrent: () => void;
  repeatCurrent: () => void;
  toggleSimPlay: () => void;
  setSimSpeed: (speed: DemoSpeed) => void;
  jumpToNextTurn: () => void;
  jumpToNextLandmark: () => void;
  jumpToNextRegion: () => void;
  submitTypedInput: (text: string) => void;
  triggerOfferNow: () => void;
}

export function useCoDriver(onFinishToSummary: () => void): {
  state: CoDriverState;
  actions: CoDriverActions;
} {
  const [language, setLanguage] = useState<LanguageCode>('en-IN');
  const [route, setRoute] = useState<RouteData | null>(null);
  const [progressM, setProgressM] = useState(0);
  const [isSimPlaying, setIsSimPlaying] = useState(false);
  const [isSimulatedMode, setIsSimulatedMode] = useState(false);
  const [simSpeed, setSimSpeedState] = useState<DemoSpeed>(1);

  const [phase, setPhase] = useState<QuizPhase>('IDLE');
  const [activeChannel, setActiveChannel] = useState<SpeechChannel>('quiz');
  const [isHostSpeaking, setIsHostSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [hostCaption, setHostCaption] = useState('');
  const [heardCaption, setHeardCaption] = useState('');
  const [lastFeedbackTone, setLastFeedbackTone] = useState<'neutral' | 'positive'>('neutral');
  const [activeQuestionType, setActiveQuestionType] = useState<Question['type'] | null>(null);
  const [activeClueStep, setActiveClueStep] = useState<{ current: number; total: number } | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(false);

  const [stats, setStats] = useState<SessionStats>({
    questionsAsked: 0,
    correctCount: 0,
    landmarksPassed: [],
    regionsPassed: [],
  });
  const [debugLogs, setDebugLogs] = useState<DebugLogEntry[]>([]);

  const voiceRef = useRef<VoiceClient | null>(null);
  if (!voiceRef.current) {
    voiceRef.current = new VoiceClient();
  }

  const sessionTokenRef = useRef(0);
  const quizTokenRef = useRef(0);
  const languageRef = useRef<LanguageCode>('en-IN');
  const routeRef = useRef<RouteData | null>(null);
  const cumDistancesRef = useRef<number[]>([]);
  const progressMRef = useRef(0);
  const simSpeedRef = useRef<DemoSpeed>(1);
  const isSimPlayingRef = useRef(false);
  const gpsIgnoredByDemoRef = useRef(false);
  const isPausedRef = useRef(false);
  const isNavSpeakingRef = useRef(false);
  const phaseRef = useRef<QuizPhase>('IDLE');

  const allQuestionsRef = useRef<Question[]>([]);
  const triviaPoolRef = useRef<Question[]>([]);
  const triviaIndexRef = useRef(0);
  const activeQuizRef = useRef<ActiveQuizContext | null>(null);
  const interruptedQuizRef = useRef<ActiveQuizContext | null>(null);
  const pendingTriggersRef = useRef<PendingRouteTrigger[]>([]);
  const firedTriggersRef = useRef<FiredRouteTriggers>(createFiredTriggers());
  const nextOfferTimerRef = useRef<number | null>(null);
  const wasInDirectionsZoneRef = useRef(false);
  const navQueueRef = useRef<string[]>([]);
  const statsRef = useRef<SessionStats>({
    questionsAsked: 0,
    correctCount: 0,
    landmarksPassed: [],
    regionsPassed: [],
  });

  const setPhaseSafe = useCallback((next: QuizPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const pushLog = useCallback(
    (entry: Omit<DebugLogEntry, 'id' | 'timestamp' | 'distanceM'>) => {
      const full: DebugLogEntry = {
        ...entry,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: nowStamp(),
        distanceM: Math.round(progressMRef.current),
      };
      setDebugLogs((prev) => [full, ...prev].slice(0, 80));
    },
    []
  );

  const clearOfferTimer = useCallback(() => {
    if (nextOfferTimerRef.current !== null) {
      window.clearTimeout(nextOfferTimerRef.current);
      nextOfferTimerRef.current = null;
    }
  }, []);

  const findQuestionByKey = useCallback((key: string): Question | undefined => {
    return allQuestionsRef.current.find((q) => q.id === key || q.group_id === key);
  }, []);

  const recordLandmarkStop = useCallback(
    (landmark: Landmark, asked: boolean, answeredCorrectly: boolean) => {
      const lang = languageRef.current;
      const name = landmark.name[lang] || landmark.name['en-IN'];
      setStats((prev) => {
        const exists = prev.landmarksPassed.find((l) => l.id === landmark.id);
        let nextList: PassedStop[];
        if (exists) {
          nextList = prev.landmarksPassed.map((l) =>
            l.id === landmark.id
              ? {
                  ...l,
                  asked: l.asked || asked,
                  answeredCorrectly: l.answeredCorrectly || answeredCorrectly,
                }
              : l
          );
        } else {
          nextList = [...prev.landmarksPassed, { id: landmark.id, name, asked, answeredCorrectly }];
        }
        const updated = { ...prev, landmarksPassed: nextList };
        statsRef.current = updated;
        return updated;
      });
    },
    []
  );

  const recordRegionStop = useCallback(
    (region: Region, asked: boolean, answeredCorrectly: boolean) => {
      const lang = languageRef.current;
      const name = region.name[lang] || region.name['en-IN'];
      setStats((prev) => {
        const exists = prev.regionsPassed.find((r) => r.id === region.id);
        let nextList: PassedStop[];
        if (exists) {
          nextList = prev.regionsPassed.map((r) =>
            r.id === region.id
              ? {
                  ...r,
                  asked: r.asked || asked,
                  answeredCorrectly: r.answeredCorrectly || answeredCorrectly,
                }
              : r
          );
        } else {
          nextList = [...prev.regionsPassed, { id: region.id, name, asked, answeredCorrectly }];
        }
        const updated = { ...prev, regionsPassed: nextList };
        statsRef.current = updated;
        return updated;
      });
    },
    []
  );

  const scheduleNextOfferRef = useRef<(delayMs?: number) => void>(() => {});
  const runOfferRoundRef = useRef<() => Promise<void>>(async () => {});
  const runQuestionRoundRef = useRef<(ctx: ActiveQuizContext, customLead?: string) => Promise<void>>(
    async () => {}
  );
  const processDeferredAfterZoneRef = useRef<() => void>(() => {});
  const handleUserInputRef = useRef<(rawText: string | null) => Promise<void>>(async () => {});
  const stopSessionRef = useRef<() => Promise<void>>(async () => {});

  const speakQuiz = useCallback(
    async (text: string, token: number): Promise<boolean> => {
      const activeZone = isInDirectionsFirstZone(
        routeRef.current,
        progressMRef.current,
        DEFAULT_NAV_SETTINGS
      );
      if (activeZone || isNavSpeakingRef.current) {
        pushLog({
          kind: 'speech',
          decision: 'held',
          channel: 'quiz',
          summary: 'Held quiz speech (directions-first zone)',
          detail: text,
        });
        return false;
      }

      if (token !== quizTokenRef.current || isPausedRef.current) {
        return false;
      }

      setActiveChannel('quiz');
      setHostCaption(text);
      setIsHostSpeaking(true);
      setIsListening(false);
      pushLog({
        kind: 'speech',
        decision: 'played',
        channel: 'quiz',
        summary: 'Played quiz speech',
        detail: text,
      });

      const finished = await voiceRef.current!.speak(text, languageRef.current, 'quiz');
      if (token === quizTokenRef.current && !isNavSpeakingRef.current) {
        setIsHostSpeaking(false);
      }
      return finished && token === quizTokenRef.current && !isNavSpeakingRef.current;
    },
    [pushLog]
  );

  const enqueueDirectionsSpeech = useCallback(
    async (text: string) => {
      const sessionToken = sessionTokenRef.current;

      if (
        phaseRef.current === 'ASK' ||
        phaseRef.current === 'LISTEN' ||
        phaseRef.current === 'OFFER' ||
        phaseRef.current === 'FEEDBACK'
      ) {
        quizTokenRef.current += 1;
        voiceRef.current?.stopListening();
        setIsListening(false);

        if (activeQuizRef.current && (phaseRef.current === 'ASK' || phaseRef.current === 'LISTEN')) {
          if (!activeQuizRef.current.alreadyRepeatedAfterInterrupt) {
            interruptedQuizRef.current = {
              ...activeQuizRef.current,
              alreadyRepeatedAfterInterrupt: true,
            };
            pushLog({
              kind: 'speech',
              decision: 'interrupted',
              channel: 'directions',
              summary: 'Interrupted active quiz; saved for brief repeat after zone',
              detail: activeQuizRef.current.question.prompt,
            });
          } else {
            pushLog({
              kind: 'speech',
              decision: 'dropped',
              channel: 'quiz',
              summary: 'Dropped already-repeated quiz on second interruption',
            });
          }
          activeQuizRef.current = null;
          setActiveQuestionType(null);
          setActiveClueStep(null);
        } else if (phaseRef.current === 'OFFER') {
          pushLog({
            kind: 'speech',
            decision: 'interrupted',
            channel: 'directions',
            summary: 'Interrupted quiz offer for turn-by-turn direction',
          });
        }

        if (!isPausedRef.current) {
          setPhaseSafe('IDLE');
        }
      }

      navQueueRef.current.push(text);
      if (isNavSpeakingRef.current) return;

      isNavSpeakingRef.current = true;
      voiceRef.current?.cancelSpeech();

      while (navQueueRef.current.length > 0 && sessionToken === sessionTokenRef.current) {
        const nextLine = navQueueRef.current.shift()!;
        setActiveChannel('directions');
        setHostCaption(nextLine);
        setIsHostSpeaking(true);
        setIsListening(false);
        pushLog({
          kind: 'speech',
          decision: 'played',
          channel: 'directions',
          summary: 'Played navigation instruction',
          detail: nextLine,
        });

        await voiceRef.current!.speak(nextLine, languageRef.current, 'directions');
      }

      isNavSpeakingRef.current = false;
      if (sessionToken !== sessionTokenRef.current) return;

      setIsHostSpeaking(false);
      setActiveChannel('quiz');

      if (!isInDirectionsFirstZone(routeRef.current, progressMRef.current, DEFAULT_NAV_SETTINGS)) {
        processDeferredAfterZoneRef.current();
      }
    },
    [pushLog, setPhaseSafe]
  );

  const openMicForCurrentPhase = useCallback((token: number) => {
    if (token !== quizTokenRef.current || isPausedRef.current || isNavSpeakingRef.current) {
      return;
    }
    setIsListening(true);
    setHeardCaption('');
    voiceRef.current?.startListening({
      language: languageRef.current,
      silenceMs: 8000,
      onInterim: (interim) => {
        if (token === quizTokenRef.current) {
          setHeardCaption(interim);
        }
      },
      onFinal: (finalTranscript) => {
        if (token !== quizTokenRef.current) return;
        setIsListening(false);
        handleUserInputRef.current(finalTranscript);
      },
    });
  }, []);

  const runQuestionRound = useCallback(
    async (ctx: ActiveQuizContext, customLead?: string) => {
      clearOfferTimer();

      const activeZone = isInDirectionsFirstZone(
        routeRef.current,
        progressMRef.current,
        DEFAULT_NAV_SETTINGS
      );
      if (activeZone || isNavSpeakingRef.current) {
        pushLog({
          kind: 'speech',
          decision: 'held',
          channel: 'quiz',
          summary: `Held ${ctx.question.type} question during directions-first zone`,
        });
        return;
      }

      const token = ++quizTokenRef.current;
      activeQuizRef.current = ctx;
      setActiveQuestionType(ctx.question.type);
      setLastFeedbackTone('neutral');
      setHeardCaption('');

      const totalClues = 1 + (ctx.question.clues?.length ?? 0);
      if (ctx.question.type === 'landmark' && totalClues > 1) {
        setActiveClueStep({ current: ctx.clueIndex + 1, total: totalClues });
      } else {
        setActiveClueStep(null);
      }

      if (
        ctx.clueIndex === 0 &&
        !ctx.alreadyRepeatedAfterInterrupt &&
        !customLead?.includes('Back')
      ) {
        setStats((prev) => {
          const updated = { ...prev, questionsAsked: prev.questionsAsked + 1 };
          statsRef.current = updated;
          return updated;
        });
      }

      setPhaseSafe('ASK');

      const promptText =
        ctx.clueIndex === 0
          ? ctx.question.prompt
          : ctx.question.clues[ctx.clueIndex - 1] ?? ctx.question.prompt;

      const spokenText = customLead ? `${customLead} ${promptText}` : promptText;
      const ok = await speakQuiz(spokenText, token);
      if (!ok || token !== quizTokenRef.current || isPausedRef.current) return;

      setPhaseSafe('LISTEN');
      openMicForCurrentPhase(token);
    },
    [clearOfferTimer, openMicForCurrentPhase, pushLog, setPhaseSafe, speakQuiz]
  );

  runQuestionRoundRef.current = runQuestionRound;

  const pickNextTrivia = useCallback((): Question | null => {
    const pool = triviaPoolRef.current;
    if (pool.length === 0) return null;
    const q = pool[triviaIndexRef.current % pool.length];
    triviaIndexRef.current += 1;
    return q;
  }, []);

  const runOfferRound = useCallback(async () => {
    clearOfferTimer();
    if (isPausedRef.current || isNavSpeakingRef.current || activeQuizRef.current) return;

    const activeZone = isInDirectionsFirstZone(
      routeRef.current,
      progressMRef.current,
      DEFAULT_NAV_SETTINGS
    );
    if (activeZone) {
      pushLog({
        kind: 'speech',
        decision: 'held',
        channel: 'quiz',
        summary: 'Held quiz offer (directions-first zone)',
      });
      return;
    }

    const scripts = HOST_SCRIPTS[languageRef.current];
    const token = ++quizTokenRef.current;
    setPhaseSafe('OFFER');
    setActiveQuestionType('trivia');
    setActiveClueStep(null);
    setLastFeedbackTone('neutral');
    setHeardCaption('');

    const ok = await speakQuiz(scripts.offer, token);
    if (!ok || token !== quizTokenRef.current || isPausedRef.current) return;

    openMicForCurrentPhase(token);
  }, [clearOfferTimer, openMicForCurrentPhase, pushLog, setPhaseSafe, speakQuiz]);

  runOfferRoundRef.current = runOfferRound;

  const scheduleNextOffer = useCallback(
    (delayMs = 5500) => {
      clearOfferTimer();
      const sessionToken = sessionTokenRef.current;
      nextOfferTimerRef.current = window.setTimeout(() => {
        if (
          sessionToken !== sessionTokenRef.current ||
          isPausedRef.current ||
          isNavSpeakingRef.current ||
          activeQuizRef.current ||
          phaseRef.current !== 'IDLE'
        ) {
          return;
        }
        if (isInDirectionsFirstZone(routeRef.current, progressMRef.current, DEFAULT_NAV_SETTINGS)) {
          pushLog({
            kind: 'speech',
            decision: 'held',
            channel: 'quiz',
            summary: 'Deferred scheduled trivia offer (directions-first zone)',
          });
          return;
        }
        runOfferRoundRef.current();
      }, delayMs);
    },
    [clearOfferTimer, pushLog]
  );

  scheduleNextOfferRef.current = scheduleNextOffer;

  const runRegionWelcome = useCallback(
    async (region: Region) => {
      const lang = languageRef.current;
      const question = findQuestionByKey(region.question_id);
      if (!question) return;

      const welcome = region.welcome[lang] || region.welcome['en-IN'];
      const greeting = region.greeting[lang] || region.greeting['en-IN'];
      const welcomePrefix = `${welcome} ${greeting}`;

      recordRegionStop(region, true, false);
      await runQuestionRoundRef.current(
        {
          question,
          clueIndex: 0,
          region,
        },
        welcomePrefix
      );
    },
    [findQuestionByKey, recordRegionStop]
  );

  const processDeferredAfterZone = useCallback(() => {
    if (isPausedRef.current || isNavSpeakingRef.current || activeQuizRef.current) return;
    if (isInDirectionsFirstZone(routeRef.current, progressMRef.current, DEFAULT_NAV_SETTINGS)) {
      return;
    }

    const scripts = HOST_SCRIPTS[languageRef.current];

    if (interruptedQuizRef.current) {
      const saved = interruptedQuizRef.current;
      interruptedQuizRef.current = null;
      const promptText =
        saved.clueIndex === 0
          ? saved.question.prompt
          : saved.question.clues[saved.clueIndex - 1] ?? saved.question.prompt;
      void runQuestionRoundRef.current(
        saved,
        scripts.backToQuestion('').replace(/:\s*$/, ':').trim()
      );
      pushLog({
        kind: 'event',
        summary: 'Resumed interrupted quiz after directions-first zone',
        detail: promptText,
      });
      return;
    }

    if (pendingTriggersRef.current.length > 0) {
      const nextPending = pendingTriggersRef.current.shift()!;
      if (nextPending.kind === 'region' && nextPending.region) {
        pushLog({
          kind: 'event',
          summary: `Playing deferred region welcome: ${nextPending.region.name[languageRef.current]}`,
        });
        void runRegionWelcome(nextPending.region);
        return;
      }
      if (nextPending.kind === 'landmark_fact' && nextPending.landmark && nextPending.question) {
        const token = ++quizTokenRef.current;
        const lmName = nextPending.landmark.name[languageRef.current];
        const line = scripts.landmarkFunFactOnly(lmName, nextPending.question.fun_fact);
        setPhaseSafe('FEEDBACK');
        void speakQuiz(line, token).then((done) => {
          if (done && token === quizTokenRef.current) {
            setPhaseSafe('IDLE');
            scheduleNextOfferRef.current(4500);
          }
        });
        return;
      }
    }

    if (phaseRef.current === 'IDLE') {
      scheduleNextOfferRef.current(4500);
    }
  }, [pushLog, runRegionWelcome, setPhaseSafe, speakQuiz]);

  processDeferredAfterZoneRef.current = processDeferredAfterZone;

  const executeVoiceCommand = useCallback(
    async (cmd: Exclude<VoiceCommand, null>) => {
      const scripts = HOST_SCRIPTS[languageRef.current];

      if (cmd === 'stop') {
        await stopSessionRef.current();
        return;
      }

      if (cmd === 'pause') {
        if (isPausedRef.current) return;
        isPausedRef.current = true;
        clearOfferTimer();
        quizTokenRef.current += 1;
        voiceRef.current?.stopListening();
        voiceRef.current?.cancelSpeech();
        setIsListening(false);
        setIsHostSpeaking(false);
        setPhaseSafe('PAUSED');
        setHostCaption(scripts.pausedReply);
        pushLog({ kind: 'event', summary: 'Quiz paused' });
        return;
      }

      if (cmd === 'resume') {
        if (!isPausedRef.current) return;
        isPausedRef.current = false;
        setPhaseSafe('IDLE');
        const token = ++quizTokenRef.current;
        pushLog({ kind: 'event', summary: 'Quiz resumed' });
        await speakQuiz(scripts.resumedReply, token);
        if (token !== quizTokenRef.current) return;

        if (activeQuizRef.current) {
          const current = activeQuizRef.current;
          void runQuestionRoundRef.current(current);
        } else {
          processDeferredAfterZoneRef.current();
        }
        return;
      }

      if (cmd === 'repeat') {
        if (isPausedRef.current) return;
        if (activeQuizRef.current) {
          const current = activeQuizRef.current;
          pushLog({ kind: 'event', summary: 'Repeating current question' });
          void runQuestionRoundRef.current(current);
        } else if (phaseRef.current === 'OFFER') {
          void runOfferRoundRef.current();
        }
        return;
      }

      if (cmd === 'skip') {
        if (isPausedRef.current) return;
        clearOfferTimer();
        const token = ++quizTokenRef.current;
        voiceRef.current?.stopListening();
        voiceRef.current?.cancelSpeech();
        setIsListening(false);
        activeQuizRef.current = null;
        setActiveQuestionType(null);
        setActiveClueStep(null);
        setPhaseSafe('FEEDBACK');
        pushLog({ kind: 'event', summary: 'Skipped current round' });

        await speakQuiz(scripts.skipReply, token);
        if (token !== quizTokenRef.current || isPausedRef.current) return;

        setPhaseSafe('IDLE');
        scheduleNextOfferRef.current(3500);
      }
    },
    [clearOfferTimer, pushLog, setPhaseSafe, speakQuiz]
  );

  const handleUserInput = useCallback(
    async (rawText: string | null) => {
      if (isPausedRef.current || isNavSpeakingRef.current) return;
      const scripts = HOST_SCRIPTS[languageRef.current];
      const currentPhase = phaseRef.current;

      if (rawText) {
        setHeardCaption(rawText);
      }

      if (rawText) {
        const cmd = detectVoiceCommand(rawText);
        if (cmd) {
          pushLog({
            kind: 'transcript',
            summary: `Command detected: "${cmd}"`,
            detail: rawText,
          });
          await executeVoiceCommand(cmd);
          return;
        }
      }

      if (currentPhase === 'OFFER') {
        const intent = rawText ? detectOfferIntent(rawText) : null;
        pushLog({
          kind: 'transcript',
          summary: rawText ? `Offer reply -> ${intent ?? 'unclear'}` : 'Offer silence (8s) -> going quiet',
          detail: rawText ?? undefined,
        });

        if (intent === 'yes') {
          const nextQ = pickNextTrivia();
          if (nextQ) {
            await runQuestionRoundRef.current({ question: nextQ, clueIndex: 0 });
          } else {
            setPhaseSafe('IDLE');
          }
        } else {
          const token = ++quizTokenRef.current;
          setPhaseSafe('IDLE');
          setActiveQuestionType(null);
          if (rawText) {
            await speakQuiz(scripts.offerQuiet, token);
          } else {
            setHostCaption(scripts.offerQuiet);
          }
          scheduleNextOfferRef.current(12000);
        }
        return;
      }

      if (currentPhase === 'LISTEN' && activeQuizRef.current) {
        const ctx = activeQuizRef.current;
        const token = ++quizTokenRef.current;
        setPhaseSafe('JUDGE');

        const match = rawText ? judgeAnswer(rawText, ctx.question.answers) : null;

        pushLog({
          kind: 'transcript',
          summary: rawText
            ? match?.matched
              ? `Match (${match.strategy}) -> ${match.matchedAnswer}`
              : `No match for "${rawText}"`
            : 'No answer (8s silence)',
          detail: rawText ?? undefined,
        });

        if (match?.matched) {
          setLastFeedbackTone('positive');
          setStats((prev) => {
            const updated = { ...prev, correctCount: prev.correctCount + 1 };
            statsRef.current = updated;
            return updated;
          });
          if (ctx.landmark) {
            recordLandmarkStop(ctx.landmark, true, true);
          }
          if (ctx.region) {
            recordRegionStop(ctx.region, true, true);
          }

          activeQuizRef.current = null;
          setActiveClueStep(null);
          setPhaseSafe('FEEDBACK');

          const reply = scripts.correctReply(ctx.question.display_answer, ctx.question.fun_fact);
          const finished = await speakQuiz(reply, token);
          if (!finished || token !== quizTokenRef.current || isPausedRef.current) return;

          setPhaseSafe('IDLE');
          setActiveQuestionType(null);
          processDeferredAfterZoneRef.current();
          return;
        }

        if (
          ctx.question.type === 'landmark' &&
          ctx.question.clues &&
          ctx.clueIndex < ctx.question.clues.length
        ) {
          const nextCtx: ActiveQuizContext = {
            ...ctx,
            clueIndex: ctx.clueIndex + 1,
          };
          pushLog({
            kind: 'event',
            summary: `Advancing landmark clue ${nextCtx.clueIndex + 1} of ${1 + ctx.question.clues.length}`,
          });
          await runQuestionRoundRef.current(nextCtx, scripts.nextClueLead);
          return;
        }

        activeQuizRef.current = null;
        setActiveClueStep(null);
        setPhaseSafe('FEEDBACK');
        setLastFeedbackTone('neutral');

        const reply = rawText
          ? scripts.missReply(ctx.question.display_answer, ctx.question.fun_fact)
          : scripts.silenceReply(ctx.question.display_answer, ctx.question.fun_fact);

        const finished = await speakQuiz(reply, token);
        if (!finished || token !== quizTokenRef.current || isPausedRef.current) return;

        setPhaseSafe('IDLE');
        setActiveQuestionType(null);
        processDeferredAfterZoneRef.current();
      }
    },
    [
      executeVoiceCommand,
      pickNextTrivia,
      pushLog,
      recordLandmarkStop,
      recordRegionStop,
      setPhaseSafe,
      speakQuiz,
    ]
  );

  handleUserInputRef.current = handleUserInput;

  const triggerLandmarkQuiz = useCallback(
    (landmark: Landmark) => {
      const lang = languageRef.current;
      const question = findQuestionByKey(landmark.question_id);
      if (!question) return;

      const activeZone = isInDirectionsFirstZone(
        routeRef.current,
        progressMRef.current,
        DEFAULT_NAV_SETTINGS
      );

      if (activeZone || isNavSpeakingRef.current) {
        recordLandmarkStop(landmark, false, false);
        pendingTriggersRef.current.push({
          kind: 'landmark_fact',
          landmark,
          question,
        });
        pushLog({
          kind: 'speech',
          decision: 'dropped',
          channel: 'quiz',
          summary: `Dropped landmark quiz (${landmark.name[lang]}) in directions-first zone -> queued fun fact`,
        });
        return;
      }

      if (activeQuizRef.current) {
        recordLandmarkStop(landmark, false, false);
        pushLog({
          kind: 'speech',
          decision: 'dropped',
          channel: 'quiz',
          summary: `Dropped landmark quiz (${landmark.name[lang]}): another question is active`,
        });
        return;
      }

      recordLandmarkStop(landmark, true, false);
      pushLog({
        kind: 'event',
        summary: `Landmark quiz triggered: ${landmark.name[lang]}`,
      });
      void runQuestionRoundRef.current({
        question,
        clueIndex: 0,
        landmark,
      });
    },
    [findQuestionByKey, pushLog, recordLandmarkStop]
  );

  const triggerRegionWelcome = useCallback(
    (region: Region) => {
      const lang = languageRef.current;
      const activeZone = isInDirectionsFirstZone(
        routeRef.current,
        progressMRef.current,
        DEFAULT_NAV_SETTINGS
      );

      if (activeZone || isNavSpeakingRef.current || activeQuizRef.current) {
        pendingTriggersRef.current.push({
          kind: 'region',
          region,
        });
        pushLog({
          kind: 'speech',
          decision: 'held',
          channel: 'quiz',
          summary: `Held region welcome (${region.name[lang]}) until zone/round clears`,
        });
        return;
      }

      pushLog({
        kind: 'event',
        summary: `Region entered: ${region.name[lang]}`,
      });
      void runRegionWelcome(region);
    },
    [pushLog, runRegionWelcome]
  );

  // Unified progress processor shared by both real GPS watchPosition and Demo Panel replay
  const advancePositionTo = useCallback(
    (nextProgress: number) => {
      const currentRoute = routeRef.current;
      if (!currentRoute) return;

      const clamped = Math.max(0, Math.min(currentRoute.length_m, nextProgress));
      progressMRef.current = clamped;
      setProgressM(clamped);

      const inZoneNow = Boolean(
        isInDirectionsFirstZone(currentRoute, clamped, DEFAULT_NAV_SETTINGS)
      );
      if (wasInDirectionsZoneRef.current && !inZoneNow) {
        pushLog({ kind: 'event', summary: 'Exited directions-first zone' });
        processDeferredAfterZoneRef.current();
      }
      wasInDirectionsZoneRef.current = inZoneNow;

      const events = collectRouteEvents(
        currentRoute,
        clamped,
        firedTriggersRef.current,
        DEFAULT_NAV_SETTINGS
      );

      const lang = languageRef.current;
      const scripts = HOST_SCRIPTS[lang];

      // Spec 5.1: Pre-cache maneuver audio ~3 km before the maneuver
      for (const m of events.maneuversToPrefetch) {
        const baseText = m.text[lang] || m.text['en-IN'];
        const earlyText = m.text_early?.[lang] || scripts.nav800(baseText);
        void voiceRef.current?.prefetch(earlyText, lang, 'directions');
        void voiceRef.current?.prefetch(scripts.nav100(baseText), lang, 'directions');
      }

      for (const m of events.maneuvers800) {
        const baseText = m.text[lang] || m.text['en-IN'];
        const line = m.text_early?.[lang] || scripts.nav800(baseText);
        void enqueueDirectionsSpeech(line);
      }

      for (const m of events.maneuvers100) {
        const baseText = m.text[lang] || m.text['en-IN'];
        void enqueueDirectionsSpeech(scripts.nav100(baseText));
      }

      for (const r of events.regionsEntered) {
        triggerRegionWelcome(r);
      }

      for (const lm of events.landmarksDue) {
        triggerLandmarkQuiz(lm);
      }

      for (const lm of events.landmarksPassed) {
        recordLandmarkStop(lm, false, false);
      }

      if (events.completed) {
        isSimPlayingRef.current = false;
        setIsSimPlaying(false);
        void stopSessionRef.current();
      }
    },
    [
      enqueueDirectionsSpeech,
      pushLog,
      recordLandmarkStop,
      triggerLandmarkQuiz,
      triggerRegionWelcome,
    ]
  );

  // Real GPS watchPosition while driving (automatically ignored once Demo Panel replay/jump is used)
  useEffect(() => {
    if (!route || isSimulatedMode) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (gpsIgnoredByDemoRef.current || !routeRef.current) return;
        const snapped = snapGpsFixToRoute(
          routeRef.current,
          cumDistancesRef.current,
          progressMRef.current,
          pos.coords.latitude,
          pos.coords.longitude,
          DEFAULT_NAV_SETTINGS
        );

        if (!snapped) {
          pushLog({
            kind: 'gps',
            summary: 'GPS fix ignored (> 100 m off route)',
          });
          return;
        }

        if (snapped.snappedProgressM > progressMRef.current + 3) {
          advancePositionTo(snapped.snappedProgressM);
        }
      },
      () => {
        // Silent in drive view; Demo Panel replay works seamlessly at a desk
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [advancePositionTo, isSimulatedMode, pushLog, route]);

  // Demo Panel simulated car replay loop (10 Hz)
  useEffect(() => {
    if (!isSimPlaying || !route) return;
    let lastTs = performance.now();

    const intervalId = window.setInterval(() => {
      const now = performance.now();
      const dtSec = Math.min(0.25, (now - lastTs) / 1000);
      lastTs = now;

      if (!routeRef.current || !isSimPlayingRef.current) return;
      const deltaM = BASE_SPEED_MPS * simSpeedRef.current * dtSec;
      advancePositionTo(progressMRef.current + deltaM);
    }, 100);

    return () => window.clearInterval(intervalId);
  }, [advancePositionTo, isSimPlaying, route]);

  const startSession = useCallback(
    async (selectedLang: LanguageCode, selectedRoute: RouteData | null) => {
      setIsLoading(true);
      const token = ++sessionTokenRef.current;
      quizTokenRef.current += 1;
      clearOfferTimer();
      voiceRef.current?.stopListening();
      voiceRef.current?.cancelSpeech();

      languageRef.current = selectedLang;
      routeRef.current = selectedRoute;
      cumDistancesRef.current = selectedRoute ? computeCumulativeRouteDistances(selectedRoute) : [];
      progressMRef.current = 0;
      isSimPlayingRef.current = false;
      gpsIgnoredByDemoRef.current = false;
      isPausedRef.current = false;
      isNavSpeakingRef.current = false;
      activeQuizRef.current = null;
      interruptedQuizRef.current = null;
      pendingTriggersRef.current = [];
      firedTriggersRef.current = createFiredTriggers();
      wasInDirectionsZoneRef.current = false;
      navQueueRef.current = [];
      triviaIndexRef.current = 0;

      const freshStats: SessionStats = {
        questionsAsked: 0,
        correctCount: 0,
        landmarksPassed: [],
        regionsPassed: [],
      };
      statsRef.current = freshStats;

      setLanguage(selectedLang);
      setRoute(selectedRoute);
      setProgressM(0);
      setIsSimPlaying(false);
      setIsSimulatedMode(false);
      setStats(freshStats);
      setDebugLogs([]);
      setHeardCaption('');
      setHostCaption('');
      setActiveQuestionType(null);
      setActiveClueStep(null);
      setLastFeedbackTone('neutral');
      setActiveChannel('quiz');
      setPhaseSafe('IDLE');

      try {
        const res = await fetch(`/api/questions?language=${encodeURIComponent(selectedLang)}`);
        if (!res.ok) throw new Error('Failed to load questions');
        const data = (await res.json()) as { questions: Question[] };
        if (token !== sessionTokenRef.current) return;

        allQuestionsRef.current = data.questions;
        triviaPoolRef.current = data.questions.filter((q) => q.type === 'trivia');
      } catch (err) {
        console.error('Error loading questions:', err);
        allQuestionsRef.current = [];
        triviaPoolRef.current = [];
      } finally {
        setIsLoading(false);
      }

      if (token !== sessionTokenRef.current) return;

      const scripts = HOST_SCRIPTS[selectedLang];
      void voiceRef.current?.prefetch(scripts.offer, selectedLang, 'quiz');

      // Prefetch maneuvers already within 3 km of the start
      if (selectedRoute) {
        for (const m of selectedRoute.maneuvers) {
          if (m.at_m <= DEFAULT_NAV_SETTINGS.prefetchAheadM) {
            firedTriggersRef.current.maneuverPrefetched.add(m.id);
            const baseText = m.text[selectedLang] || m.text['en-IN'];
            const earlyText = m.text_early?.[selectedLang] || scripts.nav800(baseText);
            void voiceRef.current?.prefetch(earlyText, selectedLang, 'directions');
            void voiceRef.current?.prefetch(scripts.nav100(baseText), selectedLang, 'directions');
          }
        }
      }

      const qToken = ++quizTokenRef.current;
      const routeName = selectedRoute
        ? selectedRoute.name[selectedLang] || selectedRoute.name['en-IN']
        : undefined;
      const greetingText = scripts.greeting(Boolean(selectedRoute), routeName);
      pushLog({
        kind: 'event',
        summary: selectedRoute
          ? `Drive started (${selectedLang}) · ${selectedRoute.maneuvers.length} steps · ${selectedRoute.landmarks.length} landmarks · ${selectedRoute.regions.length} regions`
          : `Quiz-only session started (${selectedLang})`,
      });

      const ok = await speakQuiz(greetingText, qToken);
      if (!ok || token !== sessionTokenRef.current || isPausedRef.current) return;

      await runOfferRoundRef.current();
    },
    [clearOfferTimer, pushLog, setPhaseSafe, speakQuiz]
  );

  const stopSession = useCallback(async () => {
    clearOfferTimer();
    sessionTokenRef.current += 1;
    quizTokenRef.current += 1;
    isSimPlayingRef.current = false;
    isPausedRef.current = false;
    isNavSpeakingRef.current = false;
    navQueueRef.current = [];
    activeQuizRef.current = null;
    interruptedQuizRef.current = null;

    setIsSimPlaying(false);
    setIsListening(false);
    setIsHostSpeaking(false);
    setPhaseSafe('IDLE');
    voiceRef.current?.stopListening();
    voiceRef.current?.cancelSpeech();

    onFinishToSummary();

    const scripts = HOST_SCRIPTS[languageRef.current];
    const { correctCount, questionsAsked } = statsRef.current;
    const goodbyeLine = scripts.goodbye(correctCount, questionsAsked);
    setHostCaption(goodbyeLine);
    void voiceRef.current?.speak(goodbyeLine, languageRef.current, 'quiz');
  }, [clearOfferTimer, onFinishToSummary, setPhaseSafe]);

  stopSessionRef.current = stopSession;

  const togglePause = useCallback(() => {
    void executeVoiceCommand(isPausedRef.current ? 'resume' : 'pause');
  }, [executeVoiceCommand]);

  const skipCurrent = useCallback(() => {
    void executeVoiceCommand('skip');
  }, [executeVoiceCommand]);

  const repeatCurrent = useCallback(() => {
    void executeVoiceCommand('repeat');
  }, [executeVoiceCommand]);

  const engageDemoSimulation = useCallback(() => {
    if (!gpsIgnoredByDemoRef.current) {
      gpsIgnoredByDemoRef.current = true;
      setIsSimulatedMode(true);
      pushLog({
        kind: 'gps',
        summary: 'Switched to Demo Panel replay (live GPS updates ignored for rest of trip)',
      });
    }
  }, [pushLog]);

  const toggleSimPlay = useCallback(() => {
    if (!routeRef.current) return;
    engageDemoSimulation();
    const next = !isSimPlayingRef.current;
    isSimPlayingRef.current = next;
    setIsSimPlaying(next);
    pushLog({ kind: 'event', summary: next ? 'Car replay started' : 'Car replay paused' });
  }, [engageDemoSimulation, pushLog]);

  const setSimSpeed = useCallback(
    (speed: DemoSpeed) => {
      simSpeedRef.current = speed;
      setSimSpeedState(speed);
      pushLog({ kind: 'event', summary: `Replay speed set to ${speed}x` });
    },
    [pushLog]
  );

  const jumpToDistance = useCallback(
    (targetM: number, label: string) => {
      const currentRoute = routeRef.current;
      if (!currentRoute) return;
      engageDemoSimulation();

      const clamped = Math.max(0, Math.min(currentRoute.length_m - 100, targetM));
      progressMRef.current = clamped;
      setProgressM(clamped);
      syncTriggersForJump(currentRoute, clamped, firedTriggersRef.current, DEFAULT_NAV_SETTINGS);
      wasInDirectionsZoneRef.current = Boolean(
        isInDirectionsFirstZone(currentRoute, clamped, DEFAULT_NAV_SETTINGS)
      );

      if (!isSimPlayingRef.current) {
        isSimPlayingRef.current = true;
        setIsSimPlaying(true);
      }

      pushLog({
        kind: 'event',
        summary: `Jumped to ${label} (${Math.round(clamped)} m)`,
      });
    },
    [engageDemoSimulation, pushLog]
  );

  const jumpToNextTurn = useCallback(() => {
    const currentRoute = routeRef.current;
    if (!currentRoute || currentRoute.maneuvers.length === 0) return;
    const nextM =
      currentRoute.maneuvers.find((m) => m.at_m > progressMRef.current + 950) ??
      currentRoute.maneuvers[0];
    if (!nextM) return;
    jumpToDistance(Math.max(0, nextM.at_m - 1020), `next turn (${nextM.icon})`);
  }, [jumpToDistance]);

  const jumpToNextLandmark = useCallback(() => {
    const currentRoute = routeRef.current;
    if (!currentRoute || currentRoute.landmarks.length === 0) return;
    const nextLm =
      getNextLandmark(currentRoute, progressMRef.current + 2050) ??
      getNextLandmark(currentRoute, progressMRef.current) ??
      currentRoute.landmarks[0];
    if (!nextLm) return;

    if (phaseRef.current === 'OFFER' || activeQuizRef.current?.question.type === 'trivia') {
      quizTokenRef.current += 1;
      voiceRef.current?.stopListening();
      voiceRef.current?.cancelSpeech();
      activeQuizRef.current = null;
      setIsListening(false);
      setIsHostSpeaking(false);
      setPhaseSafe('IDLE');
    }

    jumpToDistance(Math.max(0, nextLm.at_m - 2050), `landmark (${nextLm.name[languageRef.current]})`);
  }, [jumpToDistance, setPhaseSafe]);

  const jumpToNextRegion = useCallback(() => {
    const currentRoute = routeRef.current;
    if (!currentRoute || currentRoute.regions.length === 0) return;
    const nextReg = getNextRegion(currentRoute, progressMRef.current) ?? currentRoute.regions[0];
    if (!nextReg) return;

    if (phaseRef.current === 'OFFER' || activeQuizRef.current?.question.type === 'trivia') {
      quizTokenRef.current += 1;
      voiceRef.current?.stopListening();
      voiceRef.current?.cancelSpeech();
      activeQuizRef.current = null;
      setIsListening(false);
      setIsHostSpeaking(false);
      setPhaseSafe('IDLE');
    }

    jumpToDistance(
      Math.max(0, nextReg.enter_at_m - 150),
      `region (${nextReg.name[languageRef.current]})`
    );
  }, [jumpToDistance, setPhaseSafe]);

  const submitTypedInput = useCallback((text: string) => {
    const cleaned = text.trim();
    if (!cleaned) return;
    voiceRef.current?.stopListening();
    setIsListening(false);
    void handleUserInputRef.current(cleaned);
  }, []);

  const triggerOfferNow = useCallback(() => {
    if (isPausedRef.current) return;
    void runOfferRoundRef.current();
  }, []);

  useEffect(() => {
    const vc = voiceRef.current;
    return () => {
      clearOfferTimer();
      vc?.dispose();
    };
  }, [clearOfferTimer]);

  const isDirectionsFirst = Boolean(
    isInDirectionsFirstZone(route, progressM, DEFAULT_NAV_SETTINGS)
  );
  const nextManeuver = getNextManeuver(route, progressM);
  const distanceToNextManeuverM = nextManeuver ? Math.max(0, nextManeuver.at_m - progressM) : null;
  const activeRegion = getCurrentRegion(route, progressM);
  const currentRegionName = route
    ? activeRegion
      ? activeRegion.name[language] || activeRegion.name['en-IN']
      : route.start_region[language] || route.start_region['en-IN']
    : HOST_SCRIPTS[language].ui.quiz;

  const actions = useMemo<CoDriverActions>(
    () => ({
      startSession,
      stopSession,
      togglePause,
      skipCurrent,
      repeatCurrent,
      toggleSimPlay,
      setSimSpeed,
      jumpToNextTurn,
      jumpToNextLandmark,
      jumpToNextRegion,
      submitTypedInput,
      triggerOfferNow,
    }),
    [
      jumpToNextLandmark,
      jumpToNextRegion,
      jumpToNextTurn,
      repeatCurrent,
      setSimSpeed,
      skipCurrent,
      startSession,
      stopSession,
      submitTypedInput,
      togglePause,
      toggleSimPlay,
      triggerOfferNow,
    ]
  );

  return {
    state: {
      language,
      route,
      progressM,
      isSimPlaying,
      isSimulatedMode,
      simSpeed,
      phase,
      activeChannel,
      isHostSpeaking,
      isListening,
      isDirectionsFirst,
      nextManeuver,
      distanceToNextManeuverM,
      currentRegionName,
      hostCaption,
      heardCaption,
      lastFeedbackTone,
      activeQuestionType,
      activeClueStep,
      stats,
      debugLogs,
      isLoading,
    },
    actions,
  };
}
