import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  Check,
  Compass,
  Headphones,
  Loader2,
  LocateFixed,
  MapPin,
  Mic,
  MicOff,
  RefreshCw,
  Search,
} from 'lucide-react';
import type { GeocodeResult, GpsFix, LanguageCode } from '../types';
import { LANGUAGES } from '../engine/i18n';
import { formatDistance } from '../engine/routeReplay';

interface HomeScreenProps {
  selectedLanguage: LanguageCode;
  gpsFix: GpsFix | null;
  selectedDestination: GeocodeResult | null;
  isQuizOnly: boolean;
  routeError: string | null;
  isStarting: boolean;
  onSelectLanguage: (lang: LanguageCode) => void;
  onUpdateGpsFix: (fix: GpsFix | null) => void;
  onSelectDestination: (dest: GeocodeResult | null) => void;
  onToggleQuizOnly: (quizOnly: boolean) => void;
  onStartDrive: () => Promise<void>;
}

// Bengaluru demo start point offered ONLY when desktop browser blocks GPS so reviewers can still test live routes
const DEMO_BENGALURU_FIX: GpsFix = {
  lat: 12.9141,
  lon: 77.4856,
  accuracyM: 15,
  locationName: 'Kengeri, Bengaluru',
  isDemoFallback: true,
};

