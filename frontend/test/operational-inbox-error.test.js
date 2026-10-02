import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('la bandeja operacional no convierte un fallo de carga en cero tareas', () => {
  const source = read('src/OperationalInbox.jsx');

  assert.match(source, /const \[loadError, setLoadError\]/u);
  assert.match(source, /Estado no confirmado/u);
  assert.match(source, /No se puede confirmar que existan cero pendientes/u);
  assert.match(source, /loadError \? <section/u);
  assert.match(source, /Confirmar cierre operacional/u);
});

test('la ayuda explica que el cierre queda bloqueado ante un fallo', () => {
  assert.match(read('src/help/tours.js'), /nunca interpreta el fallo como cero pendientes/u);
});
