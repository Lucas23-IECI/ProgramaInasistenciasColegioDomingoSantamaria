'use strict';

// Node 20 emite métricas de cobertura, pero no admite los flags de umbral.
// Conservamos los mismos mínimos en Docker, CI y desarrollo sin omitir el control.
const THRESHOLDS = Object.freeze({ lines: 59, branches: 69, functions: 80 });

function checkCoverage(totals) {
  const fields = {
    lines: ['totalLineCount', 'coveredLinePercent'],
    branches: ['totalBranchCount', 'coveredBranchPercent'],
    functions: ['totalFunctionCount', 'coveredFunctionPercent']
  };
  const errors = [];
  for (const [name, [count, percent]] of Object.entries(fields)) {
    if (!totals || !Number.isFinite(totals[percent]) || !(totals[count] > 0)) {
      errors.push(`${name}: faltan métricas de cobertura reales`);
    } else if (totals[percent] < THRESHOLDS[name]) {
      errors.push(`${name}: ${totals[percent].toFixed(2)}% < ${THRESHOLDS[name]}%`);
    }
  }
  return errors;
}

module.exports = { checkCoverage, THRESHOLDS };
