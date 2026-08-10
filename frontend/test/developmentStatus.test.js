import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('el panel identifica los módulos todavía sujetos a validación institucional', () => {
  const source = read('src/AdminHub.jsx');
  for (const moduleKey of ['seguimiento', 'convivencia', 'chat', 'documentos']) {
    assert.match(source, new RegExp(`key: '${moduleKey}',\\s+development: true`, 'u'));
  }
  assert.match(source, /<DevelopmentBadge compact \/>/u);
});

test('las funciones nuevas conservan una advertencia visible dentro de su experiencia', () => {
  for (const relative of [
    'src/InstitutionalFollowUp.jsx',
    'src/SchoolCoexistence.jsx',
    'src/StudentDocuments.jsx',
    'src/AnaliticasAdmin.jsx',
    'src/components/PwaExperience.jsx',
  ]) {
    assert.match(read(relative), /DevelopmentBadge/u, `${relative} debe mostrar su estado en desarrollo`);
  }

  const badge = read('src/components/DevelopmentBadge.jsx');
  assert.match(badge, /En desarrollo/u);
  assert.match(badge, /sujeta a validación institucional/u);
});