export function HomeScreen({
  selectedLanguage,
  gpsFix,
  selectedDestination,
  isQuizOnly,
  routeError,
  isStarting,
  onSelectLanguage,
  onUpdateGpsFix,
  onSelectDestination,
  onToggleQuizOnly,
  onStartDrive,
}: HomeScreenProps) {
  const [gpsState, setGpsState] = useState<'locating' | 'found' | 'denied' | 'error'>(
    gpsFix ? 'found' : 'locating'
  );
  const [gpsErrorMsg, setGpsErrorMsg] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<GeocodeResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const [micStatus, setMicStatus] = useState<'idle' | 'checking' | 'denied' | 'unsupported'>('idle');

  const requestGps = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsState('error');
      setGpsErrorMsg('Location services are not available in this browser.');
      return;
    }

    setGpsState('locating');
    setGpsErrorMsg(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const baseFix: GpsFix = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracyM: Math.round(pos.coords.accuracy || 25),
        };
        onUpdateGpsFix(baseFix);
        setGpsState('found');

        // Reverse-geocode live GPS into a readable place name for Home & Voice AI Agent
        const params = new URLSearchParams({
          lat: String(baseFix.lat),
          lon: String(baseFix.lon),
          lang: selectedLanguage,
        });
        fetch(`/api/reverse-geocode?${params.toString()}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((data: { name?: string } | null) => {
            if (data?.name) {
              onUpdateGpsFix({ ...baseFix, locationName: data.name });
            }
          })
          .catch(() => {
            // Coordinates remain usable even if reverse geocoding is unavailable
          });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setGpsState('denied');
          setGpsErrorMsg('Location permission was denied. Allow GPS access and tap Retry.');
        } else {
          setGpsState('error');
          setGpsErrorMsg('Could not detect your current location. Check GPS and tap Retry.');
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 }
    );
  }, [onUpdateGpsFix, selectedLanguage]);

  // Spec 4.1: Detect current location by GPS when Home opens
  useEffect(() => {
    if (!gpsFix) {
      requestGps();
    } else {
      setGpsState('found');
    }
  }, [gpsFix, requestGps]);

  const handleUseDemoGps = () => {
    onUpdateGpsFix(DEMO_BENGALURU_FIX);
    setGpsState('found');
    setGpsErrorMsg(null);
  };

  // Spec 4.1: Search runs on submit only, not while typing (up to 5 results, nearest first)
  const handleSearchSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchError('Enter at least 2 characters to search for a destination.');
      return;
    }

    setIsSearching(true);
    setSearchError(null);
    setHasSearched(true);

    try {
      const params = new URLSearchParams({
        q,
        lang: selectedLanguage,
      });
      if (gpsFix) {
        params.set('lat', String(gpsFix.lat));
        params.set('lon', String(gpsFix.lon));
      }
      const res = await fetch(`/api/geocode?${params.toString()}`);
      const data = (await res.json()) as { results?: GeocodeResult[]; error?: string };
      if (!res.ok) {
        setSearchResults([]);
        setSearchError(data.error || 'Could not search destinations right now.');
        return;
      }
      setSearchResults(data.results ?? []);
      if (!data.results || data.results.length === 0) {
        setSearchError('No matching destinations found. Try a city or landmark name.');
      }
    } catch {
      setSearchResults([]);
      setSearchError('Network error while searching. Please try again.');
    } finally {
      setIsSearching(false);
    }
  };

  const handlePickDestination = (place: GeocodeResult) => {
    onToggleQuizOnly(false);
    onSelectDestination(place);
  };

  const handleSelectQuizOnly = () => {
    onToggleQuizOnly(true);
    onSelectDestination(null);
  };

  const handleStartClick = async () => {
    setMicStatus('checking');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setMicStatus('unsupported');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setMicStatus('idle');
      await onStartDrive();
    } catch {
      setMicStatus('denied');
    }
  };

  const canStart = isQuizOnly || (Boolean(gpsFix) && Boolean(selectedDestination));

  return (
    <div className="min-h-[100dvh] w-full bg-[#F8FAFC] text-[#0F172A] flex flex-col">
      {/* Clean single-row top bar */}
      <header className="w-full bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between gap-6">
          <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
            <Compass className="w-5 h-5 text-emerald-600" aria-hidden="true" />
            <span className="text-lg font-bold tracking-tight text-slate-900">Safar</span>
          </div>
          <span className="text-xs sm:text-sm text-slate-500 whitespace-nowrap shrink-0">
            Press D in drive for Demo Panel
          </span>
        </div>
      </header>

      {/* Focused single-column workspace */}
      <main className="flex-1 w-full max-w-2xl mx-auto px-5 sm:px-8 py-6 sm:py-10 flex flex-col justify-center">
        <div className="bg-white border border-slate-200 rounded-3xl p-5 sm:p-8 shadow-xs space-y-6">
            {/* 1. Language picker */}
            <section aria-labelledby="language-heading" className="space-y-3">
              <div className="flex items-baseline justify-between gap-4">
                <h2 id="language-heading" className="text-sm font-semibold text-slate-900">
                  1. Voice language
                </h2>
                <span className="text-xs text-slate-500">Hindi · Tamil · English</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {LANGUAGES.map((lang) => {
                  const active = selectedLanguage === lang.code;
                  return (
                    <button
                      key={lang.code}
                      type="button"
                      onClick={() => onSelectLanguage(lang.code)}
                      lang={lang.code}
                      className={`text-left rounded-2xl p-3.5 min-h-[78px] border transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${
                        active
                          ? 'bg-emerald-50 border-emerald-600 text-slate-900'
                          : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-100/70'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-base font-semibold leading-snug">
                          {lang.nativeLabel}
                        </span>
                        <span
                          className={`w-2.5 h-2.5 rounded-full ${
                            active ? 'bg-emerald-600' : 'bg-slate-300'
                          }`}
                          aria-hidden="true"
                        />
                      </div>
                      <p className="mt-1 text-xs text-slate-500 truncate">{lang.voiceLabel}</p>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* 2. Current location (GPS) */}
            <section
              aria-labelledby="gps-heading"
              className="pt-5 border-t border-slate-100 space-y-2.5"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 id="gps-heading" className="text-sm font-semibold text-slate-900">
                  2. Current location
                </h2>
                <button
                  type="button"
                  onClick={requestGps}
                  className="text-xs font-medium text-emerald-700 hover:text-emerald-800 inline-flex items-center gap-1.5 min-h-[32px] px-2 rounded-lg hover:bg-emerald-50 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${gpsState === 'locating' ? 'animate-spin' : ''}`}
                    aria-hidden="true"
                  />
                  <span>Refresh GPS</span>
                </button>
              </div>

              <div className="rounded-2xl bg-slate-50 border border-slate-200 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                      gpsState === 'found'
                        ? 'bg-emerald-100 text-emerald-700'
                        : gpsState === 'locating'
                          ? 'bg-slate-200 text-slate-600'
                          : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {gpsState === 'locating' ? (
                      <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <LocateFixed className="w-4 h-4" aria-hidden="true" />
                    )}
                  </div>
                  <div className="min-w-0">
                    {gpsState === 'locating' && (
                      <p className="text-sm font-medium text-slate-700">Locating…</p>
                    )}
                    {gpsState === 'found' && gpsFix && (
                      <>
                        <p className="text-sm font-medium text-slate-900 truncate">
                          {gpsFix.locationName
                            ? gpsFix.locationName
                            : gpsFix.isDemoFallback
                              ? `Bengaluru demo location (±${gpsFix.accuracyM} m)`
                              : `Current location found (±${gpsFix.accuracyM} m)`}
                        </p>
                        <p className="text-xs text-slate-500 font-mono tabular-nums">
                          {gpsFix.isDemoFallback ? 'Demo start' : `GPS ±${gpsFix.accuracyM} m`} ·{' '}
                          {gpsFix.lat.toFixed(4)}, {gpsFix.lon.toFixed(4)}
                        </p>
                      </>
                    )}
                    {(gpsState === 'denied' || gpsState === 'error') && (
                      <p className="text-sm text-amber-900">{gpsErrorMsg}</p>
                    )}
                  </div>
                </div>

                {(gpsState === 'denied' || gpsState === 'error') && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={requestGps}
                      className="px-3.5 min-h-[38px] rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
                    >
                      Retry
                    </button>
                    <button
                      type="button"
                      onClick={handleUseDemoGps}
                      className="px-3.5 min-h-[38px] rounded-xl bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap"
                    >
                      Use Bengaluru start
                    </button>
                  </div>
                )}
              </div>
            </section>

            {/* 3. Destination search (submit only, up to 5 nearest-first) OR No route */}
            <section
              aria-labelledby="dest-heading"
              className="pt-5 border-t border-slate-100 space-y-3"
            >
              <div className="flex items-baseline justify-between gap-4">
                <h2 id="dest-heading" className="text-sm font-semibold text-slate-900">
                  3. Destination
                </h2>
                <span className="text-xs text-slate-500">
                  Try Mysuru, Chennai, or Hyderabad
                </span>
              </div>

              <form onSubmit={handleSearchSubmit} className="flex gap-2">
                <div className="relative flex-1">
                  <Search
                    className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                    aria-hidden="true"
                  />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search a destination (e.g. Mysuru Palace)"
                    className="w-full min-h-[48px] pl-10 pr-3.5 rounded-xl bg-slate-50 border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSearching}
                  className="min-h-[48px] px-5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  {isSearching ? (
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <span>Search</span>
                  )}
                </button>
              </form>

              {searchError && (
                <p role="alert" className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-2.5">
                  {searchError}
                </p>
              )}

              {/* Up to 5 search results, nearest first */}
              {hasSearched && searchResults.length > 0 && (
                <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white overflow-hidden">
                  {searchResults.map((place) => {
                    const isSelected = !isQuizOnly && selectedDestination?.id === place.id;
                    return (
                      <li key={place.id}>
                        <button
                          type="button"
                          onClick={() => handlePickDestination(place)}
                          className={`w-full text-left px-4 py-3 min-h-[56px] flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                            isSelected
                              ? 'bg-emerald-50 text-slate-900'
                              : 'hover:bg-slate-50 text-slate-800'
                          }`}
                        >
                          <div className="flex items-start gap-3 min-w-0">
                            <MapPin
                              className={`w-4 h-4 mt-0.5 shrink-0 ${
                                isSelected ? 'text-emerald-600' : 'text-slate-400'
                              }`}
                              aria-hidden="true"
                            />
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-slate-900 truncate">
                                {place.name}
                              </div>
                              <div className="text-xs text-slate-500 truncate">{place.address}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {place.distance_m !== undefined && (
                              <span className="text-xs font-mono tabular-nums text-slate-500 whitespace-nowrap">
                                {formatDistance(place.distance_m)}
                              </span>
                            )}
                            {isSelected && (
                              <Check className="w-4 h-4 text-emerald-600" aria-hidden="true" />
                            )}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              {/* Selected destination confirmation when search list is collapsed or already picked */}
              {!isQuizOnly && selectedDestination && (
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs sm:text-sm">
                  <div className="flex items-center gap-2 min-w-0 text-emerald-900">
                    <Check className="w-4 h-4 text-emerald-700 shrink-0" aria-hidden="true" />
                    <span className="font-medium truncate">
                      Selected: {selectedDestination.name}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onSelectDestination(null)}
                    className="text-xs font-medium text-emerald-800 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Clear
                  </button>
                </div>
              )}

              {/* No route (quiz only) option */}
              <button
                type="button"
                onClick={handleSelectQuizOnly}
                className={`w-full text-left rounded-2xl p-3.5 min-h-[58px] border transition-all duration-150 flex items-center gap-3.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 ${
                  isQuizOnly
                    ? 'bg-amber-50 border-amber-500 text-slate-900'
                    : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-100/70'
                }`}
              >
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    isQuizOnly ? 'bg-amber-100 text-amber-800' : 'bg-white border border-slate-200 text-slate-500'
                  }`}
                >
                  <Headphones className="w-4 h-4" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm text-slate-900">No route (quiz only)</div>
                  <div className="text-xs text-slate-500">
                    Voice trivia host without map or turn-by-turn directions
                  </div>
                </div>
                {isQuizOnly && <Check className="w-4 h-4 text-amber-700 shrink-0" aria-hidden="true" />}
              </button>
            </section>

            {/* Route calculation error */}
            {routeError && (
              <div
                role="alert"
                className="rounded-2xl bg-amber-50 border border-amber-300 px-4 py-3 text-sm text-amber-950"
              >
                {routeError}
              </div>
            )}

            {/* Microphone permission feedback */}
            {(micStatus === 'denied' || micStatus === 'unsupported') && (
              <div
                role="alert"
                className="rounded-2xl bg-amber-50 border border-amber-300 p-4 text-sm text-amber-950 space-y-3"
              >
                <div className="flex items-start gap-3">
                  <MicOff className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="space-y-1">
                    <p className="font-semibold text-slate-900">
                      {micStatus === 'denied'
                        ? 'Microphone access was blocked.'
                        : 'Microphone is unavailable in this browser.'}
                    </p>
                    <p className="text-xs text-slate-700 leading-relaxed">
                      Allow microphone permission in your browser bar and press Retry to answer by
                      voice, or continue and type answers inside the Demo Panel (press D).
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2.5 pl-8">
                  <button
                    type="button"
                    onClick={handleStartClick}
                    className="px-4 py-2 min-h-[40px] rounded-xl bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Retry microphone
                  </button>
                  <button
                    type="button"
                    onClick={() => void onStartDrive()}
                    className="px-4 py-2 min-h-[40px] rounded-xl bg-white border border-slate-300 text-slate-800 text-xs font-medium hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Continue with typed fallback
                  </button>
                </div>
              </div>
            )}

            {/* Start button */}
            <div className="pt-1">
              <button
                type="button"
                onClick={handleStartClick}
                disabled={!canStart || isStarting || micStatus === 'checking'}
                className="w-full min-h-[56px] px-6 py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-45 disabled:cursor-not-allowed text-white font-semibold text-base flex items-center justify-center gap-2.5 shadow-sm transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
              >
                {isStarting || micStatus === 'checking' ? (
                  <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                ) : (
                  <Mic className="w-5 h-5" aria-hidden="true" />
                )}
                <span className="whitespace-nowrap">
                  {micStatus === 'checking'
                    ? 'Checking microphone…'
                    : isStarting
                      ? isQuizOnly
                        ? 'Preparing co-driver…'
                        : 'Calculating driving route…'
                      : 'Start'}
                </span>
                <ArrowRight className="w-5 h-5" aria-hidden="true" />
              </button>
              {!canStart && (
                <p className="mt-2 text-center text-xs text-slate-500">
                  {!gpsFix
                    ? 'Waiting for GPS location, or choose "No route (quiz only)".'
                    : 'Search and pick a destination above, or choose "No route (quiz only)".'}
                </p>
              )}
            </div>
          </div>
      </main>
    </div>
  );
}
