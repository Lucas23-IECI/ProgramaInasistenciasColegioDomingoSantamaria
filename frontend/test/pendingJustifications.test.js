import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('control de atrasos incorpora la bandeja histórica con filtros institucionales', () => {
  const source = read('src/AdminDashboard.jsx');
  assert.match(source, /Justificaciones pendientes/u);
  assert.match(source, /puntualidad\/justificaciones-pendientes/u);
  assert.match(source, /Nombre, RUT u otro identificador/u);
  assert.match(source, /Filtrar pendientes por curso/u);
  assert.match(source, /Período del atraso/u);
  assert.match(source, /Fecha original/u);
});

test('la guía diferencia atraso registrado, regularización e inasistencia', () => {
  const source = read('src/AdminDashboard.jsx');
  const tours = read('src/help/tours.js');
  assert.match(source, /La justificación se aplica a un atraso registrado/u);
  assert.match(source, /La fecha original nunca cambia/u);
  assert.match(source, /las inasistencias se gestionan en un flujo distinto/u);
  assert.match(tours, /data-tour="pending-justifications"/u);
  assert.match(tours, /conserva la fecha original del atraso/u);
});

test('la adaptación visual contempla filtros y acciones móviles', () => {
  const styles = read('src/styles/punctuality.css');
  assert.match(styles, /\.pending-justifications__filters/u);
  assert.match(styles, /\.pending-justifications__filter-actions/u);
  assert.match(styles, /\.pending-justifications__primary-action/u);
  assert.match(styles, /\.record-actions > button\.recommended/u);
  assert.match(styles, /@media \(max-width: 840px\)/u);
  assert.match(styles, /@media \(max-width: 560px\)/u);
});

test('la bandeja abre directamente la justificación y mantiene visibles las acciones secundarias', () => {
  const source = read('src/AdminDashboard.jsx');
  assert.match(source, /openHistoricalJustification/u);
  assert.match(source, /setActionMode\('justificar'\)/u);
  assert.match(source, /Justificar atraso/u);
  assert.match(source, /Acción recomendada/u);
  assert.match(source, /Otras acciones del registro/u);
  assert.match(source, /Ver otras acciones/u);
});
