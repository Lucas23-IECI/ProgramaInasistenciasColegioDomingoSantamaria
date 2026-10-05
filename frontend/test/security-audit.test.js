import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { parseSecurityAuditReport } from '../scripts/security-audit-report.mjs';

const validReport = { auditReportVersion: 2, vulnerabilities: {}, metadata: { vulnerabilities: { total: 0 } } };
const validAudit = { status: 0, stdout: JSON.stringify(validReport) };

test('la auditoría exige consultar el registro aunque npm tenga offline configurado', () => {
  const source = fs.readFileSync(new URL('../scripts/audit-security.mjs', import.meta.url), 'utf8');
  assert.equal(source.match(/--offline=false/gu)?.length, 2);
});

test('el control acepta reportes reales sin avisos y permite evaluar los que contienen vulnerabilidades', () => {
  assert.deepEqual(parseSecurityAuditReport(validAudit), validReport);
  const report = { ...validReport, vulnerabilities: { dependency: { severity: 'high' } } };
  assert.deepEqual(parseSecurityAuditReport({ status: 1, stdout: JSON.stringify(report) }), report);
});

test('una interrupción, error de npm o fallo de transporte nunca se interpreta como cero vulnerabilidades', () => {
  for (const change of [{ status: null }, { status: 2 }, { error: new Error('sin npm') }, { signal: 'SIGTERM' }]) {
    assert.throws(() => parseSecurityAuditReport({ ...validAudit, ...change }));
  }
  assert.throws(() => parseSecurityAuditReport({ status: 1, stdout: JSON.stringify({ error: { code: 'ECONNREFUSED' } }) }));
});

test('la auditoría rechaza JSON roto e informes vacíos o incompletos', () => {
  for (const stdout of ['', 'no es JSON', '{}', JSON.stringify({ ...validReport, auditReportVersion: 1 }),
    JSON.stringify({ ...validReport, vulnerabilities: null }), JSON.stringify({ ...validReport, metadata: {} })]) {
    assert.throws(() => parseSecurityAuditReport({ status: 0, stdout }));
  }
});
