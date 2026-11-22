import { useCallback, useEffect, useState } from 'react';
import { DemoPanel } from './components/DemoPanel';
import { DriveScreen } from './components/DriveScreen';
import { HomeScreen } from './components/HomeScreen';
import { SummaryScreen } from './components/SummaryScreen';
import { useCoDriver } from './engine/useCoDriver';
import type { AppScreen, LanguageCode, RouteData, RouteSummary } from './types';

export default function App() {
  const [screen, setScreen] = useState<AppScreen>('home');
  const [routes, setRoutes] = useState<RouteSummary[]>([]);
  const [selectedLanguage, setSelectedLanguage] = useState<LanguageCode>('en-IN');
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>('blr-mysuru');
  const [isStarting, setIsStarting] = useState(false);
  const [isDemoOpen, setIsDemoOpen] = useState(false);

  const handleFinishToSummary = useCallback(() => {
    setIsDemoOpen(false);
    setScreen('summary');
  }, []);

  const { state, actions } = useCoDriver(handleFinishToSummary);

  // Load available routes from backend
  useEffect(() => {
    let mounted = true;
    fetch('/api/routes')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Failed to load routes'))))
      .then((data: { routes: RouteSummary[] }) => {
        if (!mounted) return;
        setRoutes(data.routes);
        if (data.routes.length > 0 && selectedRouteId === 'blr-mysuru') {
          setSelectedRouteId(data.routes[0].route_id);
        }
      })
      .catch((err) => {
        console.error('Could not fetch routes:', err);
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Hidden Demo Panel keyboard toggle: press 'D' on Drive screen (ignoring text inputs)
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
    setIsStarting(true);
    try {
      let loadedRoute: RouteData | null = null;
      if (selectedRouteId) {
        const res = await fetch(`/api/routes/${encodeURIComponent(selectedRouteId)}`);
        if (res.ok) {
          loadedRoute = (await res.json()) as RouteData;
        }
      }
      setScreen('drive');
      setIsDemoOpen(false);
      await actions.startSession(selectedLanguage, loadedRoute);
    } finally {
      setIsStarting(false);
    }
  }, [actions, selectedLanguage, selectedRouteId]);

  const handlePlayAgain = useCallback(() => {
    void startDrive();
  }, [startDrive]);

  const handleGoHome = useCallback(() => {
    setIsDemoOpen(false);
    setScreen('home');
  }, []);

  if (screen === 'home') {
    return (
      <HomeScreen
        routes={routes}
        selectedLanguage={selectedLanguage}
        selectedRouteId={selectedRouteId}
        onSelectLanguage={setSelectedLanguage}
        onSelectRoute={setSelectedRouteId}
        onStartDrive={startDrive}
        isStarting={isStarting}
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
        isDemoOpen={isDemoOpen}
        onToggleDemo={() => setIsDemoOpen((prev) => !prev)}
      />
      <DemoPanel
        isOpen={isDemoOpen}
        onClose={() => setIsDemoOpen(false)}
        hasRoute={Boolean(state.route)}
        isSimPlaying={state.isSimPlaying}
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
