import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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

const checker = fileURLToPath(new URL('../scripts/verify-performance-budget.mjs', import.meta.url));

function runChecker(t, { scriptName = 'index-test.js', scriptBytes = 20, hasBuild = true } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ldsm-size-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  if (hasBuild) {
    fs.mkdirSync(path.join(directory, 'dist/assets'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'dist/assets', scriptName), 'x'.repeat(scriptBytes));
    fs.writeFileSync(path.join(directory, 'dist/index.html'), `<script src="/assets/${scriptName}"></script>`);
  }
  return spawnSync(process.execPath, [checker], { cwd: directory, encoding: 'utf8' });
}

test('el tamaño se mide y avisa sin bloquear una actualización por límites internos', (t) => {
  const result = runChecker(t, { scriptBytes: 2300 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.complete_payload_kb.javascript, 2300);
  assert.ok(report.size_warnings.includes('JavaScript total diferido'));
  assert.ok(report.size_warnings.includes('JavaScript inicial'));
  assert.match(result.stderr, /Aviso de tamaño \(no bloqueante\)/u);
});

test('sí rechaza una herramienta diferida incluida accidentalmente en el arranque', (t) => {
  const result = runChecker(t, { scriptName: 'tool-xlsx-test.js' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Carga diferida incorrecta/u);
});

test('no declara una medición aprobada si no existe una compilación', (t) => {
  const result = runChecker(t, { hasBuild: false });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Ejecuta npm run build/u);
});
