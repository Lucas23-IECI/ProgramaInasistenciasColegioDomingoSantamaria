const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { checkCoverage } = require('../utils/coverageThresholds');

const valid = {
  totalLineCount: 100, totalBranchCount: 100, totalFunctionCount: 100,
  coveredLinePercent: 59, coveredBranchPercent: 69, coveredFunctionPercent: 80
};
test('cobertura acepta los umbrales originales y rechaza cada mínimo incumplido', () => {
  assert.deepEqual(checkCoverage(valid), []);
  for (const key of ['coveredLinePercent', 'coveredBranchPercent', 'coveredFunctionPercent']) {
    assert.equal(checkCoverage({ ...valid, [key]: valid[key] - 0.01 }).length, 1);
  }
});
test('cobertura no considera aprobado un reporte ausente, vacío o inválido', () => {
  for (const totals of [undefined, {}, { ...valid, totalLineCount: 0 }, { ...valid, coveredLinePercent: NaN }]) {
    assert.ok(checkCoverage(totals).length > 0);
  }
});

test('el reporter devuelve fallo al proceso cuando falta cobertura o no alcanza el mínimo', () => {
  const reporter = path.resolve(__dirname, '../scripts/coverage-gate.js');
  for (const totals of [null, { ...valid, coveredLinePercent: 58 }, valid]) {
    const source = `const gate = require(${JSON.stringify(reporter)});
      async function* events() { ${totals ? `yield { type: 'test:coverage', data: { summary: { totals: ${JSON.stringify(totals)} } } };` : ''} }
      (async () => { for await (const message of gate(events())) process.stdout.write(message); })();`;
    const result = spawnSync(process.execPath, ['-e', source], { encoding: 'utf8' });
    assert.equal(result.status, totals === valid ? 0 : 1, result.stderr || result.stdout);
  }
});
