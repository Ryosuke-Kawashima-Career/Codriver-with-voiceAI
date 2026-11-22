import { motion, useReducedMotion } from 'motion/react';
import { Mic, Navigation, Pause, Volume2 } from 'lucide-react';
import type { QuizPhase, SpeechChannel } from '../types';

interface VoiceOrbProps {
  channel: SpeechChannel;
  isSpeaking: boolean;
  isListening: boolean;
  phase: QuizPhase;
  channelLabel: string;
}

export function VoiceOrb({
  channel,
  isSpeaking,
  isListening,
  phase,
  channelLabel,
}: VoiceOrbProps) {
  const prefersReduced = useReducedMotion();
  const isPaused = phase === 'PAUSED';
  const isDirections = channel === 'directions';

  // Light-mode automotive palette: Highway Emerald for Directions, Warm Amber for Quiz
  const ringStroke = isDirections
    ? 'border-emerald-500/45'
    : isListening
      ? 'border-amber-500/55'
      : 'border-amber-500/35';

  const coreBg = isPaused
    ? 'bg-slate-100 border-slate-300 text-slate-500'
    : isDirections
      ? 'bg-emerald-50 border-emerald-500 text-emerald-700'
      : isListening
        ? 'bg-amber-50 border-amber-500 text-amber-800'
        : 'bg-amber-50/80 border-amber-400 text-amber-700';

  const glowColor = isPaused
    ? 'rgba(100, 116, 139, 0.06)'
    : isDirections
      ? 'rgba(5, 150, 105, 0.18)'
      : 'rgba(217, 119, 6, 0.18)';

  const animateRing1 =
    prefersReduced || isPaused
      ? { scale: 1, opacity: 0.25 }
      : isSpeaking
        ? { scale: [1, 1.32, 1.08, 1.28, 1], opacity: [0.55, 0.16, 0.42, 0.14, 0.55] }
        : isListening
          ? { scale: [1, 1.22, 1], opacity: [0.5, 0.14, 0.5] }
          : { scale: 1, opacity: 0.2 };

  const animateRing2 =
    prefersReduced || isPaused
      ? { scale: 1, opacity: 0.14 }
      : isSpeaking
        ? { scale: [1.05, 1.48, 1.15, 1.42, 1.05], opacity: [0.35, 0.06, 0.28, 0.08, 0.35] }
        : isListening
          ? { scale: [1.04, 1.36, 1.04], opacity: [0.32, 0.08, 0.32] }
          : { scale: 1.04, opacity: 0.1 };

  const transition = isSpeaking
    ? { duration: 1.25, repeat: Infinity, ease: 'easeInOut' as const }
    : isListening
      ? { duration: 2.1, repeat: Infinity, ease: 'easeInOut' as const }
      : { duration: 0.3 };

  return (
    <div className="flex flex-col items-center justify-center gap-2 py-1">
      <div className="relative flex items-center justify-center w-24 h-24 sm:w-28 sm:h-28">
        <div
          className="absolute inset-0 rounded-full blur-xl pointer-events-none transition-opacity duration-300"
          style={{
            background: `radial-gradient(circle, ${glowColor} 0%, transparent 72%)`,
            opacity: isPaused ? 0.3 : 1,
          }}
        />

        <motion.div
          aria-hidden="true"
          className={`absolute inset-1 rounded-full border ${ringStroke}`}
          animate={animateRing2}
          transition={transition}
        />

        <motion.div
          aria-hidden="true"
          className={`absolute inset-3 rounded-full border ${ringStroke}`}
          animate={animateRing1}
          transition={transition}
        />

        <motion.div
          className={`relative z-10 flex items-center justify-center w-16 h-16 sm:w-20 sm:h-20 rounded-full border-2 shadow-sm transition-colors duration-200 ${coreBg}`}
          animate={
            prefersReduced || isPaused
              ? { scale: 1 }
              : isSpeaking
                ? { scale: [1, 1.06, 0.98, 1.04, 1] }
                : isListening
                  ? { scale: [1, 1.04, 1] }
                  : { scale: 1 }
          }
          transition={transition}
        >
          {isPaused ? (
            <Pause className="w-6 h-6 sm:w-7 sm:h-7" aria-hidden="true" />
          ) : isDirections ? (
            <Navigation className="w-6 h-6 sm:w-7 sm:h-7" aria-hidden="true" />
          ) : isListening ? (
            <Mic className="w-6 h-6 sm:w-7 sm:h-7" aria-hidden="true" />
          ) : (
            <Volume2 className="w-6 h-6 sm:w-7 sm:h-7" aria-hidden="true" />
          )}
        </motion.div>
      </div>

      <div className="flex items-center gap-2 text-xs sm:text-sm font-semibold tracking-wide">
        <span className={isDirections ? 'text-emerald-700' : 'text-amber-700'}>{channelLabel}</span>
      </div>
    </div>
  );
}
