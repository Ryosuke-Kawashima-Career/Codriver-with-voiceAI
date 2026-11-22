import {
  ArrowUp,
  CornerUpLeft,
  CornerUpRight,
  GitFork,
  Pause,
  Play,
  RefreshCw,
  SkipForward,
  SlidersHorizontal,
  Square,
} from 'lucide-react';
import type { CoDriverActions, CoDriverState } from '../engine/useCoDriver';
import { HOST_SCRIPTS, LANGUAGES } from '../engine/i18n';
import { formatDistance } from '../engine/routeReplay';
import type { ManeuverIcon } from '../types';
import { RouteMapSvg } from './RouteMapSvg';
import { VoiceOrb } from './VoiceOrb';

interface DriveScreenProps {
  state: CoDriverState;
  actions: CoDriverActions;
  isDemoOpen: boolean;
  onToggleDemo: () => void;
}

function TurnArrowIcon({ icon, active }: { icon: ManeuverIcon; active: boolean }) {
  const cls = `w-8 h-8 sm:w-9 sm:h-9 shrink-0 ${active ? 'text-emerald-300' : 'text-white'}`;
  switch (icon) {
    case 'left':
      return <CornerUpLeft className={cls} aria-hidden="true" />;
    case 'right':
      return <CornerUpRight className={cls} aria-hidden="true" />;
    case 'exit':
      return <GitFork className={cls} aria-hidden="true" />;
    case 'roundabout':
      return <RefreshCw className={cls} aria-hidden="true" />;
    case 'straight':
    default:
      return <ArrowUp className={cls} aria-hidden="true" />;
  }
}

