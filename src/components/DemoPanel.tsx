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
  hasLandmarks: boolean;
  hasRegions: boolean;
  isSimPlaying: boolean;
  isSimulatedMode: boolean;
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
  hasLandmarks,
  hasRegions,
  isSimPlaying,
  isSimulatedMode,
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
      className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-white/98 backdrop-blur-md border-l border-slate-200 shadow-2xl flex flex-col text-slate-900"
    >
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Demo Panel</h2>
          <p className="text-xs text-slate-500">
            Press D to hide · {isSimulatedMode ? 'Simulated replay (GPS paused)' : 'Live GPS active'}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close demo panel"
          className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-6">
        {hasRoute && (
          <section className="space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span className="font-semibold text-slate-900">Route Replay</span>
              <span className="font-mono tabular-nums">
                {formatDistance(progressM)}
                {isDirectionsFirst ? ' · Directions-first zone' : ''}
              </span>
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={onToggleSimPlay}
                className={`flex-1 min-h-[44px] px-4 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap ${
                  isSimPlaying
                    ? 'bg-amber-100 border border-amber-300 text-amber-950 hover:bg-amber-200/80'
                    : 'bg-emerald-600 text-white hover:bg-emerald-700'
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

              <div className="flex items-center p-1 rounded-xl bg-slate-100 border border-slate-200">
                {SPEEDS.map((spd) => (
                  <button
                    key={spd}
                    type="button"
                    onClick={() => onSetSimSpeed(spd)}
                    className={`px-3 min-h-[36px] rounded-lg text-xs font-mono font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      simSpeed === spd
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {spd}x
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={onJumpNextTurn}
                className="min-h-[44px] px-2.5 py-2 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-xs font-medium text-slate-800 flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
              >
                <CornerUpRight className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>Next turn</span>
              </button>
              <button
                type="button"
                onClick={onJumpNextLandmark}
                disabled={!hasLandmarks}
                title={
                  hasLandmarks
                    ? 'Jump ~2 km before next landmark'
                    : 'No curated landmarks within 5 km of this route'
                }
                className="min-h-[44px] px-2.5 py-2 rounded-xl bg-slate-50 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed border border-slate-200 text-xs font-medium text-slate-800 flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
              >
                <MapPin className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span>Landmark</span>
              </button>
              <button
                type="button"
                onClick={onJumpNextRegion}
                disabled={!hasRegions}
                title={
                  hasRegions
                    ? 'Jump right before next region boundary'
                    : 'No curated regions entered by this route'
                }
                className="min-h-[44px] px-2.5 py-2 rounded-xl bg-slate-50 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed border border-slate-200 text-xs font-medium text-slate-800 flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Flag className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                <span>Region</span>
              </button>
            </div>
            {!hasLandmarks && !hasRegions && (
              <p className="text-[11px] text-slate-500">
                This route passes no curated places from the seed list, so trivia-only rounds will
                play along the drive.
              </p>
            )}
          </section>
        )}

        <section className="space-y-3 pt-4 border-t border-slate-200">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-900">Type an answer or voice command</span>
            <span className="text-slate-500">Fallback input</span>
          </div>

          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              type="text"
              value={typedText}
              onChange={(e) => setTypedText(e.target.value)}
              placeholder='e.g. "yes", "Kapil Dev", "skip", "repeat"'
              className="flex-1 min-h-[44px] px-3.5 rounded-xl bg-slate-50 border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-emerald-600"
            />
            <button
              type="submit"
              aria-label="Send answer"
              className="min-h-[44px] px-4 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-semibold text-sm flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Send className="w-4 h-4" />
              <span>Send</span>
            </button>
          </form>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onSubmitTyped('yes')}
              className="px-3 min-h-[36px] rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-medium text-slate-800 transition-colors cursor-pointer"
            >
              Say &ldquo;Yes&rdquo;
            </button>
            <button
              type="button"
              onClick={onRepeat}
              className="px-3 min-h-[36px] rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-medium text-slate-800 inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Repeat</span>
            </button>
            <button
              type="button"
              onClick={onOfferNow}
              className="px-3 min-h-[36px] rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-medium text-slate-800 inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <MessageSquare className="w-3 h-3" />
              <span>Offer trivia</span>
            </button>
          </div>
        </section>

        <section className="space-y-2.5 pt-4 border-t border-slate-200">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-900">
              Speech Arbiter &amp; Transcript Debug
            </span>
            <span className="font-mono text-slate-500 tabular-nums">{debugLogs.length} events</span>
          </div>

          <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
            {debugLogs.length === 0 ? (
              <p className="text-xs text-slate-500 py-3">
                Arbiter decisions (played, held, dropped, interrupted), GPS snaps, and transcript
                matches appear here.
              </p>
            ) : (
              debugLogs.map((log) => (
                <div
                  key={log.id}
                  className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between gap-2 font-mono text-[11px] text-slate-500 tabular-nums">
                    <span>
                      {log.timestamp} · {formatDistance(log.distanceM)}
                    </span>
                    {log.decision && (
                      <span
                        className={`font-semibold ${
                          log.decision === 'played'
                            ? 'text-emerald-700'
                            : log.decision === 'interrupted'
                              ? 'text-sky-700'
                              : 'text-amber-700'
                        }`}
                      >
                        {log.decision}
                      </span>
                    )}
                  </div>
                  <div className="text-slate-900 leading-snug">{log.summary}</div>
                  {log.detail && (
                    <div className="text-slate-500 text-[11px] truncate" title={log.detail}>
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
