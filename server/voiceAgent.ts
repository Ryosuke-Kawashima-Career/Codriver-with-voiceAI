/**
 * Server-only Voice AI Agent module (Spec Section 4).
 * - POST /api/agent/turn: answers live driver trip questions & detects start_quiz intent (< 1.5 s target).
 * - POST /api/agent/quiz: generates landmark, region, and trivia quizzes along any route and caches
 *   generated items in data/generated-questions.json for reuse and human fact-checking.
 *
 * Uses @google/genai (gemini-4-hydrogen) with server-side GEMINI_API_KEY by default,
 * and optionally supports ANTHROPIC_API_KEY (CLAUDE_MODEL) if explicitly configured.
 */

import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  discoverPlacesAlongRoute,
  type DiscoveredLandmark,
  type DiscoveredRegion,
  type ExistingPlaceRef,
  type SupportedLang,
} from './placesAlongRoute.ts';

export interface TripSnapshot {
  destination: string | null;
  current_location?: {
    name: string;
    lat?: number;
    lon?: number;
  } | null;
  remaining_m: number | null;
  remaining_s: number | null;
  arrival_time: string | null;
  next_maneuver: { text: string; distance_m: number } | null;
  region: string | null;
  next_landmark: { name: string; distance_m: number } | null;
}

export type AgentIntent = 'trip_question' | 'start_quiz' | 'other';

export interface AgentTurnResult {
  intent: AgentIntent;
  reply: string;
  question?: GeneratedQuestion;
  provider: 'gemini' | 'anthropic';
  latencyMs: number;
}

export interface GeneratedQuestion {
  id: string;
  group_id?: string;
  type: 'landmark' | 'region' | 'trivia';
  language: SupportedLang;
  prompt: string;
  clues: string[];
  answers: string[];
  display_answer: string;
  fun_fact: string;
  source: 'generated';
}

export interface StoredGeneratedEntry {
  place_key: string;
  place_name: string;
  kind: 'landmark' | 'region' | 'trivia';
  language: SupportedLang;
  created_at: string;
  question: GeneratedQuestion;
  welcome?: string;
  greeting?: string;
}

export interface AgentQuizResult {
  landmarks: DiscoveredLandmark[];
  regions: DiscoveredRegion[];
  questions: GeneratedQuestion[];
  stats: {
    placesSource: 'overpass' | 'nominatim' | 'none';
    discoveredLandmarks: number;
    discoveredRegions: number;
    reusedFromCache: number;
    newlyGenerated: number;
    triviaGenerated: number;
    durationMs: number;
    provider: 'gemini' | 'anthropic' | 'none';
    errors: string[];
  };
}

const LANG_LABEL: Record<SupportedLang, string> = {
  'en-IN': 'Indian English (en-IN)',
  'hi-IN': 'Hindi written naturally in Devanagari script (hi-IN)',
  'ta-IN': 'Tamil written naturally in Tamil script (ta-IN)',
};

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function isTransientGeminiError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /503|429|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|overloaded|fetch failed/i.test(msg);
}

/**
 * Calls Gemini with automatic fallback across active free-tier models
 * (gemini-4-hydrogen <-> gemini-3.1-flash-lite) when a model experiences transient 503 spikes.
 */