export function DriveScreen({ state, actions, isDemoOpen, onToggleDemo }: DriveScreenProps) {
  const scripts = HOST_SCRIPTS[state.language];
  const langMeta = LANGUAGES.find((l) => l.code === state.language) ?? LANGUAGES[0];
  const hasRoute = Boolean(state.route);
  const isPaused = state.phase === 'PAUSED';

  const channelLabel =
    state.activeChannel === 'directions' ? scripts.ui.directions : scripts.ui.quiz;
  const stateLabel = scripts.ui.states[state.phase];

  const nextManeuverText = state.nextManeuver
    ? state.nextManeuver.text[state.language] || state.nextManeuver.text['en-IN']
    : '';

  return (
    <div
      lang={state.language}
      className="h-[100dvh] w-full bg-[#0B0E14] text-[#F3F5F8] flex flex-col overflow-hidden"
    >
      {/* 1. Compact Status Bar: language · current region name */}
      <header className="shrink-0 h-12 sm:h-14 border-b border-white/[0.08] bg-[#0E121B]">
        <div className="max-w-7xl mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0 text-xs sm:text-sm">
            <span className="font-semibold text-white whitespace-nowrap shrink-0">Safar</span>
            <span className="text-slate-600" aria-hidden="true">
              ·
            </span>
            <span className="text-slate-300 whitespace-nowrap shrink-0">
              {langMeta.nativeLabel}
            </span>
            <span className="text-slate-600" aria-hidden="true">
              ·
            </span>
            <span className="text-emerald-300 font-medium truncate">{state.currentRegionName}</span>
          </div>

          <button
            type="button"
            onClick={onToggleDemo}
            className={`min-h-[36px] px-3 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              isDemoOpen
                ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/40'
                : 'text-slate-400 hover:text-white hover:bg-white/[0.06]'
            }`}
            title="Toggle Demo Panel (Press D)"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Demo (D)</span>
          </button>
        </div>
      </header>

      {/* Main non-scrolling cockpit body */}
      <main className="flex-1 min-h-0 w-full max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-5 flex flex-col">
        <div
          className={`flex-1 min-h-0 grid gap-3 sm:gap-5 ${
            hasRoute ? 'grid-cols-1 lg:grid-cols-12' : 'grid-cols-1 max-w-2xl mx-auto w-full'
          }`}
        >
          {/* Left / Top Navigation Column (hidden when No Route) */}
          {hasRoute && state.route && (
            <section className="lg:col-span-6 flex flex-col gap-3 min-h-0">
              {/* 2. Map Panel */}
              <div className="flex-1 min-h-[155px] sm:min-h-[210px]">
                <RouteMapSvg
                  route={state.route}
                  language={state.language}
                  progressM={state.progressM}
                  nextManeuver={state.nextManeuver}
                  isDirectionsFirst={state.isDirectionsFirst}
                  directionsFirstLabel={scripts.ui.directionsFirst}
                  landmarksPassed={state.stats.landmarksPassed}
                />
              </div>

              {/* 3. Next-Turn Strip (always in the same anchored position) */}
              <div
                className={`shrink-0 rounded-2xl border px-4 py-3.5 sm:px-5 sm:py-4 flex items-center gap-4 transition-colors duration-200 ${
                  state.isDirectionsFirst
                    ? 'bg-emerald-500/14 border-emerald-400/50'
                    : 'bg-[#141923] border-white/[0.08]'
                }`}
              >
                <div
                  className={`w-13 h-13 sm:w-14 sm:h-14 rounded-xl flex items-center justify-center shrink-0 ${
                    state.isDirectionsFirst ? 'bg-emerald-500/25' : 'bg-white/[0.06]'
                  }`}
                >
                  {state.nextManeuver && (
                    <TurnArrowIcon
                      icon={state.nextManeuver.icon}
                      active={state.isDirectionsFirst}
                    />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2.5">
                    <span className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-white whitespace-nowrap">
                      {state.distanceToNextManeuverM !== null
                        ? formatDistance(state.distanceToNextManeuverM)
                        : '—'}
                    </span>
                    {state.isDirectionsFirst && (
                      <span className="text-xs font-medium text-emerald-300 whitespace-nowrap">
                        {scripts.ui.directionsFirst}
                      </span>
                    )}
                  </div>
                  <p className="text-sm sm:text-base text-slate-200 font-medium leading-snug truncate mt-0.5">
                    {nextManeuverText}
                  </p>
                </div>
              </div>
            </section>
          )}

          {/* Right / Bottom Voice Co-Driver Column */}
          <section
            className={`${
              hasRoute ? 'lg:col-span-6' : ''
            } flex flex-col justify-between gap-3 min-h-0 bg-[#141923] border border-white/[0.08] rounded-2xl p-4 sm:p-6`}
          >
            {/* 4. Voice Orb + Channel Label */}
            <div className="shrink-0 flex flex-col items-center">
              <VoiceOrb
                channel={state.activeChannel}
                isSpeaking={state.isHostSpeaking}
                isListening={state.isListening}
                phase={state.phase}
                channelLabel={channelLabel}
              />
            </div>

            {/* 5. Caption Area: Host sentence + What the app heard, large legible script */}
            <div className="flex-1 min-h-0 flex flex-col justify-center gap-3 overflow-hidden px-1">
              <div className="text-center space-y-2">
                {state.activeClueStep && (
                  <p className="text-xs font-medium text-amber-300/90 tabular-nums">
                    Clue {state.activeClueStep.current} / {state.activeClueStep.total}
                  </p>
                )}

                <p
                  className={`text-lg sm:text-2xl font-medium leading-snug transition-colors ${
                    state.activeChannel === 'directions'
                      ? 'text-emerald-100'
                      : state.lastFeedbackTone === 'positive'
                        ? 'text-emerald-200'
                        : 'text-white'
                  }`}
                >
                  {state.hostCaption || scripts.offer}
                </p>
              </div>

              {/* Heard transcript line */}
              <div className="min-h-[36px] flex items-center justify-center text-center">
                {state.heardCaption ? (
                  <p className="text-sm sm:text-base text-amber-200/95">
                    <span className="text-slate-400 mr-2">{scripts.ui.heardPrefix}:</span>
                    <span>&ldquo;{state.heardCaption}&rdquo;</span>
                  </p>
                ) : state.isListening ? (
                  <p className="text-xs sm:text-sm text-slate-400">{scripts.ui.listeningHint}</p>
                ) : null}
              </div>
            </div>

            {/* 6. State Label & Score (no timers, no streaks, no red wrong styling) */}
            <div className="shrink-0 flex items-center justify-between gap-4 pt-3 border-t border-white/[0.08] text-sm">
              <div className="flex items-center gap-2 text-slate-300">
                <span className="font-medium text-white">{stateLabel}</span>
                {state.activeQuestionType && state.phase !== 'PAUSED' && state.phase !== 'IDLE' && (
                  <>
                    <span className="text-slate-600" aria-hidden="true">
                      ·
                    </span>
                    <span className="text-xs text-slate-400 capitalize">
                      {state.activeQuestionType}
                    </span>
                  </>
                )}
              </div>

              <div className="flex items-center gap-2 tabular-nums">
                <span className="text-slate-400">{scripts.ui.correctAnswers}</span>
                <span className="text-lg font-bold text-emerald-300 font-mono">
                  {state.stats.correctCount}
                </span>
              </div>
            </div>

            {/* 7. Large Touch Controls (>= 56px height) */}
            <div className="shrink-0 grid grid-cols-3 gap-2.5 sm:gap-3 pt-1">
              <button
                type="button"
                onClick={actions.togglePause}
                className={`min-h-[56px] px-3 rounded-xl font-semibold text-sm sm:text-base flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
                  isPaused
                    ? 'bg-emerald-500 text-[#07120E] hover:bg-emerald-400'
                    : 'bg-[#1D2433] hover:bg-[#252E42] text-white border border-white/[0.08]'
                }`}
              >
                {isPaused ? (
                  <>
                    <Play className="w-4 h-4 sm:w-5 sm:h-5 shrink-0" aria-hidden="true" />
                    <span>{scripts.ui.resume}</span>
                  </>
                ) : (
                  <>
                    <Pause className="w-4 h-4 sm:w-5 sm:h-5 shrink-0" aria-hidden="true" />
                    <span>{scripts.ui.pause}</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={actions.skipCurrent}
                disabled={isPaused}
                className="min-h-[56px] px-3 rounded-xl bg-[#1D2433] hover:bg-[#252E42] disabled:opacity-45 text-white border border-white/[0.08] font-semibold text-sm sm:text-base flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
              >
                <SkipForward className="w-4 h-4 sm:w-5 sm:h-5 shrink-0" aria-hidden="true" />
                <span>{scripts.ui.skip}</span>
              </button>

              <button
                type="button"
                onClick={() => void actions.stopSession()}
                className="min-h-[56px] px-3 rounded-xl bg-[#242B3B] hover:bg-[#2E374C] text-slate-100 border border-white/[0.1] font-semibold text-sm sm:text-base flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
              >
                <Square className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{scripts.ui.stop}</span>
              </button>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
