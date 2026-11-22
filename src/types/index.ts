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
}

export type LocalizedText = Record<LanguageCode, string>;

export type ManeuverIcon = 'left' | 'right' | 'exit' | 'roundabout' | 'straight';

export interface Maneuver {
  id: string;
  at_m: number;
  icon: ManeuverIcon;
  text: LocalizedText;
}

export interface Landmark {
  id: string;
  name: LocalizedText;
  at_m: number;
  lat: number;
  lon: number;
  question_id: string;
}

export interface Region {
  id: string;
  name: LocalizedText;
  enter_at_m: number;
  welcome: LocalizedText;
  greeting: string;
  question_id: string;
}

export interface RouteData {
  route_id: string;
  name: LocalizedText;
  subtitle: LocalizedText;
  length_m: number;
  start_region: LocalizedText;
  path: [number, number][];
  maneuvers: Maneuver[];
  landmarks: Landmark[];
  regions: Region[];
}

export interface RouteSummary {
  route_id: string;
  name: LocalizedText;
  subtitle: LocalizedText;
  length_m: number;
  maneuver_count: number;
  landmark_count: number;
  region_count: number;
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
  kind: 'speech' | 'transcript' | 'event';
  decision?: ArbiterDecision;
  channel?: SpeechChannel;
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
