import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const source = (relativePath) => fs.readFileSync(
  path.join(testDirectory, '..', ...relativePath.split('/')),
  'utf8'
);

test('la interfaz conserva Excel antiguo y moderno en ambas importaciones', () => {
  const controller = source('src/features/students/useStudentsController.js');
  assert.equal((controller.match(/await import\('xlsx'\)/gu) || []).length, 2);
  assert.match(source('src/features/students/StudentsView.jsx'), /accept="\.xlsx,\.xls"/u);
});

test('la ayuda y el control del padrón explican plantillas, duplicados y reversión segura', () => {
  const help = source('src/help/tours.js');
  const governance = source('src/components/StudentGovernancePanel.jsx');
  assert.match(help, /descargar plantillas vacías/u);
  assert.match(help, /mismo archivo ya fue importado/u);
  assert.match(help, /reversión segura/u);
  assert.match(governance, /Comprobar si puede revertirse/u);
  assert.match(governance, /Confirmo que revisé esta compensación/u);
});
