import { useState } from 'react';
import { ArrowRight, Compass, Headphones, Mic, MicOff, Route as RouteIcon } from 'lucide-react';
import type { LanguageCode, RouteSummary } from '../types';
import { LANGUAGES } from '../engine/i18n';

interface HomeScreenProps {
  routes: RouteSummary[];
  selectedLanguage: LanguageCode;
  selectedRouteId: string | null;
  onSelectLanguage: (lang: LanguageCode) => void;
  onSelectRoute: (routeId: string | null) => void;
  onStartDrive: () => Promise<void>;
  isStarting: boolean;
}

export function HomeScreen({
  routes,
  selectedLanguage,
  selectedRouteId,
  onSelectLanguage,
  onSelectRoute,
  onStartDrive,
  isStarting,
}: HomeScreenProps) {
  const [micStatus, setMicStatus] = useState<'idle' | 'checking' | 'denied' | 'unsupported'>('idle');

  const handleStartClick = async () => {
    setMicStatus('checking');

    // Verify microphone access cleanly before entering Drive (Section 4.1)
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setMicStatus('unsupported');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Release immediately; Web Speech API opens the mic strictly during LISTEN phases
      stream.getTracks().forEach((track) => track.stop());
      setMicStatus('idle');
      await onStartDrive();
    } catch {
      setMicStatus('denied');
    }
  };

  return (
    <div className="min-h-[100dvh] w-full bg-[#0B0E14] text-[#F3F5F8] flex flex-col">
      {/* Minimal single-row top bar */}
      <header className="w-full border-b border-white/[0.07]">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between gap-6">
          <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
            <Compass className="w-5 h-5 text-emerald-400" aria-hidden="true" />
            <span className="text-lg font-bold tracking-tight text-white">Safar</span>
          </div>
          <span className="text-xs sm:text-sm text-slate-400 whitespace-nowrap shrink-0">
            Press D in drive for Demo Panel
          </span>
        </div>
      </header>

      {/* Main balanced two-column desktop / single-column mobile workspace */}
      <main className="flex-1 w-full max-w-6xl mx-auto px-5 sm:px-8 py-8 sm:py-12 flex flex-col justify-center">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
          {/* Left column: Hero & overview */}
          <div className="lg:col-span-5 space-y-6">
            <div className="space-y-3">
              <h1
                className="text-3xl sm:text-4xl lg:text-[42px] font-bold tracking-tight text-white leading-[1.12]"
                style={{ textWrap: 'balance' }}
              >
                Your voice co-driver for the highway ahead.
              </h1>
              <p className="text-base text-slate-300 leading-relaxed max-w-prose">
                Navigation comes first. Spoken turn-by-turn directions always take priority, while
                relaxed voice quizzes pass the miles in Hindi, Tamil, or English.
              </p>
            </div>

            <div className="pt-2 border-t border-white/[0.08] space-y-3 text-sm text-slate-400">
              <div className="flex items-start gap-3">
                <span className="text-emerald-400 font-mono text-xs pt-0.5">01</span>
                <p>
                  <strong className="text-slate-200 font-medium">Directions-first audio</strong> —
                  turns interrupt quizzes immediately and hold new questions near junctions.
                </p>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-amber-400 font-mono text-xs pt-0.5">02</span>
                <p>
                  <strong className="text-slate-200 font-medium">Hands-free commands</strong> — say
                  skip, repeat, pause, resume, or stop at any time.
                </p>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-slate-300 font-mono text-xs pt-0.5">03</span>
                <p>
                  <strong className="text-slate-200 font-medium">Zero pressure</strong> — no
                  countdowns, no streaks, just warm answers and highway stories.
                </p>
              </div>
            </div>
          </div>

          {/* Right column: Language + Route selection + Start CTA */}
          <div className="lg:col-span-7 bg-[#141923] border border-white/[0.08] rounded-3xl p-5 sm:p-8 space-y-7">
            {/* Step 1: Language picker */}
            <section aria-labelledby="language-heading" className="space-y-3">
              <div className="flex items-baseline justify-between gap-4">
                <h2 id="language-heading" className="text-base font-semibold text-white">
                  1. Choose voice language
                </h2>
                <span className="text-xs text-slate-400">Hindi · Tamil · English</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {LANGUAGES.map((lang) => {
                  const active = selectedLanguage === lang.code;
                  return (
                    <button
                      key={lang.code}
                      type="button"
                      onClick={() => onSelectLanguage(lang.code)}
                      lang={lang.code}
                      className={`text-left rounded-2xl p-4 min-h-[88px] border transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
                        active
                          ? 'bg-emerald-500/12 border-emerald-400/70 text-white'
                          : 'bg-[#1B2230] border-white/[0.06] text-slate-300 hover:border-white/20 hover:bg-[#202838]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-lg font-semibold leading-snug">
                          {lang.nativeLabel}
                        </span>
                        <span
                          className={`w-2.5 h-2.5 rounded-full ${
                            active ? 'bg-emerald-400' : 'bg-white/15'
                          }`}
                          aria-hidden="true"
                        />
                      </div>
                      <p className="mt-1 text-xs text-slate-400 truncate">{lang.voiceLabel}</p>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Step 2: Route picker */}
            <section aria-labelledby="route-heading" className="space-y-3">
              <div className="flex items-baseline justify-between gap-4">
                <h2 id="route-heading" className="text-base font-semibold text-white">
                  2. Choose route
                </h2>
                <span className="text-xs text-slate-400">Map + voice or quiz only</span>
              </div>

              <div className="space-y-2.5">
                {routes.map((rt) => {
                  const active = selectedRouteId === rt.route_id;
                  const title = rt.name[selectedLanguage] || rt.name['en-IN'];
                  const subtitle = rt.subtitle[selectedLanguage] || rt.subtitle['en-IN'];
                  return (
                    <button
                      key={rt.route_id}
                      type="button"
                      onClick={() => onSelectRoute(rt.route_id)}
                      lang={selectedLanguage}
                      className={`w-full text-left rounded-2xl p-4 min-h-[68px] border transition-all duration-150 flex items-center gap-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
                        active
                          ? 'bg-emerald-500/12 border-emerald-400/70 text-white'
                          : 'bg-[#1B2230] border-white/[0.06] text-slate-300 hover:border-white/20 hover:bg-[#202838]'
                      }`}
                    >
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                          active
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-white/[0.05] text-slate-400'
                        }`}
                      >
                        <RouteIcon className="w-5 h-5" aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-base text-white truncate">{title}</div>
                        <div className="text-xs text-slate-400 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span>{subtitle}</span>
                          <span aria-hidden="true">·</span>
                          <span>{rt.maneuver_count} turns</span>
                          <span aria-hidden="true">·</span>
                          <span>{rt.landmark_count} landmarks</span>
                          <span aria-hidden="true">·</span>
                          <span>{rt.region_count} regions</span>
                        </div>
                      </div>
                    </button>
                  );
                })}

                {/* Quiz-only option */}
                <button
                  type="button"
                  onClick={() => onSelectRoute(null)}
                  className={`w-full text-left rounded-2xl p-4 min-h-[64px] border transition-all duration-150 flex items-center gap-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
                    selectedRouteId === null
                      ? 'bg-amber-500/12 border-amber-400/70 text-white'
                      : 'bg-[#1B2230] border-white/[0.06] text-slate-300 hover:border-white/20 hover:bg-[#202838]'
                  }`}
                >
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                      selectedRouteId === null
                        ? 'bg-amber-500/20 text-amber-300'
                        : 'bg-white/[0.05] text-slate-400'
                    }`}
                  >
                    <Headphones className="w-5 h-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-base text-white">No route (quiz only)</div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      Voice trivia host without map or turn-by-turn directions
                    </div>
                  </div>
                </button>
              </div>
            </section>

            {/* Microphone permission feedback (plain, friendly retry + typed fallback option) */}
            {(micStatus === 'denied' || micStatus === 'unsupported') && (
              <div
                role="alert"
                className="rounded-2xl bg-amber-500/10 border border-amber-400/35 p-4 text-sm text-amber-100 space-y-3"
              >
                <div className="flex items-start gap-3">
                  <MicOff className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="space-y-1">
                    <p className="font-medium text-white">
                      {micStatus === 'denied'
                        ? 'Microphone access was blocked.'
                        : 'Microphone is unavailable in this browser.'}
                    </p>
                    <p className="text-xs text-amber-100/80 leading-relaxed">
                      Allow microphone permission in your browser bar and press Retry to answer by
                      voice, or continue and type answers inside the Demo Panel (press D).
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2.5 pl-8">
                  <button
                    type="button"
                    onClick={handleStartClick}
                    className="px-4 py-2 min-h-[40px] rounded-xl bg-amber-400 text-[#0B0E14] text-xs font-semibold hover:bg-amber-300 transition-colors whitespace-nowrap"
                  >
                    Retry microphone
                  </button>
                  <button
                    type="button"
                    onClick={() => void onStartDrive()}
                    className="px-4 py-2 min-h-[40px] rounded-xl bg-white/10 text-slate-100 text-xs font-medium hover:bg-white/15 transition-colors whitespace-nowrap"
                  >
                    Continue with typed fallback
                  </button>
                </div>
              </div>
            )}

            {/* Primary CTA */}
            <div className="pt-1">
              <button
                type="button"
                onClick={handleStartClick}
                disabled={isStarting || micStatus === 'checking'}
                className="w-full min-h-[56px] px-6 py-3.5 rounded-2xl bg-emerald-500 hover:bg-emerald-400 active:scale-[0.99] disabled:opacity-60 text-[#07120E] font-semibold text-base flex items-center justify-center gap-2.5 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
              >
                <Mic className="w-5 h-5" aria-hidden="true" />
                <span className="whitespace-nowrap">
                  {micStatus === 'checking'
                    ? 'Checking microphone…'
                    : isStarting
                      ? 'Preparing co-driver…'
                      : 'Start'}
                </span>
                <ArrowRight className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
