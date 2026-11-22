import { useState, type FormEvent } from 'react';
import {
  CornerUpRight,
  Flag,
  MapPin,
  MessageSquare,
  Pause,
  Play,
  RotateCcw,
  Send,
  X,
} from 'lucide-react';
import type { DebugLogEntry, DemoSpeed } from '../types';
import { formatDistance } from '../engine/routeReplay';

interface DemoPanelProps {
  isOpen: boolean;
  onClose: () => void;
  hasRoute: boolean;
  isSimPlaying: boolean;
  simSpeed: DemoSpeed;
  progressM: number;
  isDirectionsFirst: boolean;
  debugLogs: DebugLogEntry[];
  onToggleSimPlay: () => void;
  onSetSimSpeed: (speed: DemoSpeed) => void;
  onJumpNextTurn: () => void;
  onJumpNextLandmark: () => void;
  onJumpNextRegion: () => void;
  onSubmitTyped: (text: string) => void;
  onRepeat: () => void;
  onOfferNow: () => void;
}

const SPEEDS: DemoSpeed[] = [1, 5, 20];

export function DemoPanel({
  isOpen,
  onClose,
  hasRoute,
  isSimPlaying,
  simSpeed,
  progressM,
  isDirectionsFirst,
  debugLogs,
  onToggleSimPlay,
  onSetSimSpeed,
  onJumpNextTurn,
  onJumpNextLandmark,
  onJumpNextRegion,
  onSubmitTyped,
  onRepeat,
  onOfferNow,
}: DemoPanelProps) {
  const [typedText, setTypedText] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!typedText.trim()) return;
    onSubmitTyped(typedText.trim());
    setTypedText('');
  };

  return (
    <aside
      aria-label="Demo controls panel"
      className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-[#101520]/96 backdrop-blur-md border-l border-white/10 shadow-2xl flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08]">
        <div>
          <h2 className="text-sm font-semibold text-white">Demo Panel</h2>
          <p className="text-xs text-slate-400">Press D to hide · Reviewer controls</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close demo panel"
          className="w-10 h-10 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-slate-300 flex items-center justify-center transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-6">
        {/* Route simulation replay controls */}
        {hasRoute && (
          <section className="space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-medium text-slate-200">Route Replay</span>
              <span className="font-mono tabular-nums">
                {formatDistance(progressM)}
                {isDirectionsFirst ? ' · Directions-first zone' : ''}
              </span>
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={onToggleSimPlay}
                className={`flex-1 min-h-[44px] px-4 rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition-colors whitespace-nowrap ${
                  isSimPlaying
                    ? 'bg-amber-500/20 border border-amber-400/50 text-amber-200 hover:bg-amber-500/25'
                    : 'bg-emerald-500 text-[#07120E] hover:bg-emerald-400'
                }`}
              >
                {isSimPlaying ? (
                  <>
                    <Pause className="w-4 h-4" />
                    <span>Pause Car</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    <span>Play Car</span>
                  </>
                )}
              </button>

              {/* Speed segmented control */}
              <div className="flex items-center p-1 rounded-xl bg-[#1A2130] border border-white/[0.07]">
                {SPEEDS.map((spd) => (
                  <button
                    key={spd}
                    type="button"
                    onClick={() => onSetSimSpeed(spd)}
                    className={`px-3 min-h-[36px] rounded-lg text-xs font-mono font-semibold transition-colors whitespace-nowrap ${
                      simSpeed === spd
                        ? 'bg-white text-[#0B0E14]'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    {spd}x
                  </button>
                ))}
              </div>
            </div>

            {/* Jump buttons */}
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={onJumpNextTurn}
                className="min-h-[44px] px-2.5 py-2 rounded-xl bg-[#1A2130] hover:bg-[#232C3F] border border-white/[0.08] text-xs font-medium text-slate-200 flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
              >
                <CornerUpRight className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Next turn</span>
              </button>
              <button
                type="button"
                onClick={onJumpNextLandmark}
                className="min-h-[44px] px-2.5 py-2 rounded-xl bg-[#1A2130] hover:bg-[#232C3F] border border-white/[0.08] text-xs font-medium text-slate-200 flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
              >
                <MapPin className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>Landmark</span>
              </button>
              <button
                type="button"
                onClick={onJumpNextRegion}
                className="min-h-[44px] px-2.5 py-2 rounded-xl bg-[#1A2130] hover:bg-[#232C3F] border border-white/[0.08] text-xs font-medium text-slate-200 flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
              >
                <Flag className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                <span>Region</span>
              </button>
            </div>
          </section>
        )}

        {/* Typed answer & voice command fallback */}
        <section className="space-y-3 pt-4 border-t border-white/[0.08]">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-200">Type an answer or voice command</span>
            <span className="text-slate-400">Fallback input</span>
          </div>

          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              type="text"
              value={typedText}
              onChange={(e) => setTypedText(e.target.value)}
              placeholder='e.g. "yes", "Kapil Dev", "skip", "repeat"'
              className="flex-1 min-h-[44px] px-3.5 rounded-xl bg-[#18202E] border border-white/10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-400"
            />
            <button
              type="submit"
              aria-label="Send answer"
              className="min-h-[44px] px-4 rounded-xl bg-amber-400 hover:bg-amber-300 text-[#0B0E14] font-semibold text-sm flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <Send className="w-4 h-4" />
              <span>Send</span>
            </button>
          </form>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onSubmitTyped('yes')}
              className="px-3 min-h-[36px] rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs text-slate-200 transition-colors"
            >
              Say &ldquo;Yes&rdquo;
            </button>
            <button
              type="button"
              onClick={onRepeat}
              className="px-3 min-h-[36px] rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs text-slate-200 inline-flex items-center gap-1.5 transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Repeat</span>
            </button>
            <button
              type="button"
              onClick={onOfferNow}
              className="px-3 min-h-[36px] rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs text-slate-200 inline-flex items-center gap-1.5 transition-colors"
            >
              <MessageSquare className="w-3 h-3" />
              <span>Offer trivia</span>
            </button>
          </div>
        </section>

        {/* Speech Arbiter & Transcript Debug Log */}
        <section className="space-y-2.5 pt-4 border-t border-white/[0.08]">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-200">Speech Arbiter &amp; Transcript Debug</span>
            <span className="font-mono text-slate-400 tabular-nums">{debugLogs.length} events</span>
          </div>

          <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
            {debugLogs.length === 0 ? (
              <p className="text-xs text-slate-500 py-3">
                Arbiter decisions (played, held, dropped, interrupted) and transcript matches will
                appear here.
              </p>
            ) : (
              debugLogs.map((log) => (
                <div
                  key={log.id}
                  className="rounded-xl bg-[#161D2B] border border-white/[0.06] px-3 py-2 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between gap-2 font-mono text-[11px] text-slate-400 tabular-nums">
                    <span>
                      {log.timestamp} · {formatDistance(log.distanceM)}
                    </span>
                    {log.decision && (
                      <span
                        className={`font-semibold ${
                          log.decision === 'played'
                            ? 'text-emerald-300'
                            : log.decision === 'interrupted'
                              ? 'text-sky-300'
                              : 'text-amber-300'
                        }`}
                      >
                        {log.decision}
                      </span>
                    )}
                  </div>
                  <div className="text-slate-200 leading-snug">{log.summary}</div>
                  {log.detail && (
                    <div className="text-slate-400 text-[11px] truncate" title={log.detail}>
                      {log.detail}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </aside>
  );
}
