import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(frontendRoot, 'src/AnaliticasAdmin.jsx'), 'utf8');

test('la analítica institucional expone indicadores explicables y exportables', () => {
  assert.match(source, /Analítica explicable/u);
  assert.match(source, /Alertas con explicación/u);
  assert.match(source, /exportInstitutional\('pdf'\)/u);
  assert.match(source, /exportInstitutional\('xlsx'\)/u);
});

test('los administradores autorizados pueden gestionar reportes automáticos', () => {
  assert.match(source, /ANALYTICS_SCHEDULES_MANAGE/u);
  assert.match(source, /\/analitica\/programaciones/u);
  assert.match(source, /Reportes automáticos/u);
  assert.match(source, /toggleSchedule/u);
});
