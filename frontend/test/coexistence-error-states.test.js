import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('Convivencia diferencia fallos de carga y resultados vacíos', () => {
  const source = read('src/SchoolCoexistence.jsx');

  assert.match(source, /No pudimos cargar los casos/u);
  assert.match(source, /No hay casos con estos filtros/u);
  assert.match(source, /No pudimos abrir el caso/u);
  assert.match(source, /coex-empty--error/u);
  assert.match(source, /role="alert"/u);
  assert.match(source, /loadSequenceRef/u);
});

test('la ayuda explica el fallo recuperable sin romper la reserva del módulo', () => {
  const help = read('src/help/tours.js');

  assert.match(help, /lo distinguen de un resultado vacío y permiten reintentar/u);
  assert.match(help, /Solo las cuentas con permisos explícitos pueden consultar esta información/u);
});
