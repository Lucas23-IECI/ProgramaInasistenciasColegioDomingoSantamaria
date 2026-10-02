'use strict';
const { checkCoverage } = require('../utils/coverageThresholds');

module.exports = async function* coverageGate(events) {
  let receivedCoverage = false;
  for await (const event of events) {
    if (event.type !== 'test:coverage') continue;
    receivedCoverage = true;
    const errors = checkCoverage(event.data?.summary?.totals);
    if (errors.length) {
      process.exitCode = 1;
      yield `\nCONTROL DE COBERTURA RECHAZADO\n${errors.join('\n')}\n`;
    } else {
      yield '\nControl de cobertura aprobado: líneas ≥59%, ramas ≥69%, funciones ≥80%.\n';
    }
  }
  if (!receivedCoverage) {
    process.exitCode = 1;
    yield '\nCONTROL DE COBERTURA RECHAZADO: el ejecutor no produjo métricas.\n';
  }
};