async function generateGeminiJsonWithFallback(
  gemini: GoogleGenAI,
  params: {
    models: string[];
    contents: string;
    systemInstruction: string;
    thinkingLevel: ThinkingLevel;
    responseSchema: Record<string, unknown>;
  }
): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i < params.models.length; i++) {
    const model = params.models[i];
    try {
      const response = await gemini.models.generateContent({
        model,
        contents: params.contents,
        config: {
          systemInstruction: params.systemInstruction,
          thinkingConfig: { thinkingLevel: params.thinkingLevel },
          responseMimeType: 'application/json',
          responseSchema: params.responseSchema,
        },
      });
      const text = (response.text ?? '').trim();
      if (text) return text;
      throw new Error(`Empty response from ${model}`);
    } catch (err) {
      lastErr = err;
      if (i < params.models.length - 1 && isTransientGeminiError(err)) {
        await new Promise((r) => setTimeout(r, 250 * (i + 1)));
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error('Gemini generation failed');
}

export function getAgentProvider(): 'gemini' | 'anthropic' | 'none' {
  if (process.env.GEMINI_API_KEY?.trim()) return 'gemini';
  if (process.env.ANTHROPIC_API_KEY?.trim()) return 'anthropic';
  return 'none';
}

function normalizePlaceKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/[^a-z0-9\u0900-\u097f\u0b80-\u0bff]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

async function readGeneratedCache(dataDir: string): Promise<StoredGeneratedEntry[]> {
  const filePath = path.resolve(dataDir, 'generated-questions.json');
  if (!filePath.startsWith(dataDir + path.sep)) {
    throw new Error('Invalid generated questions path');
  }
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoredGeneratedEntry[]) : [];
  } catch {
    return [];
  }
}

async function appendGeneratedCache(
  dataDir: string,
  newEntries: StoredGeneratedEntry[]
): Promise<void> {
  if (newEntries.length === 0) return;
  const filePath = path.resolve(dataDir, 'generated-questions.json');
  if (!filePath.startsWith(dataDir + path.sep)) {
    throw new Error('Invalid generated questions path');
  }
  const existing = await readGeneratedCache(dataDir);
  const existingKeys = new Set(
    existing.map((e) => `${e.kind}:${e.language}:${e.place_key}:${e.question.id}`)
  );
  const merged = [...existing];
  for (const entry of newEntries) {
    const k = `${entry.kind}:${entry.language}:${entry.place_key}:${entry.question.id}`;
    if (!existingKeys.has(k)) {
      existingKeys.add(k);
      merged.push(entry);
    }
  }
  // Keep file bounded reasonably for hackathon repo cleanliness
  const bounded = merged.slice(-300);
  await fs.writeFile(filePath, JSON.stringify(bounded, null, 2) + '\n', 'utf-8');
}

