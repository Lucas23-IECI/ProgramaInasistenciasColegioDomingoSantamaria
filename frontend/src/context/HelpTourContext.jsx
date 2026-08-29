import { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import { useLocation } from 'react-router';
import { getTourForPath } from '../help/tours';
import { useFeedback } from './FeedbackContext';

let loadDriverPromise;
const loadTourDriver = () => {
  loadDriverPromise ||= Promise.all([
    import('driver.js'),
    import('driver.js/dist/driver.css'),
  ]).then(([module]) => module.driver).catch((error) => {
    loadDriverPromise = undefined;
    throw error;
  });
  return loadDriverPromise;
};

const HelpTourContext = createContext({
  available: false,
  startTour: () => {},
});

export const HelpTourProvider = ({ children }) => {
  const location = useLocation();
  const { notify } = useFeedback();
  const isStartingRef = useRef(false);
  const tour = useMemo(() => getTourForPath(location.pathname), [location.pathname]);

  const startTour = useCallback(async () => {
    if (!tour?.steps?.length || isStartingRef.current) return;
    isStartingRef.current = true;

    let driver;
    try {
      driver = await loadTourDriver();
    } catch {
      notify('No fue posible abrir la ayuda. Comprueba la conexión y vuelve a intentarlo.', 'error');
      return;
    } finally {
      isStartingRef.current = false;
    }

    const instance = driver({
      animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      smoothScroll: true,
      allowClose: true,
      allowScroll: true,
      overlayColor: '#07111f',
      overlayOpacity: 0.68,
      stagePadding: 8,
      stageRadius: 10,
      popoverClass: 'ldsm-tour-popover',
      showProgress: true,
      progressText: '{{current}} de {{total}}',
      nextBtnText: 'Siguiente',
      prevBtnText: 'Anterior',
      doneBtnText: 'Finalizar',
      skipMissingElement: true,
      steps: tour.steps,
      onDestroyed: () => {
        localStorage.setItem(`ldsm-tour:${location.pathname}:v1`, 'seen');
      },
    });

    instance.drive();
  }, [location.pathname, notify, tour]);

  const value = useMemo(() => ({
    available: Boolean(tour?.steps?.length),
    startTour,
    title: tour?.title || 'Ayuda de esta página',
  }), [startTour, tour]);

  return (
    <HelpTourContext.Provider value={value}>
      {children}
    </HelpTourContext.Provider>
  );
};

export const useHelpTour = () => useContext(HelpTourContext);

