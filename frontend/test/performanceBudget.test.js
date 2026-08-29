import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('las herramientas pesadas permanecen en grupos diferidos y estables', () => {
  const viteConfig = read('vite.config.js');
  assert.match(viteConfig, /name: 'tool-xlsx'/u);
  assert.match(viteConfig, /name: 'tool-zxing'/u);
  assert.match(viteConfig, /name: 'tool-tour'/u);
});

test('el presupuesto separa producto, herramientas y carga inicial', () => {
  const source = read('scripts/verify-performance-budget.mjs');
  assert.match(source, /productScripts/u);
  assert.match(source, /deferredTools/u);
  assert.match(source, /initialDeferredTools/u);
  assert.match(source, /herramientas diferidas incluidas en el arranque/u);
});

test('la ayuda se descarga solo cuando la persona solicita el recorrido', () => {
  const source = read('src/context/HelpTourContext.jsx');
  assert.doesNotMatch(source, /^import \{ driver \} from 'driver\.js';/mu);
  assert.match(source, /import\('driver\.js'\)/u);
  assert.match(source, /isStartingRef/u);
  assert.match(source, /No fue posible abrir la ayuda/u);
});
