import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (entry) => fs.readFileSync(path.join(root, entry), 'utf8');

test('Auditoría obtiene acciones y secciones reales en lugar de mantener un catálogo manual', () => {
  const source = read('src/AuditoriaAdmin.jsx');
  assert.match(source, /response\.data\.catalogs/u);
  assert.match(source, /catalogs\.actions/u);
  assert.match(source, /catalogs\.entities/u);
  assert.doesNotMatch(source, /const ACTIONS = \[/u);
});

test('la pantalla distingue categorías, filtros y detalle legible sin JSON técnico visible', () => {
  const source = read('src/AuditoriaAdmin.jsx');
  assert.match(source, /Accesos/u);
  assert.match(source, /Consultas/u);
  assert.match(source, /Cambios/u);
  assert.match(source, /Descargas/u);
  assert.match(source, /Filtrar por categoría de actividad/u);
  assert.match(source, /detailEntries\.map/u);
  assert.doesNotMatch(source, /JSON\.stringify\(row\.detalle/u);
  assert.match(source, /data-tour="audit-filters"/u);
  assert.match(source, /data-tour="audit-list"/u);
});

test('la ayuda describe los filtros y exportaciones vigentes', () => {
  const tours = read('src/help/tours.js');
  assert.match(tours, /filtrar por categoría, acción, sección, persona y período/u);
  assert.match(tours, /exportaciones respetan exactamente los filtros visibles/u);
});
