export type VoiceCommand = 'skip' | 'repeat' | 'pause' | 'resume' | 'stop' | null;
export type OfferIntent = 'yes' | 'skip' | 'stop' | null;

export interface MatchResult {
  matched: boolean;
  matchedAnswer?: string;
  strategy: 'exact' | 'contained' | 'fuzzy' | 'none';
  distance?: number;
  normalizedTranscript: string;
}

/**
 * Lowercase, trim, collapse whitespace, and strip punctuation while preserving
 * Unicode letters & marks for Latin, Devanagari, and Tamil scripts.
 */
export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);

  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }

  return prev[b.length];
}

function maxAllowedDistance(targetLength: number): number {
  if (targetLength <= 3) return 0;
  if (targetLength <= 6) return 1;
  return 2;
}

/**
 * Section 5.4 Answer Judging:
 * Lowercase, trim, strip punctuation. Accept any listed answer (including local-script
 * and spelling variants), allow a small edit distance, and accept a sentence containing
 * the answer ("I think it is Hyderabad").
 */
export function judgeAnswer(transcript: string, acceptedAnswers: string[]): MatchResult {
  const normalized = normalizeText(transcript);
  if (!normalized) {
    return { matched: false, strategy: 'none', normalizedTranscript: '' };
  }

  const normalizedAnswers = acceptedAnswers
    .map((a) => ({ raw: a, norm: normalizeText(a) }))
    .filter((a) => a.norm.length > 0);

  // 1. Exact match
  for (const ans of normalizedAnswers) {
    if (normalized === ans.norm) {
      return {
        matched: true,
        matchedAnswer: ans.raw,
        strategy: 'exact',
        distance: 0,
        normalizedTranscript: normalized,
      };
    }
  }

  // 2. Contained as a word/phrase inside a longer sentence
  const paddedTranscript = ` ${normalized} `;
  for (const ans of normalizedAnswers) {
    if (paddedTranscript.includes(` ${ans.norm} `)) {
      return {
        matched: true,
        matchedAnswer: ans.raw,
        strategy: 'contained',
        distance: 0,
        normalizedTranscript: normalized,
      };
    }
    // Also allow direct substring containment for scripts where inflection attaches
    if (ans.norm.length >= 4 && normalized.includes(ans.norm)) {
      return {
        matched: true,
        matchedAnswer: ans.raw,
        strategy: 'contained',
        distance: 0,
        normalizedTranscript: normalized,
      };
    }
  }

  // 3. Fuzzy edit distance against whole transcript or sliding word windows
  const words = normalized.split(' ');
  for (const ans of normalizedAnswers) {
    const allowed = maxAllowedDistance(ans.norm.length);
    if (allowed === 0) continue;

    const wholeDist = levenshtein(normalized, ans.norm);
    if (wholeDist <= allowed) {
      return {
        matched: true,
        matchedAnswer: ans.raw,
        strategy: 'fuzzy',
        distance: wholeDist,
        normalizedTranscript: normalized,
      };
    }

    const ansWordCount = ans.norm.split(' ').length;
    for (let i = 0; i <= words.length - ansWordCount; i++) {
      const windowPhrase = words.slice(i, i + ansWordCount).join(' ');
      const dist = levenshtein(windowPhrase, ans.norm);
      if (dist <= allowed) {
        return {
          matched: true,
          matchedAnswer: ans.raw,
          strategy: 'fuzzy',
          distance: dist,
          normalizedTranscript: normalized,
        };
      }
    }
  }

  return {
    matched: false,
    strategy: 'none',
    normalizedTranscript: normalized,
  };
}

const COMMAND_SYNONYMS: Record<Exclude<VoiceCommand, null>, string[]> = {
  skip: ['skip', 'next', 'pass', 'छोड़ो', 'अगला', 'स्किप', 'தாவு', 'அடுத்தது'],
  repeat: ['repeat', 'again', 'say again', 'दोहराओ', 'फिर से', 'रिपीट', 'மீண்டும்', 'திருப்பி'],
  pause: ['pause', 'hold', 'wait', 'रुको', 'रोको', 'पॉज़', 'நிறுத்து', 'இடைநிறுத்து'],
  resume: ['resume', 'continue', 'start', 'शुरू', 'जारी', 'रिज्यूम', 'தொடர்', 'தொடங்கு'],
  stop: ['stop', 'end', 'quit', 'finish', 'बंद', 'खत्म', 'स्टॉप', 'முடி', 'போதும்'],
};

const QUIZ_REQUEST_HINTS = [
  'quiz',
  'question',
  'trivia',
  'game',
  'क्विज़',
  'क्विज',
  'सवाल',
  'प्रश्न',
  'வினாடி',
  'கேள்வி',
];

export function detectVoiceCommand(transcript: string): VoiceCommand {
  const norm = normalizeText(transcript);
  if (!norm) return null;

  const words = norm.split(' ');
  // Commands are short utterances (<= 4 words) to avoid false triggers inside full answers
  if (words.length > 4) return null;

  const mentionsQuiz = QUIZ_REQUEST_HINTS.some((hint) => norm.includes(normalizeText(hint)));

  for (const [cmd, phrases] of Object.entries(COMMAND_SYNONYMS) as Array<
    [Exclude<VoiceCommand, null>, string[]]
  >) {
    // Never swallow "start a quiz" / "क्विज़ शुरू करो" as a resume command
    if (cmd === 'resume' && mentionsQuiz) continue;

    for (const phrase of phrases) {
      const pNorm = normalizeText(phrase);
      if (norm === pNorm || ` ${norm} `.includes(` ${pNorm} `)) {
        return cmd;
      }
    }
  }
  return null;
}

const YES_SYNONYMS = [
  'yes',
  'yeah',
  'yep',
  'sure',
  'ready',
  'ok',
  'okay',
  'go ahead',
  'play',
  'हाँ',
  'हां',
  'जी',
  'तैयार',
  'चलो',
  'ஆம்',
  'சரி',
  'தயார்',
  'வாங்க',
];

const NO_SYNONYMS = [
  'no',
  'nope',
  'not now',
  'later',
  'skip',
  'नहीं',
  'अभी नहीं',
  'बाद में',
  'இல்லை',
  'வேண்டாம்',
];

export function detectOfferIntent(transcript: string): OfferIntent {
  const cmd = detectVoiceCommand(transcript);
  if (cmd === 'stop') return 'stop';
  if (cmd === 'skip') return 'skip';

  const norm = normalizeText(transcript);
  if (!norm) return null;

  for (const phrase of NO_SYNONYMS) {
    const p = normalizeText(phrase);
    if (norm === p || ` ${norm} `.includes(` ${p} `)) return 'skip';
  }
  for (const phrase of YES_SYNONYMS) {
    const p = normalizeText(phrase);
    if (norm === p || ` ${norm} `.includes(` ${p} `)) return 'yes';
  }
  return null;
}
