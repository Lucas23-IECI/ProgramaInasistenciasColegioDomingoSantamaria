import { createContext, useCallback, useContext, useMemo } from 'react';
import { useLocation } from 'react-router';
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import { getTourForPath } from '../help/tours';

const HelpTourContext = createContext({
  available: false,
  startTour: () => {},
});

export const HelpTourProvider = ({ children }) => {
  const location = useLocation();
  const tour = useMemo(() => getTourForPath(location.pathname), [location.pathname]);

  const startTour = useCallback(() => {
    if (!tour?.steps?.length) return;

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
  }, [location.pathname, tour]);

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

