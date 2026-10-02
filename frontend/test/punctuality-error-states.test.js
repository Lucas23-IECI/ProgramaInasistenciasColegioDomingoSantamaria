import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('Puntualidad no convierte fallos de carga en ceros ni listas vacías', () => {
  const source = read('src/AdminDashboard.jsx');
  assert.match(source, /const \[loadError, setLoadError\]/u);
  assert.match(source, /const \[pendingError, setPendingError\]/u);
  assert.match(source, /No pudimos confirmar la operación de puntualidad/u);
  assert.match(source, /No pudimos cargar los registros/u);
  assert.match(source, /No pudimos cargar las justificaciones pendientes/u);
  assert.match(source, /role="alert"/u);
});

test('la ayuda diferencia fallos de carga de cero resultados', () => {
  const help = read('src/help/tours.js');
  assert.match(help, /nunca se mostrará como una lista vacía/u);
  assert.match(help, /no se interpreta como cero pendientes/u);
  assert.match(help, /la edición se bloquea hasta recuperarla/u);
});

test('la configuración bloquea la edición si no pudo recuperar la jornada vigente', () => {
  const source = read('src/PunctualitySettings.jsx');
  assert.match(source, /const \[loadError, setLoadError\]/u);
  assert.match(source, /No pudimos cargar la jornada configurada/u);
  assert.match(source, /evitar guardar valores incompletos/u);
  assert.match(source, /onClick=\{loadSettings\}/u);
});
