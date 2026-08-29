import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('el panel presenta como operativos los módulos que completaron su cierre técnico', () => {
  const source = read('src/AdminHub.jsx');
  for (const moduleKey of ['seguimiento', 'convivencia', 'chat', 'documentos']) {
    assert.match(source, new RegExp(`key: '${moduleKey}'`, 'u'));
  }
  assert.doesNotMatch(source, /development:\s*true|DevelopmentBadge/u);
});

test('las experiencias cerradas técnicamente no conservan etiquetas obsoletas', () => {
  for (const relative of [
    'src/InstitutionalFollowUp.jsx',
    'src/SchoolCoexistence.jsx',
    'src/StudentDocuments.jsx',
    'src/AnaliticasAdmin.jsx',
    'src/components/PwaExperience.jsx',
  ]) {
    assert.doesNotMatch(read(relative), /DevelopmentBadge|En desarrollo/u, `${relative} no debe presentarse como módulo en desarrollo`);
  }
});