async function callAnthropicJson<T>(
  systemPrompt: string,
  userPrompt: string,
  timeoutMs: number
): Promise<T> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');

  const model = process.env.CLAUDE_MODEL?.trim() || 'claude-opus-5-5';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1800,
        system: `${systemPrompt}\nReturn ONLY valid JSON matching the requested schema, with no markdown fences.`,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      throw new Error(`Anthropic HTTP ${res.status}`);
    }
    const data = (await res.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const text = data.content?.find((c) => c.type === 'text')?.text?.trim() || '{}';
    const cleaned = text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
    return JSON.parse(cleaned) as T;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

interface RawGeneratedSingleQuiz {
  prompt?: string;
  clues?: string[];
  answers?: string[];
  display_answer?: string;
  fun_fact?: string;
  topic?: string;
}

function normalizeSingleQuiz(
  raw: RawGeneratedSingleQuiz | undefined,
  language: SupportedLang
): { question: GeneratedQuestion; topic: string } | null {
  if (!raw || !raw.prompt?.trim() || !raw.display_answer?.trim()) {
    return null;
  }
  const displayAnswer = raw.display_answer.trim();
  const answers = (raw.answers ?? []).map((a) => a.trim()).filter(Boolean);
  if (answers.length === 0) {
    answers.push(displayAnswer);
  }
  const qId = `q_agent_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  return {
    topic: (raw.topic || 'On-Demand Quiz').trim().slice(0, 80),
    question: {
      id: qId,
      group_id: qId,
      type: 'trivia',
      language,
      prompt: raw.prompt.trim(),
      clues: (raw.clues ?? []).map((c) => c.trim()).filter(Boolean).slice(0, 2),
      answers,
      display_answer: displayAnswer,
      fun_fact: (raw.fun_fact || '').trim(),
      source: 'generated',
    },
  };
}

/**
 * Generates a single spoken quiz question on demand (used by POST /api/agent/quiz/create
 * and as a guaranteed fallback whenever intent === "start_quiz").
 */
export async function createSingleQuiz(params: {
  dataDir?: string;
  language: SupportedLang;
  topic?: string;
  trip: TripSnapshot | null;
}): Promise<{ question: GeneratedQuestion; provider: 'gemini' | 'anthropic'; latencyMs: number }> {
  const startedAt = Date.now();
  const { dataDir, language, topic, trip } = params;

  const systemInstruction = [
    `You create one fun, verifiable, spoken road-trip quiz question for Safar, an eyes-free in-car voice co-driver.`,
    `Write prompt, display_answer, and fun_fact natively in ${LANG_LABEL[language]}.`,
    `Provide 2 to 5 concise spoken answer variants in "answers" (include both native script and common English/phonetic spellings so speech recognition matches easily).`,
    `Rules:`,
    `1. If "topic" is provided, make the question about that topic. Otherwise, tailor it to the driver's current_location, region, destination, or next_landmark from "trip" if available, or pick a fun Indian/world road-trip trivia fact.`,
    `2. Well-known verifiable facts ONLY. No politics or sensitive topics.`,
    `3. NEVER ask the driver to look at, spot, read, or touch anything.`,
    `4. Keep prompt and fun_fact short (1-2 spoken sentences).`,
  ].join('\n');

  const userContent = JSON.stringify({ language, topic: topic || null, trip }, null, 2);

  let rawQuiz: RawGeneratedSingleQuiz;
  let provider: 'gemini' | 'anthropic';

  const gemini = getGeminiClient();
  if (gemini) {
    provider = 'gemini';
    const preferred = process.env.AGENT_MODEL?.trim();
    const models = preferred
      ? [preferred, 'gemini-3.1-flash-lite', 'gemini-4-hydrogen'].filter(
          (m, idx, arr) => arr.indexOf(m) === idx
        )
      : ['gemini-3.1-flash-lite', 'gemini-4-hydrogen'];

    const rawText = await generateGeminiJsonWithFallback(gemini, {
      models,
      contents: userContent,
      systemInstruction,
      thinkingLevel: ThinkingLevel.LOW,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          topic: { type: Type.STRING },
          prompt: { type: Type.STRING },
          clues: { type: Type.ARRAY, items: { type: Type.STRING } },
          answers: { type: Type.ARRAY, items: { type: Type.STRING } },
          display_answer: { type: Type.STRING },
          fun_fact: { type: Type.STRING },
        },
        required: ['prompt', 'answers', 'display_answer', 'fun_fact'],
      },
    });
    rawQuiz = JSON.parse(rawText) as RawGeneratedSingleQuiz;
  } else {
    provider = 'anthropic';
    rawQuiz = await callAnthropicJson<RawGeneratedSingleQuiz>(
      systemInstruction,
      `${userContent}\n\nReturn JSON: { "topic": "...", "prompt": "...", "clues": [], "answers": ["..."], "display_answer": "...", "fun_fact": "..." }`,
      7500
    );
  }

  const normalized = normalizeSingleQuiz(rawQuiz, language);
  if (!normalized) {
    throw new Error('Model returned an incomplete quiz question');
  }

  if (dataDir) {
    void appendGeneratedCache(dataDir, [
      {
        place_key: normalizePlaceKey(normalized.topic) || normalized.question.id,
        place_name: normalized.topic,
        kind: 'trivia',
        language,
        created_at: new Date().toISOString(),
        question: normalized.question,
      },
    ]).catch(() => {
      // Non-fatal cache write failure
    });
  }

  return {
    question: normalized.question,
    provider,
    latencyMs: Date.now() - startedAt,
  };
}

