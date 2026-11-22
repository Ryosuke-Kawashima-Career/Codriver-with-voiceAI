export type LanguageCode = 'en-IN' | 'hi-IN' | 'ta-IN';

export type QuestionType = 'landmark' | 'region' | 'trivia';

export interface Question {
  id: string;
  group_id?: string;
  type: QuestionType;
  language: LanguageCode;
  prompt: string;
  clues: string[];
  answers: string[];
  display_answer: string;
  fun_fact: string;
  source?: 'curated' | 'generated';
}

export type LocalizedText = Record<LanguageCode, string>;

export type ManeuverIcon = 'left' | 'right' | 'exit' | 'roundabout' | 'straight' | 'arrive';

export interface Maneuver {
  id: string;
  at_m: number;
  icon: ManeuverIcon;
  text: LocalizedText;
  text_early?: Partial<LocalizedText>;
}

export interface Landmark {
  id: string;
  name: LocalizedText;
  at_m: number;
  lat: number;
  lon: number;
  question_id: string;
  source?: 'curated' | 'osm';
}

export interface Region {
  id: string;
  name: LocalizedText;
  enter_at_m: number;
  welcome: LocalizedText;
  greeting: LocalizedText;
  question_id: string;
  source?: 'curated' | 'osm';
}

export interface RouteData {
  route_id: string;
  name: LocalizedText;
  subtitle?: LocalizedText;
  length_m: number;
  duration_s?: number;
  start_region: LocalizedText;
  path: [number, number][];
  maneuvers: Maneuver[];
  landmarks: Landmark[];
  regions: Region[];
  provider?: 'google-routes' | 'osrm' | 'fallback';
}

export interface GeocodeResult {
  id: string;
  name: string;
  address: string;
  lat: number;
  lon: number;
  distance_m?: number;
}

export interface GpsFix {
  lat: number;
  lon: number;
  accuracyM: number;
  locationName?: string;
  isDemoFallback?: boolean;
}

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

export interface AgentTurnResponse {
  intent: AgentIntent;
  reply: string;
  question?: Question;
  provider?: 'gemini' | 'anthropic';
  latencyMs?: number;
}

export interface AgentQuizStats {
  placesSource: 'overpass' | 'nominatim' | 'none';
  discoveredLandmarks: number;
  discoveredRegions: number;
  reusedFromCache: number;
  newlyGenerated: number;
  triviaGenerated: number;
  durationMs: number;
  provider: 'gemini' | 'anthropic' | 'none';
  errors: string[];
}

export interface AgentQuizResponse {
  landmarks: Landmark[];
  regions: Region[];
  questions: Question[];
  stats: AgentQuizStats;
}

export type AppScreen = 'home' | 'drive' | 'summary';

export type QuizPhase =
  | 'IDLE'
  | 'OFFER'
  | 'ASK'
  | 'LISTEN'
  | 'JUDGE'
  | 'FEEDBACK'
  | 'PAUSED';

export type SpeechChannel = 'directions' | 'quiz';

export type DemoSpeed = 1 | 5 | 20;

export type ArbiterDecision = 'played' | 'held' | 'dropped' | 'interrupted';

export interface DebugLogEntry {
  id: string;
  timestamp: string;
  distanceM: number;
  kind: 'speech' | 'transcript' | 'event' | 'gps' | 'agent';
  decision?: ArbiterDecision;
  channel?: SpeechChannel;
  intent?: AgentIntent;
  summary: string;
  detail?: string;
}

export interface PassedStop {
  id: string;
  name: string;
  answeredCorrectly: boolean;
  asked: boolean;
}

export interface SessionStats {
  questionsAsked: number;
  correctCount: number;
  landmarksPassed: PassedStop[];
  regionsPassed: PassedStop[];
}
