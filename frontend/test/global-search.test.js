import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (entry) => fs.readFileSync(path.join(root, entry), 'utf8');

test('la búsqueda global es diferida, respeta permisos y no aparece en el terminal', () => {
  const tools = read('src/components/GlobalTools.jsx');
  assert.match(tools, /lazy\(\(\) => import\('\.\/GlobalSearch'\)\)/u);
  assert.match(tools, /hasAnyPermission\(user, GLOBAL_SEARCH_PERMISSIONS\)/u);
  assert.match(tools, /location\.pathname !== '\/scanner'/u);
  assert.match(tools, /event\.ctrlKey \|\| event\.metaKey/u);
  assert.match(tools, /data-tour="global-search"/u);
});

test('la paleta distingue espera, carga, error y ausencia real de resultados', () => {
  const search = read('src/components/GlobalSearch.jsx');
  assert.match(search, /normalizedQuery\.length < MIN_QUERY_LENGTH/u);
  assert.match(search, /status === 'loading'/u);
  assert.match(search, /status === 'error'/u);
  assert.match(search, /status === 'ready' && results\.total === 0/u);
  assert.match(search, /AbortController/u);
  assert.match(search, /getApiErrorMessage/u);
  assert.match(search, /Solo aparecen secciones y registros habilitados por tus permisos/u);
});

test('la ayuda global explica la búsqueda y su atajo actual', () => {
  const tours = read('src/help/tours.js');
  assert.match(tours, /buscar registros habilitados por tus permisos/u);
  assert.match(tours, /Ctrl \+ K/u);
});
