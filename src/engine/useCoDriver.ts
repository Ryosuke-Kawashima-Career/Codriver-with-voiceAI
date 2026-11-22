import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AgentQuizResponse,
  AgentTurnResponse,
  DebugLogEntry,
  DemoSpeed,
  GpsFix,
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
  TripSnapshot,
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
  userInitiated?: boolean;
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
  activeQuestionSource: 'curated' | 'generated' | null;
  activeClueStep: { current: number; total: number } | null;
  isGeneratingQuizzes: boolean;
  stats: SessionStats;
  debugLogs: DebugLogEntry[];
  isLoading: boolean;
}

export interface CoDriverActions {
  startSession: (
    language: LanguageCode,
    route: RouteData | null,
    initialGpsFix?: GpsFix | null
  ) => Promise<void>;
  stopSession: () => Promise<void>;
  togglePause: () => void;
  skipCurrent: () => void;
  repeatCurrent: () => void;
  listenNow: () => void;
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
  const [activeQuestionSource, setActiveQuestionSource] = useState<'curated' | 'generated' | null>(
    null
  );
  const [activeClueStep, setActiveClueStep] = useState<{ current: number; total: number } | null>(
    null
  );
  const [isGeneratingQuizzes, setIsGeneratingQuizzes] = useState(false);
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
  const currentGpsRef = useRef<GpsFix | null>(null);
  const cumDistancesRef = useRef<number[]>([]);
  const progressMRef = useRef(0);
  const simSpeedRef = useRef<DemoSpeed>(1);
  const isSimPlayingRef = useRef(false);
  const gpsIgnoredByDemoRef = useRef(false);
  const isPausedRef = useRef(false);
  const isNavSpeakingRef = useRef(false);
  const isAgentBusyRef = useRef(false);
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
    async (text: string, token: number, allowInDirectionsZone = false): Promise<boolean> => {
      const activeZone = isInDirectionsFirstZone(
        routeRef.current,
        progressMRef.current,
        DEFAULT_NAV_SETTINGS
      );
      if ((!allowInDirectionsZone && activeZone) || isNavSpeakingRef.current) {
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

  // Spec 4.2: Voice AI Agent replies play as host speech and MAY play inside directions-first zone
  // because they directly answer the driver (turn-by-turn directions still interrupt immediately).
  const speakAgentReply = useCallback(
    async (text: string, token: number): Promise<boolean> => {
      if (isNavSpeakingRef.current || token !== quizTokenRef.current || isPausedRef.current) {
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
        summary: 'Played Voice AI Agent reply',
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

  const buildTripSnapshot = useCallback((): TripSnapshot | null => {
    const lang = languageRef.current;
    const currentRoute = routeRef.current;
    const gps = currentGpsRef.current;

    if (!currentRoute) {
      if (!gps?.locationName) return null;
      return {
        destination: null,
        current_location: {
          name: gps.locationName,
          lat: gps.lat,
          lon: gps.lon,
        },
        remaining_m: null,
        remaining_s: null,
        arrival_time: null,
        next_maneuver: null,
        region: gps.locationName,
        next_landmark: null,
      };
    }

    const remainingM = Math.max(0, Math.round(currentRoute.length_m - progressMRef.current));
    const totalLength = Math.max(1, currentRoute.length_m);
    const remainingS = currentRoute.duration_s
      ? Math.max(0, Math.round(currentRoute.duration_s * (remainingM / totalLength)))
      : Math.max(0, Math.round(remainingM / BASE_SPEED_MPS));

    const etaDate = new Date(Date.now() + remainingS * 1000);
    const arrivalTime = `${String(etaDate.getHours()).padStart(2, '0')}:${String(
      etaDate.getMinutes()
    ).padStart(2, '0')}`;

    const nextM = getNextManeuver(currentRoute, progressMRef.current);
    const activeReg = getCurrentRegion(currentRoute, progressMRef.current);
    const nextLm = getNextLandmark(currentRoute, progressMRef.current);
    const regionName =
      activeReg?.name[lang] ||
      activeReg?.name['en-IN'] ||
      currentRoute.start_region[lang] ||
      currentRoute.start_region['en-IN'];

    return {
      destination: currentRoute.name[lang] || currentRoute.name['en-IN'],
      current_location: {
        name: gps?.locationName || regionName,
        lat: gps?.lat,
        lon: gps?.lon,
      },
      remaining_m: remainingM,
      remaining_s: remainingS,
      arrival_time: arrivalTime,
      next_maneuver: nextM
        ? {
            text: nextM.text[lang] || nextM.text['en-IN'],
            distance_m: Math.max(0, Math.round(nextM.at_m - progressMRef.current)),
          }
        : null,
      region: regionName,
      next_landmark: nextLm
        ? {
            name: nextLm.name[lang] || nextLm.name['en-IN'],
            distance_m: Math.max(0, Math.round(nextLm.at_m - progressMRef.current)),
          }
        : null,
    };
  }, []);

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
      // Automatic/route-triggered quizzes wait outside directions-first zones,
      // while explicitly user-requested quizzes may start unless a direction is actively speaking.
      if ((!ctx.userInitiated && activeZone) || isNavSpeakingRef.current) {
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
      setActiveQuestionSource(ctx.question.source ?? 'curated');
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
      const ok = await speakQuiz(spokenText, token, Boolean(ctx.userInitiated));
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

  const askVoiceAgent = useCallback(
    async (utterance: string) => {
      if (isPausedRef.current || isNavSpeakingRef.current || isAgentBusyRef.current) return;
      const scripts = HOST_SCRIPTS[languageRef.current];
      const token = ++quizTokenRef.current;
      isAgentBusyRef.current = true;
      clearOfferTimer();
      setPhaseSafe('JUDGE');
      setLastFeedbackTone('neutral');

      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 8000);

      try {
        const res = await fetch('/api/agent/turn', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            language: languageRef.current,
            utterance,
            trip: buildTripSnapshot(),
          }),
          signal: controller.signal,
        });
        window.clearTimeout(timeoutId);

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const data = (await res.json()) as AgentTurnResponse;
        if (token !== quizTokenRef.current || isPausedRef.current) return;

        pushLog({
          kind: 'agent',
          intent: data.intent,
          summary: `Agent intent: ${data.intent}${data.latencyMs ? ` (${data.latencyMs} ms)` : ''}`,
          detail: data.reply,
        });

        if (data.intent === 'start_quiz') {
          let nextQ: Question | null = data.question
            ? { ...data.question, source: 'generated' }
            : null;

          if (nextQ) {
            allQuestionsRef.current = [...allQuestionsRef.current, nextQ];
            pushLog({
              kind: 'agent',
              intent: 'start_quiz',
              summary: 'Agent created live quiz question',
              detail: nextQ.prompt,
            });
          } else {
            nextQ = pickNextTrivia();
          }

          if (data.reply) {
            setPhaseSafe('FEEDBACK');
            const ok = await speakAgentReply(data.reply, token);
            if (!ok || token !== quizTokenRef.current || isPausedRef.current) return;
          }

          if (nextQ) {
            await runQuestionRoundRef.current({
              question: nextQ,
              clueIndex: 0,
              userInitiated: true,
            });
          } else {
            setPhaseSafe('IDLE');
          }
          return;
        }

        setPhaseSafe('FEEDBACK');
        const replyLine = data.reply || scripts.agentFallback;
        const finished = await speakAgentReply(replyLine, token);
        if (!finished || token !== quizTokenRef.current || isPausedRef.current) return;

        setPhaseSafe('IDLE');
        setActiveQuestionType(null);
        setActiveQuestionSource(null);
        scheduleNextOfferRef.current(8000);
      } catch (err) {
        window.clearTimeout(timeoutId);
        if (token !== quizTokenRef.current || isPausedRef.current) return;

        pushLog({
          kind: 'agent',
          summary: `Agent turn fallback (${err instanceof Error ? err.message : 'error'})`,
          detail: scripts.agentFallback,
        });
        setPhaseSafe('FEEDBACK');
        await speakAgentReply(scripts.agentFallback, token);
        if (token === quizTokenRef.current && !isPausedRef.current) {
          setPhaseSafe('IDLE');
        }
      } finally {
        isAgentBusyRef.current = false;
      }
    },
    [buildTripSnapshot, clearOfferTimer, pickNextTrivia, pushLog, setPhaseSafe, speakAgentReply]
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
        // Only treat 'resume' as a voice command when the quiz is actually paused;
        // otherwise let utterances like "start" or "start a quiz" reach the Voice AI Agent.
        if (cmd && (cmd !== 'resume' || isPausedRef.current)) {
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
          summary: rawText ? `Offer reply -> ${intent ?? 'agent_turn'}` : 'Offer silence (8s) -> going quiet',
          detail: rawText ?? undefined,
        });

        if (intent === 'yes') {
          const nextQ = pickNextTrivia();
          if (nextQ) {
            await runQuestionRoundRef.current({
              question: nextQ,
              clueIndex: 0,
              userInitiated: true,
            });
          } else {
            setPhaseSafe('IDLE');
          }
        } else if (intent === 'skip' || intent === 'stop' || !rawText) {
          const token = ++quizTokenRef.current;
          setPhaseSafe('IDLE');
          setActiveQuestionType(null);
          setActiveQuestionSource(null);
          if (rawText) {
            await speakQuiz(scripts.offerQuiet, token);
          } else {
            setHostCaption(scripts.offerQuiet);
          }
          scheduleNextOfferRef.current(12000);
        } else {
          // Non-yes/no utterance during OFFER (e.g., "How far is it?") -> send to Voice AI Agent
          await askVoiceAgent(rawText);
        }
        return;
      }

      // Spec 4.2: Any driver utterance outside LISTEN (e.g. during IDLE) goes to /api/agent/turn
      if (currentPhase !== 'LISTEN' || !activeQuizRef.current) {
        if (rawText) {
          await askVoiceAgent(rawText);
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
          const finished = await speakQuiz(reply, token, Boolean(ctx.userInitiated));
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

        const finished = await speakQuiz(reply, token, Boolean(ctx.userInitiated));
        if (!finished || token !== quizTokenRef.current || isPausedRef.current) return;

        setPhaseSafe('IDLE');
        setActiveQuestionType(null);
        processDeferredAfterZoneRef.current();
      }
    },
    [
      askVoiceAgent,
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
        currentGpsRef.current = {
          ...(currentGpsRef.current ?? {}),
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracyM: Math.round(pos.coords.accuracy || 25),
        };
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

  const fetchBackgroundQuizzes = useCallback(
    async (selectedLang: LanguageCode, selectedRoute: RouteData | null, sessionToken: number) => {
      setIsGeneratingQuizzes(true);
      try {
        const res = await fetch('/api/agent/quiz', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            language: selectedLang,
            path: selectedRoute?.path ?? null,
            trivia_count: 5,
          }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as AgentQuizResponse;
        if (sessionToken !== sessionTokenRef.current) return;

        // Curated questions always win: only add generated questions whose ID/group_id is not already present
        const existingQKeys = new Set<string>();
        for (const q of allQuestionsRef.current) {
          existingQKeys.add(q.id);
          if (q.group_id) existingQKeys.add(q.group_id);
        }

        const addedQuestions: Question[] = [];
        for (const q of data.questions ?? []) {
          if (existingQKeys.has(q.id) || (q.group_id && existingQKeys.has(q.group_id))) {
            continue;
          }
          existingQKeys.add(q.id);
          addedQuestions.push({ ...q, source: 'generated' });
        }

        if (addedQuestions.length > 0) {
          allQuestionsRef.current = [...allQuestionsRef.current, ...addedQuestions];
          const newTrivia = addedQuestions.filter((q) => q.type === 'trivia');
          if (newTrivia.length > 0) {
            triviaPoolRef.current = [...triviaPoolRef.current, ...newTrivia];
          }
        }

        // Merge newly discovered landmarks & regions into the live route
        if (
          routeRef.current &&
          ((data.landmarks && data.landmarks.length > 0) ||
            (data.regions && data.regions.length > 0))
        ) {
          const cur = routeRef.current;
          const existingLmIds = new Set(cur.landmarks.map((l) => l.id));
          const existingRegIds = new Set(cur.regions.map((r) => r.id));

          const newLandmarks = (data.landmarks ?? []).filter((l) => !existingLmIds.has(l.id));
          const newRegions = (data.regions ?? []).filter((r) => !existingRegIds.has(r.id));

          // Mark already-passed newly added stops so they don't retroactively trigger
          for (const lm of newLandmarks) {
            if (lm.at_m < progressMRef.current) {
              firedTriggersRef.current.landmarkDue.add(lm.id);
              firedTriggersRef.current.landmarkPassed.add(lm.id);
            }
          }
          for (const reg of newRegions) {
            if (reg.enter_at_m < progressMRef.current) {
              firedTriggersRef.current.regionEntered.add(reg.id);
            }
          }

          if (newLandmarks.length > 0 || newRegions.length > 0) {
            const mergedRoute: RouteData = {
              ...cur,
              landmarks: [...cur.landmarks, ...newLandmarks].sort((a, b) => a.at_m - b.at_m),
              regions: [...cur.regions, ...newRegions].sort((a, b) => a.enter_at_m - b.enter_at_m),
            };
            routeRef.current = mergedRoute;
            setRoute(mergedRoute);
          }
        }

        const st = data.stats;
        pushLog({
          kind: 'agent',
          summary: `Background quizzes ready (${st.placesSource}): +${st.discoveredLandmarks} landmarks, +${st.discoveredRegions} regions, +${addedQuestions.length} AI questions (${st.reusedFromCache} cached) in ${(st.durationMs / 1000).toFixed(1)}s`,
          detail: st.errors.length > 0 ? st.errors.join('; ') : undefined,
        });
      } catch (err) {
        if (sessionToken === sessionTokenRef.current) {
          pushLog({
            kind: 'agent',
            summary: 'Background quiz generation skipped; using curated questions',
            detail: err instanceof Error ? err.message : undefined,
          });
        }
      } finally {
        if (sessionToken === sessionTokenRef.current) {
          setIsGeneratingQuizzes(false);
        }
      }
    },
    [pushLog]
  );

  const startSession = useCallback(
    async (
      selectedLang: LanguageCode,
      selectedRoute: RouteData | null,
      initialGpsFix?: GpsFix | null
    ) => {
      setIsLoading(true);
      const token = ++sessionTokenRef.current;
      quizTokenRef.current += 1;
      clearOfferTimer();
      voiceRef.current?.stopListening();
      voiceRef.current?.cancelSpeech();

      languageRef.current = selectedLang;
      routeRef.current = selectedRoute;
      currentGpsRef.current = initialGpsFix ?? null;
      cumDistancesRef.current = selectedRoute ? computeCumulativeRouteDistances(selectedRoute) : [];
      progressMRef.current = 0;
      isSimPlayingRef.current = false;
      gpsIgnoredByDemoRef.current = false;
      isPausedRef.current = false;
      isNavSpeakingRef.current = false;
      isAgentBusyRef.current = false;
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
      setActiveQuestionSource(null);
      setActiveClueStep(null);
      setIsGeneratingQuizzes(false);
      setLastFeedbackTone('neutral');
      setActiveChannel('quiz');
      setPhaseSafe('IDLE');

      try {
        const res = await fetch(`/api/questions?language=${encodeURIComponent(selectedLang)}`);
        if (!res.ok) throw new Error('Failed to load questions');
        const data = (await res.json()) as { questions: Question[] };
        if (token !== sessionTokenRef.current) return;

        const curated = data.questions.map((q) => ({ ...q, source: 'curated' as const }));
        allQuestionsRef.current = curated;
        triviaPoolRef.current = curated.filter((q) => q.type === 'trivia');
      } catch (err) {
        console.error('Error loading questions:', err);
        allQuestionsRef.current = [];
        triviaPoolRef.current = [];
      } finally {
        setIsLoading(false);
      }

      if (token !== sessionTokenRef.current) return;

      // Spec 4.3: Fire background route quiz generation right after Start (never blocks greeting/offer)
      void fetchBackgroundQuizzes(selectedLang, selectedRoute, token);

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
    [clearOfferTimer, fetchBackgroundQuizzes, pushLog, setPhaseSafe, speakQuiz]
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

  // Opens mic immediately so driver can speak a trip question or answer on demand
  const listenNow = useCallback(() => {
    if (isPausedRef.current || isNavSpeakingRef.current) return;
    clearOfferTimer();
    voiceRef.current?.cancelSpeech();
    setIsHostSpeaking(false);
    const token = ++quizTokenRef.current;
    openMicForCurrentPhase(token);
  }, [clearOfferTimer, openMicForCurrentPhase]);

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
      listenNow,
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
      listenNow,
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
      activeQuestionSource,
      activeClueStep,
      isGeneratingQuizzes,
      stats,
      debugLogs,
      isLoading,
    },
    actions,
  };
}
