import {
  ArrowUp,
  CornerUpLeft,
  CornerUpRight,
  Flag,
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
import { GoogleRouteMap } from './GoogleRouteMap';
import { VoiceOrb } from './VoiceOrb';

interface DriveScreenProps {
  state: CoDriverState;
  actions: CoDriverActions;
  googleMapsApiKey: string;
  isDemoOpen: boolean;
  onToggleDemo: () => void;
}

function TurnArrowIcon({ icon, active }: { icon: ManeuverIcon; active: boolean }) {
  const cls = `w-8 h-8 sm:w-9 sm:h-9 shrink-0 ${active ? 'text-white' : 'text-emerald-700'}`;
  switch (icon) {
    case 'left':
      return <CornerUpLeft className={cls} aria-hidden="true" />;
    case 'right':
      return <CornerUpRight className={cls} aria-hidden="true" />;
    case 'exit':
      return <GitFork className={cls} aria-hidden="true" />;
    case 'roundabout':
      return <RefreshCw className={cls} aria-hidden="true" />;
    case 'arrive':
      return <Flag className={cls} aria-hidden="true" />;
    case 'straight':
    default:
      return <ArrowUp className={cls} aria-hidden="true" />;
  }
}

export function DriveScreen({
  state,
  actions,
  googleMapsApiKey,
  isDemoOpen,
  onToggleDemo,
}: DriveScreenProps) {
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
      className="h-[100dvh] w-full bg-[#F8FAFC] text-[#0F172A] flex flex-col overflow-hidden"
    >
      {/* 1. Status Bar: language · current region name */}
      <header className="shrink-0 h-12 sm:h-14 border-b border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0 text-xs sm:text-sm">
            <span className="font-bold text-slate-900 whitespace-nowrap shrink-0">Safar</span>
            <span className="text-slate-300" aria-hidden="true">
              ·
            </span>
            <span className="text-slate-600 whitespace-nowrap shrink-0">
              {langMeta.nativeLabel}
            </span>
            <span className="text-slate-300" aria-hidden="true">
              ·
            </span>
            <span className="text-emerald-700 font-semibold truncate">
              {state.currentRegionName}
            </span>
          </div>

          <button
            type="button"
            onClick={onToggleDemo}
            className={`min-h-[36px] px-3 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              isDemoOpen
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-300'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
            title="Toggle Demo Panel (Press D)"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Demo (D)</span>
          </button>
        </div>
      </header>

      {/* Main non-scrolling cockpit */}
      <main className="flex-1 min-h-0 w-full max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-5 flex flex-col">
        <div
          className={`flex-1 min-h-0 grid gap-3 sm:gap-5 ${
            hasRoute ? 'grid-cols-1 lg:grid-cols-12' : 'grid-cols-1 max-w-2xl mx-auto w-full'
          }`}
        >
          {/* Left / Top Navigation Column (hidden in Quiz-Only mode) */}
          {hasRoute && state.route && (
            <section className="lg:col-span-6 flex flex-col gap-3 min-h-0">
              {/* 2. Real Google Map Panel */}
              <div className="flex-1 min-h-[175px] sm:min-h-[220px]">
                <GoogleRouteMap
                  apiKey={googleMapsApiKey}
                  route={state.route}
                  language={state.language}
                  progressM={state.progressM}
                  nextManeuver={state.nextManeuver}
                  isDirectionsFirst={state.isDirectionsFirst}
                  directionsFirstLabel={scripts.ui.directionsFirst}
                  landmarksPassed={state.stats.landmarksPassed}
                />
              </div>

              {/* 3. Next-Turn Strip (anchored in the same spot) */}
              <div
                className={`shrink-0 rounded-2xl border px-4 py-3.5 sm:px-5 sm:py-4 flex items-center gap-4 transition-colors duration-200 ${
                  state.isDirectionsFirst
                    ? 'bg-emerald-600 border-emerald-700 text-white shadow-sm'
                    : 'bg-white border-slate-200 text-slate-900 shadow-xs'
                }`}
              >
                <div
                  className={`w-13 h-13 sm:w-14 sm:h-14 rounded-xl flex items-center justify-center shrink-0 ${
                    state.isDirectionsFirst ? 'bg-white/20' : 'bg-emerald-50 border border-emerald-100'
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
                    <span
                      className={`text-xl sm:text-2xl font-bold font-mono tabular-nums whitespace-nowrap ${
                        state.isDirectionsFirst ? 'text-white' : 'text-slate-900'
                      }`}
                    >
                      {state.distanceToNextManeuverM !== null
                        ? formatDistance(state.distanceToNextManeuverM)
                        : '—'}
                    </span>
                    {state.isDirectionsFirst && (
                      <span className="text-xs font-semibold text-emerald-100 whitespace-nowrap">
                        {scripts.ui.directionsFirst}
                      </span>
                    )}
                  </div>
                  <p
                    className={`text-sm sm:text-base font-medium leading-snug truncate mt-0.5 ${
                      state.isDirectionsFirst ? 'text-emerald-50' : 'text-slate-700'
                    }`}
                  >
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
            } flex flex-col justify-between gap-3 min-h-0 bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 shadow-xs`}
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

            {/* 5. Caption Area */}
            <div className="flex-1 min-h-0 flex flex-col justify-center gap-3 overflow-hidden px-1">
              <div className="text-center space-y-2">
                {state.activeClueStep && (
                  <p className="text-xs font-semibold text-amber-700 tabular-nums">
                    Clue {state.activeClueStep.current} / {state.activeClueStep.total}
                  </p>
                )}

                <p
                  className={`text-lg sm:text-2xl font-semibold leading-snug transition-colors ${
                    state.activeChannel === 'directions'
                      ? 'text-emerald-800'
                      : state.lastFeedbackTone === 'positive'
                        ? 'text-emerald-700'
                        : 'text-slate-900'
                  }`}
                >
                  {state.hostCaption || scripts.offer}
                </p>
              </div>

              {/* What the app heard */}
              <div className="min-h-[36px] flex items-center justify-center text-center">
                {state.heardCaption ? (
                  <p className="text-sm sm:text-base text-amber-800 font-medium">
                    <span className="text-slate-500 font-normal mr-2">
                      {scripts.ui.heardPrefix}:
                    </span>
                    <span>&ldquo;{state.heardCaption}&rdquo;</span>
                  </p>
                ) : state.isListening ? (
                  <p className="text-xs sm:text-sm text-slate-500">{scripts.ui.listeningHint}</p>
                ) : null}
              </div>
            </div>

            {/* 6. State Label & Score (no timers, no streaks, no red wrong styling) */}
            <div className="shrink-0 flex items-center justify-between gap-4 pt-3 border-t border-slate-200 text-sm">
              <div className="flex items-center gap-2 text-slate-600">
                <span className="font-semibold text-slate-900">{stateLabel}</span>
                {state.activeQuestionType && state.phase !== 'PAUSED' && state.phase !== 'IDLE' && (
                  <>
                    <span className="text-slate-300" aria-hidden="true">
                      ·
                    </span>
                    <span className="text-xs text-slate-500 capitalize">
                      {state.activeQuestionType}
                    </span>
                  </>
                )}
              </div>

              <div className="flex items-center gap-2 tabular-nums">
                <span className="text-slate-500">{scripts.ui.correctAnswers}</span>
                <span className="text-lg font-bold text-emerald-700 font-mono">
                  {state.stats.correctCount}
                </span>
              </div>
            </div>

            {/* 7. Large Touch Controls (>= 56px height) */}
            <div className="shrink-0 grid grid-cols-3 gap-2.5 sm:gap-3 pt-1">
              <button
                type="button"
                onClick={actions.togglePause}
                className={`min-h-[56px] px-3 rounded-xl font-semibold text-sm sm:text-base flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${
                  isPaused
                    ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                    : 'bg-slate-100 hover:bg-slate-200/80 text-slate-900 border border-slate-200'
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
                className="min-h-[56px] px-3 rounded-xl bg-slate-100 hover:bg-slate-200/80 disabled:opacity-45 text-slate-900 border border-slate-200 font-semibold text-sm sm:text-base flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
              >
                <SkipForward className="w-4 h-4 sm:w-5 sm:h-5 shrink-0" aria-hidden="true" />
                <span>{scripts.ui.skip}</span>
              </button>

              <button
                type="button"
                onClick={() => void actions.stopSession()}
                className="min-h-[56px] px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm sm:text-base flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
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
