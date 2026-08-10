import React from 'react';

const DEVELOPMENT_MESSAGE = 'Funcionalidad disponible para pruebas y todavía sujeta a validación institucional.';

const DevelopmentBadge = ({ compact = false, className = '' }) => (
  <span
    className={`development-badge${compact ? ' development-badge--compact' : ''}${className ? ` ${className}` : ''}`}
    title={DEVELOPMENT_MESSAGE}
    aria-label={`En desarrollo. ${DEVELOPMENT_MESSAGE}`}
  >
    En desarrollo
  </span>
);

export default DevelopmentBadge;