/**
 * Spec 4.2: Answers live driver utterances (trip questions, start_quiz requests with a freshly
 * generated quiz question ready to play, or polite decline).
 */
export async function handleAgentTurn(params: {
  dataDir?: string;
  language: SupportedLang;
  utterance: string;
  trip: TripSnapshot | null;
}): Promise<AgentTurnResult> {
  const startedAt = Date.now();
  const { dataDir, language, utterance, trip } = params;

  const systemInstruction = [
    `You are Safar, a calm, eyes-free Indian in-car voice co-driver.`,
    `Language: respond strictly in ${LANG_LABEL[language]}.`,
    `Classify the driver's utterance into one of three intents:`,
    `- "trip_question": asking about current location, distance remaining, ETA/arrival time, next turn/maneuver, current region/city, or next landmark/stop.`,
    `- "start_quiz": asking to start a quiz, make/create a quiz, play a game, or ask a question (about any topic or the current trip/location).`,
    `- "other": anything else (e.g., weather, booking hotels, changing destination, calling someone, unrelated chatter).`,
    `Strict safety & accuracy rules for "reply":`,
    `1. At most 2 short spoken sentences suitable for text-to-speech.`,
    `2. Use ONLY the exact facts provided in the JSON trip snapshot. NEVER invent traffic, places, weather, or arrival times.`,
    `3. If trip is null (quiz-only mode) and the driver asks a route question, say briefly that no route is active right now (you may still mention current_location if present).`,
    `4. NEVER ask the driver to look at, read, tap, or touch the screen.`,
    `5. For "start_quiz": write a short 3-6 word enthusiastic lead-in in "reply" (do NOT include the quiz question text inside "reply"), AND populate the "quiz" object with ONE complete, verifiable spoken quiz question in ${LANG_LABEL[language]}. Tailor the quiz to any topic the driver asked for, or to their current_location/region/destination in "trip" if available, or engaging road-trip trivia. Provide 2-5 spoken answer variants in "quiz.answers" (native script + common English/phonetic spellings).`,
    `6. For "other", politely say in 1 short sentence that you can only help with trip details and road quizzes.`,
  ].join('\n');

  const userContent = JSON.stringify(
    {
      language,
      utterance,
      trip,
    },
    null,
    2
  );

  let parsed: { intent?: AgentIntent; reply?: string; quiz?: RawGeneratedSingleQuiz };
  let provider: 'gemini' | 'anthropic';

  const gemini = getGeminiClient();
  if (gemini) {
    provider = 'gemini';
    const preferred = process.env.AGENT_MODEL?.trim();
    const models = preferred
      ? [preferred, 'gemini-3.1-flash-lite', 'gemini-4-hydrogen'].filter(
          (m, idx, arr) => arr.indexOf(m) === idx
        )
      : ['gemini-3.1-flash-lite', 'gemini-4-hydrogen'];

    const rawText = await generateGeminiJsonWithFallback(gemini, {
      models,
      contents: userContent,
      systemInstruction,
      thinkingLevel: ThinkingLevel.LOW,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          intent: {
            type: Type.STRING,
            enum: ['trip_question', 'start_quiz', 'other'],
            description: 'Classified intent of the driver utterance.',
          },
          reply: {
            type: Type.STRING,
            description:
              'Short spoken reply (max 2 short sentences) in the requested language using only facts from trip.',
          },
          quiz: {
            type: Type.OBJECT,
            description:
              'Required when intent is "start_quiz". Contains one complete spoken quiz question.',
            properties: {
              topic: { type: Type.STRING },
              prompt: { type: Type.STRING },
              clues: { type: Type.ARRAY, items: { type: Type.STRING } },
              answers: { type: Type.ARRAY, items: { type: Type.STRING } },
              display_answer: { type: Type.STRING },
              fun_fact: { type: Type.STRING },
            },
            required: ['prompt', 'answers', 'display_answer', 'fun_fact'],
          },
        },
        required: ['intent', 'reply'],
      },
    });

    parsed = JSON.parse(rawText) as {
      intent?: AgentIntent;
      reply?: string;
      quiz?: RawGeneratedSingleQuiz;
    };
  } else {
    provider = 'anthropic';
    parsed = await callAnthropicJson<{
      intent?: AgentIntent;
      reply?: string;
      quiz?: RawGeneratedSingleQuiz;
    }>(
      systemInstruction,
      `${userContent}\n\nRespond with JSON: { "intent": "trip_question" | "start_quiz" | "other", "reply": "...", "quiz": { "topic": "...", "prompt": "...", "clues": [], "answers": ["..."], "display_answer": "...", "fun_fact": "..." } } (include "quiz" when intent is "start_quiz").`,
      7500
    );
  }

  const intent: AgentIntent =
    parsed.intent === 'trip_question' ||
    parsed.intent === 'start_quiz' ||
    parsed.intent === 'other'
      ? parsed.intent
      : 'other';

  let generatedQuestion: GeneratedQuestion | undefined;

  if (intent === 'start_quiz') {
    const normalized = normalizeSingleQuiz(parsed.quiz, language);
    if (normalized) {
      generatedQuestion = normalized.question;
      if (dataDir) {
        void appendGeneratedCache(dataDir, [
          {
            place_key: normalizePlaceKey(normalized.topic) || normalized.question.id,
            place_name: normalized.topic,
            kind: 'trivia',
            language,
            created_at: new Date().toISOString(),
            question: normalized.question,
          },
        ]).catch(() => {
          // Non-fatal cache write failure
        });
      }
    } else {
      // Guaranteed fallback: explicitly generate a single quiz question if the turn reply omitted it
      try {
        const created = await createSingleQuiz({
          dataDir,
          language,
          topic: utterance,
          trip,
        });
        generatedQuestion = created.question;
      } catch {
        // Frontend will fall back to local trivia pool
      }
    }
  }

  return {
    intent,
    reply: (parsed.reply || '').trim(),
    ...(generatedQuestion ? { question: generatedQuestion } : {}),
    provider,
    latencyMs: Date.now() - startedAt,
  };
}

