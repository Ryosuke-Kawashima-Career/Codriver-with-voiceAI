import { useCallback, useEffect, useState } from 'react';
import { DemoPanel } from './components/DemoPanel';
import { DriveScreen } from './components/DriveScreen';
import { HomeScreen } from './components/HomeScreen';
import { SummaryScreen } from './components/SummaryScreen';
import { useCoDriver } from './engine/useCoDriver';
import type { AppScreen, GeocodeResult, GpsFix, LanguageCode, RouteData } from './types';

export default function App() {
  const [screen, setScreen] = useState<AppScreen>('home');
  const [selectedLanguage, setSelectedLanguage] = useState<LanguageCode>('en-IN');
  const [gpsFix, setGpsFix] = useState<GpsFix | null>(null);
  const [selectedDestination, setSelectedDestination] = useState<GeocodeResult | null>(null);
  const [isQuizOnly, setIsQuizOnly] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isDemoOpen, setIsDemoOpen] = useState(false);
  const [googleMapsApiKey, setGoogleMapsApiKey] = useState<string>(
    () => (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined)?.trim() || ''
  );

  const handleFinishToSummary = useCallback(() => {
    setIsDemoOpen(false);
    setScreen('summary');
  }, []);

  const { state, actions } = useCoDriver(handleFinishToSummary);

  // Load runtime Maps JS key from server config if not injected at Vite build time
  useEffect(() => {
    if (googleMapsApiKey) return;
    let mounted = true;
    fetch('/api/config')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { googleMapsApiKey?: string } | null) => {
        if (mounted && data?.googleMapsApiKey) {
          setGoogleMapsApiKey(data.googleMapsApiKey);
        }
      })
      .catch(() => {
        // Offline SVG fallback handles missing key gracefully
      });
    return () => {
      mounted = false;
    };
  }, [googleMapsApiKey]);

  // Hidden Demo Panel keyboard toggle: press 'D' on Drive screen
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (screen !== 'drive') return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return;

      if (e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        setIsDemoOpen((prev) => !prev);
      } else if (e.key === 'Escape' && isDemoOpen) {
        setIsDemoOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isDemoOpen, screen]);

  const startDrive = useCallback(async () => {
    setRouteError(null);
    setIsStarting(true);

    try {
      let computedRoute: RouteData | null = null;

      if (!isQuizOnly) {
        if (!gpsFix || !selectedDestination) {
          setRouteError('Please allow GPS location and pick a destination first.');
          return;
        }

        const params = new URLSearchParams({
          from: `${gpsFix.lat},${gpsFix.lon}`,
          to: `${selectedDestination.lat},${selectedDestination.lon}`,
          destName: selectedDestination.name,
        });

        const res = await fetch(`/api/route?${params.toString()}`);
        const payload = (await res.json()) as RouteData & { error?: string };

        if (!res.ok || !payload.path || payload.path.length < 2) {
          setRouteError(
            payload.error || 'No driving route could be found between these locations.'
          );
          return;
        }

        computedRoute = payload;
      }

      setScreen('drive');
      setIsDemoOpen(false);
      await actions.startSession(selectedLanguage, computedRoute);
    } catch {
      setRouteError('Unable to calculate the route right now. Please check your network and try again.');
    } finally {
      setIsStarting(false);
    }
  }, [actions, gpsFix, isQuizOnly, selectedDestination, selectedLanguage]);

  const handlePlayAgain = useCallback(() => {
    void startDrive();
  }, [startDrive]);

  const handleGoHome = useCallback(() => {
    setIsDemoOpen(false);
    setRouteError(null);
    setScreen('home');
  }, []);

  if (screen === 'home') {
    return (
      <HomeScreen
        selectedLanguage={selectedLanguage}
        gpsFix={gpsFix}
        selectedDestination={selectedDestination}
        isQuizOnly={isQuizOnly}
        routeError={routeError}
        isStarting={isStarting}
        onSelectLanguage={setSelectedLanguage}
        onUpdateGpsFix={setGpsFix}
        onSelectDestination={(dest) => {
          setRouteError(null);
          setSelectedDestination(dest);
        }}
        onToggleQuizOnly={(val) => {
          setRouteError(null);
          setIsQuizOnly(val);
        }}
        onStartDrive={startDrive}
      />
    );
  }

  if (screen === 'summary') {
    return (
      <SummaryScreen
        language={state.language}
        route={state.route}
        stats={state.stats}
        goodbyeText={state.hostCaption}
        onPlayAgain={handlePlayAgain}
        onGoHome={handleGoHome}
      />
    );
  }

  return (
    <>
      <DriveScreen
        state={state}
        actions={actions}
        googleMapsApiKey={googleMapsApiKey}
        isDemoOpen={isDemoOpen}
        onToggleDemo={() => setIsDemoOpen((prev) => !prev)}
      />
      <DemoPanel
        isOpen={isDemoOpen}
        onClose={() => setIsDemoOpen(false)}
        hasRoute={Boolean(state.route)}
        hasLandmarks={Boolean(state.route && state.route.landmarks.length > 0)}
        hasRegions={Boolean(state.route && state.route.regions.length > 0)}
        isSimPlaying={state.isSimPlaying}
        isSimulatedMode={state.isSimulatedMode}
        simSpeed={state.simSpeed}
        progressM={state.progressM}
        isDirectionsFirst={state.isDirectionsFirst}
        debugLogs={state.debugLogs}
        onToggleSimPlay={actions.toggleSimPlay}
        onSetSimSpeed={actions.setSimSpeed}
        onJumpNextTurn={actions.jumpToNextTurn}
        onJumpNextLandmark={actions.jumpToNextLandmark}
        onJumpNextRegion={actions.jumpToNextRegion}
        onSubmitTyped={actions.submitTypedInput}
        onRepeat={actions.repeatCurrent}
        onOfferNow={actions.triggerOfferNow}
      />
    </>
  );
}
