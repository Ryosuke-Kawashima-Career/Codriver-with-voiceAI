import { CheckCircle2, Compass, Flag, Home, MapPin, RotateCcw } from 'lucide-react';
import type { LanguageCode, RouteData, SessionStats } from '../types';
import { HOST_SCRIPTS } from '../engine/i18n';

interface SummaryScreenProps {
  language: LanguageCode;
  route: RouteData | null;
  stats: SessionStats;
  goodbyeText: string;
  onPlayAgain: () => void;
  onGoHome: () => void;
}

export function SummaryScreen({
  language,
  route,
  stats,
  goodbyeText,
  onPlayAgain,
  onGoHome,
}: SummaryScreenProps) {
  const scripts = HOST_SCRIPTS[language];
  const goodbye = goodbyeText || scripts.goodbye(stats.correctCount, stats.questionsAsked);

  return (
    <div
      lang={language}
      className="min-h-[100dvh] w-full bg-[#F8FAFC] text-[#0F172A] flex flex-col"
    >
      <header className="w-full bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Compass className="w-5 h-5 text-emerald-600" aria-hidden="true" />
            <span className="text-lg font-bold tracking-tight text-slate-900">Safar</span>
          </div>
          <span className="text-xs sm:text-sm text-slate-500 truncate max-w-[200px] sm:max-w-none">
            {route ? route.name[language] || route.name['en-IN'] : 'Quiz Session'}
          </span>
        </div>
      </header>

      <main className="flex-1 w-full max-w-4xl mx-auto px-5 sm:px-8 py-8 sm:py-12 flex flex-col justify-center">
        <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-10 shadow-xs space-y-8">
          <div className="space-y-3">
            <p className="text-xs font-semibold text-emerald-700">Drive Summary</p>
            <h1
              className="text-2xl sm:text-3xl font-bold text-slate-900 leading-snug"
              style={{ textWrap: 'balance' }}
            >
              {goodbye}
            </h1>
          </div>

          <div className="grid grid-cols-2 gap-6 py-6 border-y border-slate-200">
            <div>
              <div className="text-xs sm:text-sm text-slate-500">Questions asked</div>
              <div className="text-3xl sm:text-4xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                {stats.questionsAsked}
              </div>
            </div>
            <div>
              <div className="text-xs sm:text-sm text-slate-500">Correct answers</div>
              <div className="text-3xl sm:text-4xl font-bold font-mono tabular-nums text-emerald-700 mt-1">
                {stats.correctCount}
              </div>
            </div>
          </div>

          {route && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <MapPin className="w-4 h-4 text-amber-600" aria-hidden="true" />
                  <span>Landmarks passed</span>
                </div>
                {stats.landmarksPassed.length === 0 ? (
                  <p className="text-sm text-slate-500">No landmarks reached on this drive yet.</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {stats.landmarksPassed.map((lm) => (
                      <li
                        key={lm.id}
                        className="py-2.5 flex items-center justify-between gap-3 text-sm"
                      >
                        <span className="text-slate-800">{lm.name}</span>
                        {lm.answeredCorrectly ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 whitespace-nowrap">
                            <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                            <span>Answered</span>
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400 whitespace-nowrap">Passed</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Flag className="w-4 h-4 text-sky-600" aria-hidden="true" />
                  <span>Regions crossed</span>
                </div>
                {stats.regionsPassed.length === 0 ? (
                  <p className="text-sm text-slate-500">No new regions crossed on this drive yet.</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {stats.regionsPassed.map((reg) => (
                      <li
                        key={reg.id}
                        className="py-2.5 flex items-center justify-between gap-3 text-sm"
                      >
                        <span className="text-slate-800">{reg.name}</span>
                        {reg.answeredCorrectly ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 whitespace-nowrap">
                            <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                            <span>Answered</span>
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400 whitespace-nowrap">Visited</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <button
              type="button"
              onClick={onPlayAgain}
              className="min-h-[56px] px-6 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-base flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
            >
              <RotateCcw className="w-5 h-5" aria-hidden="true" />
              <span>Play again</span>
            </button>
            <button
              type="button"
              onClick={onGoHome}
              className="min-h-[56px] px-6 rounded-2xl bg-slate-100 hover:bg-slate-200/80 text-slate-900 border border-slate-200 font-semibold text-base flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Home className="w-5 h-5" aria-hidden="true" />
              <span>Home</span>
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
