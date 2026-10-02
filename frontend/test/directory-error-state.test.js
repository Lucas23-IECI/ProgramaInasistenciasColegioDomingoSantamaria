import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('el directorio diferencia un fallo de una búsqueda sin coincidencias', () => {
  const source = read('src/StaffDirectory.jsx');
  assert.match(source, /No pudimos cargar el directorio/u);
  assert.match(source, /staff-directory-empty--error/u);
  assert.match(source, /setRetryToken/u);
  assert.match(source, /role="alert"/u);
});

test('la ayuda del directorio explica el estado recuperable', () => {
  assert.match(read('src/help/tours.js'), /no se informa como cero coincidencias/u);
});