interface GeneratedQuizBatchPayload {
  landmark_quizzes: Array<{
    place_id: string;
    prompt: string;
    clues: string[];
    answers: string[];
    display_answer: string;
    fun_fact: string;
  }>;
  region_quizzes: Array<{
    place_id: string;
    welcome: string;
    greeting: string;
    prompt: string;
    answers: string[];
    display_answer: string;
    fun_fact: string;
  }>;
  trivia_quizzes: Array<{
    prompt: string;
    answers: string[];
    display_answer: string;
    fun_fact: string;
  }>;
}

/**
 * Spec 4.3: Background route quiz generation.
 * Discovers OSM places along the route, reuses cached entries in data/generated-questions.json,
 * generates missing landmark/region/trivia questions natively, and persists them for fact-checking.
 */
export async function generateRouteQuizzes(params: {
  dataDir: string;
  language: SupportedLang;
  pathCoords: [number, number][] | null;
  existingPlaces: ExistingPlaceRef[];
  curatedQuestionIds: Set<string>;
  triviaCount: number;
}): Promise<AgentQuizResult> {
  const startedAt = Date.now();
  const { dataDir, language, pathCoords, existingPlaces, curatedQuestionIds, triviaCount } = params;
  const errors: string[] = [];

  // 1. Discover places along the route (Spec 3.2)
  const discovered =
    pathCoords && pathCoords.length >= 2
      ? await discoverPlacesAlongRoute(pathCoords, existingPlaces)
      : {
          landmarks: [] as DiscoveredLandmark[],
          regions: [] as DiscoveredRegion[],
          source: 'none' as const,
          durationMs: 0,
          errors: [] as string[],
        };

  errors.push(...discovered.errors);

  // 2. Check data/generated-questions.json for reusable entries
  const cache = await readGeneratedCache(dataDir);
  const cacheByKey = new Map<string, StoredGeneratedEntry>();
  for (const entry of cache) {
    if (entry.language === language) {
      cacheByKey.set(`${entry.kind}:${entry.place_key}`, entry);
    }
  }

  const finalLandmarks: DiscoveredLandmark[] = [];
  const finalRegions: DiscoveredRegion[] = [];
  const finalQuestions: GeneratedQuestion[] = [];

  const landmarksToGenerate: DiscoveredLandmark[] = [];
  const regionsToGenerate: DiscoveredRegion[] = [];
  let reusedFromCache = 0;

  for (const lm of discovered.landmarks) {
    if (curatedQuestionIds.has(lm.question_id)) continue;
    const key = `landmark:${normalizePlaceKey(lm.rawName)}`;
    const cached = cacheByKey.get(key);
    if (cached) {
      const q: GeneratedQuestion = {
        ...cached.question,
        id: lm.question_id,
        group_id: lm.question_id,
        source: 'generated',
      };
      finalLandmarks.push(lm);
      finalQuestions.push(q);
      reusedFromCache += 1;
    } else {
      landmarksToGenerate.push(lm);
    }
  }

  for (const reg of discovered.regions) {
    if (curatedQuestionIds.has(reg.question_id)) continue;
    const key = `region:${normalizePlaceKey(reg.rawName)}`;
    const cached = cacheByKey.get(key);
    if (cached) {
      const updatedReg: DiscoveredRegion = {
        ...reg,
        welcome: cached.welcome
          ? { ...reg.welcome, [language]: cached.welcome }
          : reg.welcome,
        greeting: cached.greeting
          ? { ...reg.greeting, [language]: cached.greeting }
          : reg.greeting,
      };
      const q: GeneratedQuestion = {
        ...cached.question,
        id: reg.question_id,
        group_id: reg.question_id,
        source: 'generated',
      };
      finalRegions.push(updatedReg);
      finalQuestions.push(q);
      reusedFromCache += 1;
    } else {
      regionsToGenerate.push(reg);
    }
  }

  const clampedTrivia = Math.max(0, Math.min(8, triviaCount));
  const needsGeneration =
    landmarksToGenerate.length > 0 || regionsToGenerate.length > 0 || clampedTrivia > 0;

  let provider: 'gemini' | 'anthropic' | 'none' = getAgentProvider();
  let newlyGenerated = 0;
  let triviaGenerated = 0;

  if (needsGeneration && provider !== 'none') {
    const systemInstruction = [
      `You write spoken road-trip quiz questions for Safar, an eyes-free in-car voice co-driver.`,
      `Write EVERY prompt, clue, display_answer, fun_fact, welcome, and greeting natively in ${LANG_LABEL[language]}.`,
      `Provide 2 to 5 concise accepted spoken answer variants in "answers" (include both native script and common English/phonetic spellings so browser speech recognition matches easily).`,
      `Strict content & safety rules:`,
      `1. Well-known, verifiable facts ONLY. If you are not confident about a listed place, OMIT that place from the output array.`,
      `2. For landmark_quizzes: produce a spoken prompt + up to 2 progressive clues (hardest first). NEVER mention the landmark's own name inside the prompt or clues; use "we are near..." or "this nearby town..." wording so the driver can guess the place or its famous specialty.`,
      `3. For region_quizzes: produce 1 easy spoken question, a warm 1-sentence "welcome" line, and a short local "greeting" written in the chosen language's script.`,
      `4. For trivia_quizzes: produce ${clampedTrivia} short, engaging Indian & world road-trip trivia questions (cricket, cinema, food, geography, heritage).`,
      `5. No disputed borders, politics, or sensitive topics.`,
      `6. NEVER ask the driver to look at, spot, read, or touch anything outside or on a screen.`,
      `7. Keep each prompt and fun_fact concise (1-2 short spoken sentences).`,
    ].join('\n');

    const promptPayload = {
      language,
      landmarks_needing_quiz: landmarksToGenerate.map((l) => ({
        place_id: l.id,
        name: l.rawName,
        kind: l.placeKind,
      })),
      regions_needing_quiz: regionsToGenerate.map((r) => ({
        place_id: r.id,
        name: r.rawName,
        kind: r.placeKind,
      })),
      trivia_count: clampedTrivia,
    };

    try {
      let payload: GeneratedQuizBatchPayload;
      const gemini = getGeminiClient();

      if (gemini) {
        provider = 'gemini';
        const preferred = process.env.AGENT_MODEL?.trim();
        const models = preferred
          ? [preferred, 'gemini-4-hydrogen', 'gemini-3.1-flash-lite'].filter(
              (m, idx, arr) => arr.indexOf(m) === idx
            )
          : ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'];

        const rawText = await generateGeminiJsonWithFallback(gemini, {
          models,
          contents: JSON.stringify(promptPayload, null, 2),
          systemInstruction,
          thinkingLevel: ThinkingLevel.MEDIUM,
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              landmark_quizzes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    place_id: { type: Type.STRING },
                    prompt: { type: Type.STRING },
                    clues: { type: Type.ARRAY, items: { type: Type.STRING } },
                    answers: { type: Type.ARRAY, items: { type: Type.STRING } },
                    display_answer: { type: Type.STRING },
                    fun_fact: { type: Type.STRING },
                  },
                  required: [
                    'place_id',
                    'prompt',
                    'clues',
                    'answers',
                    'display_answer',
                    'fun_fact',
                  ],
                },
              },
              region_quizzes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    place_id: { type: Type.STRING },
                    welcome: { type: Type.STRING },
                    greeting: { type: Type.STRING },
                    prompt: { type: Type.STRING },
                    answers: { type: Type.ARRAY, items: { type: Type.STRING } },
                    display_answer: { type: Type.STRING },
                    fun_fact: { type: Type.STRING },
                  },
                  required: [
                    'place_id',
                    'welcome',
                    'greeting',
                    'prompt',
                    'answers',
                    'display_answer',
                    'fun_fact',
                  ],
                },
              },
              trivia_quizzes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    prompt: { type: Type.STRING },
                    answers: { type: Type.ARRAY, items: { type: Type.STRING } },
                    display_answer: { type: Type.STRING },
                    fun_fact: { type: Type.STRING },
                  },
                  required: ['prompt', 'answers', 'display_answer', 'fun_fact'],
                },
              },
            },
            required: ['landmark_quizzes', 'region_quizzes', 'trivia_quizzes'],
          },
        });
        payload = JSON.parse(rawText) as GeneratedQuizBatchPayload;
      } else {
        provider = 'anthropic';
        payload = await callAnthropicJson<GeneratedQuizBatchPayload>(
          systemInstruction,
          `${JSON.stringify(promptPayload, null, 2)}\n\nReturn JSON with keys: landmark_quizzes, region_quizzes, trivia_quizzes.`,
          45000
        );
      }

      const toPersist: StoredGeneratedEntry[] = [];
      const createdAt = new Date().toISOString();

      const lmById = new Map(landmarksToGenerate.map((l) => [l.id, l]));
      for (const item of payload.landmark_quizzes ?? []) {
        const lm = lmById.get(item.place_id);
        if (!lm || !item.prompt?.trim() || !item.display_answer?.trim()) continue;
        const answers = (item.answers ?? []).map((a) => a.trim()).filter(Boolean);
        if (answers.length === 0) answers.push(item.display_answer.trim());

        const q: GeneratedQuestion = {
          id: lm.question_id,
          group_id: lm.question_id,
          type: 'landmark',
          language,
          prompt: item.prompt.trim(),
          clues: (item.clues ?? []).map((c) => c.trim()).filter(Boolean).slice(0, 2),
          answers,
          display_answer: item.display_answer.trim(),
          fun_fact: (item.fun_fact || '').trim(),
          source: 'generated',
        };
        finalLandmarks.push(lm);
        finalQuestions.push(q);
        newlyGenerated += 1;

        toPersist.push({
          place_key: normalizePlaceKey(lm.rawName),
          place_name: lm.rawName,
          kind: 'landmark',
          language,
          created_at: createdAt,
          question: q,
        });
      }

      const regById = new Map(regionsToGenerate.map((r) => [r.id, r]));
      for (const item of payload.region_quizzes ?? []) {
        const reg = regById.get(item.place_id);
        if (!reg || !item.prompt?.trim() || !item.display_answer?.trim()) continue;
        const answers = (item.answers ?? []).map((a) => a.trim()).filter(Boolean);
        if (answers.length === 0) answers.push(item.display_answer.trim());

        const updatedReg: DiscoveredRegion = {
          ...reg,
          welcome: item.welcome?.trim()
            ? { ...reg.welcome, [language]: item.welcome.trim() }
            : reg.welcome,
          greeting: item.greeting?.trim()
            ? { ...reg.greeting, [language]: item.greeting.trim() }
            : reg.greeting,
        };
        const q: GeneratedQuestion = {
          id: reg.question_id,
          group_id: reg.question_id,
          type: 'region',
          language,
          prompt: item.prompt.trim(),
          clues: [],
          answers,
          display_answer: item.display_answer.trim(),
          fun_fact: (item.fun_fact || '').trim(),
          source: 'generated',
        };
        finalRegions.push(updatedReg);
        finalQuestions.push(q);
        newlyGenerated += 1;

        toPersist.push({
          place_key: normalizePlaceKey(reg.rawName),
          place_name: reg.rawName,
          kind: 'region',
          language,
          created_at: createdAt,
          question: q,
          welcome: item.welcome?.trim(),
          greeting: item.greeting?.trim(),
        });
      }

      let triviaIdx = 0;
      for (const item of (payload.trivia_quizzes ?? []).slice(0, clampedTrivia)) {
        if (!item.prompt?.trim() || !item.display_answer?.trim()) continue;
        const answers = (item.answers ?? []).map((a) => a.trim()).filter(Boolean);
        if (answers.length === 0) answers.push(item.display_answer.trim());
        triviaIdx += 1;
        const qId = `q_gen_trivia_${Date.now()}_${triviaIdx}`;
        const q: GeneratedQuestion = {
          id: qId,
          group_id: qId,
          type: 'trivia',
          language,
          prompt: item.prompt.trim(),
          clues: [],
          answers,
          display_answer: item.display_answer.trim(),
          fun_fact: (item.fun_fact || '').trim(),
          source: 'generated',
        };
        finalQuestions.push(q);
        triviaGenerated += 1;
        newlyGenerated += 1;

        toPersist.push({
          place_key: `trivia_${qId}`,
          place_name: 'General Trivia',
          kind: 'trivia',
          language,
          created_at: createdAt,
          question: q,
        });
      }

      await appendGeneratedCache(dataDir, toPersist);
    } catch (err) {
      errors.push(`agent: ${err instanceof Error ? err.message : 'generation failed'}`);
    }
  }

  return {
    landmarks: finalLandmarks.sort((a, b) => a.at_m - b.at_m),
    regions: finalRegions.sort((a, b) => a.enter_at_m - b.enter_at_m),
    questions: finalQuestions,
    stats: {
      placesSource: discovered.source,
      discoveredLandmarks: finalLandmarks.length,
      discoveredRegions: finalRegions.length,
      reusedFromCache,
      newlyGenerated,
      triviaGenerated,
      durationMs: Date.now() - startedAt,
      provider,
      errors,
    },
  };
}
