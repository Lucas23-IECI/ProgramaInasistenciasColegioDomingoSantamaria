import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('Portería bloquea datos y formularios cuando no puede confirmar su estado', () => {
  const source = read('src/PorteriaWorkspace.jsx');
  assert.match(source, /No pudimos confirmar el estado de Portería/u);
  assert.match(source, /formularios permanecen bloqueados/u);
  assert.match(source, /porter-load-error/u);
  assert.match(source, /onClick=\{\(\) => loadData\(\)\}/u);

  const controller = read('src/features/visits/useVisitsController.js');
  const view = read('src/features/visits/VisitsView.jsx');
  assert.match(controller, /const \[loadError, setLoadError\]/u);
  assert.match(view, /No pudimos confirmar el estado de visitas y retiros/u);
  assert.match(view, /visits-load-error/u);
});

test('la ayuda de Portería explica el bloqueo seguro', () => {
  assert.match(read('src/help/tours.js'), /bloquea cifras, listas y formularios/u);
});

test('Portería abandona el filtro de origen al iniciar otra operación', () => {
  const controller = read('src/features/visits/useVisitsController.js');
  assert.match(controller, /params\.delete\('visita_id'\)/u);
  assert.match(controller, /params\.delete\('retiro_id'\)/u);
  assert.match(controller, /navigate\(`\/admin\/visitas\?\$\{params\.toString\(\)\}`/u);
  assert.match(controller, /setTabState\(requestedVisitId \? 'historial' : 'retiros'\)/u);
});
