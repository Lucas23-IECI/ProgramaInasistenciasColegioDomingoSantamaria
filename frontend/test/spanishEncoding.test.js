import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const roots = ['frontend', 'backend', 'docs', 'scripts', 'questionnaires', '.github'];
const excludedDirectories = new Set([
  '.git', 'node_modules', 'dist', 'test-results', 'playwright-report',
  'backups', 'uploads', 'certs', 'coverage',
]);
const extensions = new Set([
  '.css', '.html', '.js', '.jsx', '.json', '.md', '.mjs', '.ps1', '.sh',
  '.sql', '.ts', '.tsx', '.txt', '.yaml', '.yml',
]);
const intentionalExceptions = new Set([
  path.normalize('backend/migrations/002_normalizar_curso_corrupto.sql'),
  path.normalize('backend/migrations/033_convivencia_escolar.sql'),
  path.normalize('backend/test/coexistence.test.js'),
  path.normalize('frontend/test/spanishEncoding.test.js'),
]);
const mojibakePatterns = [
  /\u00c3[\u0080-\u00bf]/u,
  /\u00c2[\u0080-\u00bf]/u,
  /\u00e2[\u0080-\u00bf\u0152\u0160\u0178\u20ac\u2122]/u,
  /\u00f0[\u0080-\u00bf\u0178]/u,
  /\ufffd/u,
];
const incorrectSpanishPhrases = [
  'Gestion reservada',
  'Informacion que puedes editar',
  'con revision pendiente',
  'permisos explicitos',
  'esta informacion',
  'segun tus permisos',
  'auditoria general',
  'Recarga la pagina',
  'Configuracion institucional actualizada',
  'CAMPOS QUE REQUIEREN REVISION',
];

const collectFiles = (directory, output = []) => {
  if (!fs.existsSync(directory)) return output;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) collectFiles(absolute, output);
    else if (extensions.has(path.extname(entry.name).toLowerCase())) output.push(absolute);
  }
  return output;
};

test('las fuentes del sistema no contienen texto español con doble codificación', () => {
  const findings = [];
  const files = roots.flatMap((root) => collectFiles(path.join(projectRoot, root)));

  for (const file of files) {
    const relative = path.normalize(path.relative(projectRoot, file));
    if (intentionalExceptions.has(relative)) continue;
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/u);
    lines.forEach((line, index) => {
      if (mojibakePatterns.some((pattern) => pattern.test(line))) {
        findings.push(`${relative}:${index + 1}`);
      }
    });
  }

  assert.deepEqual(findings, [], `Se encontró texto con codificación dañada en:\n${findings.join('\n')}`);
});

test('los textos visibles auditados conservan las tildes del español', () => {
  const findings = [];
  const files = roots.flatMap((root) => collectFiles(path.join(projectRoot, root)));

  for (const file of files) {
    const relative = path.normalize(path.relative(projectRoot, file));
    if (intentionalExceptions.has(relative)) continue;
    const source = fs.readFileSync(file, 'utf8');
    incorrectSpanishPhrases.forEach((phrase) => {
      if (source.includes(phrase)) findings.push(`${relative}: ${phrase}`);
    });
  }

  assert.deepEqual(findings, [], `Se encontraron textos visibles sin las tildes esperadas:\n${findings.join('\n')}`);
});
