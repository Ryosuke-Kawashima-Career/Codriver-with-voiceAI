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

  // Color system: Highway Emerald for Directions, Warm Amber Gold for Quiz
  const ringStroke = isDirections
    ? 'border-emerald-400/45'
    : isListening
      ? 'border-amber-300/50'
      : 'border-amber-400/35';

  const coreBg = isPaused
    ? 'bg-[#1D2432] border-white/15 text-slate-300'
    : isDirections
      ? 'bg-emerald-500/20 border-emerald-400/70 text-emerald-200'
      : isListening
        ? 'bg-amber-400/20 border-amber-300/80 text-amber-100'
        : 'bg-amber-500/15 border-amber-400/55 text-amber-200';

  const glowColor = isPaused
    ? 'rgba(148, 163, 184, 0.04)'
    : isDirections
      ? 'rgba(16, 185, 129, 0.24)'
      : 'rgba(245, 158, 11, 0.22)';

  const animateRing1 =
    prefersReduced || isPaused
      ? { scale: 1, opacity: 0.2 }
      : isSpeaking
        ? { scale: [1, 1.32, 1.08, 1.28, 1], opacity: [0.45, 0.14, 0.35, 0.12, 0.45] }
        : isListening
          ? { scale: [1, 1.22, 1], opacity: [0.45, 0.12, 0.45] }
          : { scale: 1, opacity: 0.16 };

  const animateRing2 =
    prefersReduced || isPaused
      ? { scale: 1, opacity: 0.12 }
      : isSpeaking
        ? { scale: [1.05, 1.48, 1.15, 1.42, 1.05], opacity: [0.3, 0.05, 0.24, 0.06, 0.3] }
        : isListening
          ? { scale: [1.04, 1.36, 1.04], opacity: [0.28, 0.06, 0.28] }
          : { scale: 1.04, opacity: 0.08 };

  const transition = isSpeaking
    ? { duration: 1.25, repeat: Infinity, ease: 'easeInOut' as const }
    : isListening
      ? { duration: 2.1, repeat: Infinity, ease: 'easeInOut' as const }
      : { duration: 0.3 };

  return (
    <div className="flex flex-col items-center justify-center gap-2.5 py-1">
      <div className="relative flex items-center justify-center w-24 h-24 sm:w-28 sm:h-28">
        {/* Soft radial aura */}
        <div
          className="absolute inset-0 rounded-full blur-xl pointer-events-none transition-opacity duration-300"
          style={{
            background: `radial-gradient(circle, ${glowColor} 0%, transparent 72%)`,
            opacity: isPaused ? 0.3 : 1,
          }}
        />

        {/* Outer acoustic ring */}
        <motion.div
          aria-hidden="true"
          className={`absolute inset-1 rounded-full border ${ringStroke}`}
          animate={animateRing2}
          transition={transition}
        />

        {/* Inner acoustic ring */}
        <motion.div
          aria-hidden="true"
          className={`absolute inset-3 rounded-full border ${ringStroke}`}
          animate={animateRing1}
          transition={transition}
        />

        {/* Core orb */}
        <motion.div
          className={`relative z-10 flex items-center justify-center w-16 h-16 sm:w-20 sm:h-20 rounded-full border-2 transition-colors duration-200 ${coreBg}`}
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

      {/* Explicit Directions vs Quiz label (clean unboxed text) */}
      <div className="flex items-center gap-2 text-xs sm:text-sm font-semibold tracking-wide">
        <span className={isDirections ? 'text-emerald-300' : 'text-amber-300'}>{channelLabel}</span>
      </div>
    </div>
  );
}
