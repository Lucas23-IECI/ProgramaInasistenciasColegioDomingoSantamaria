import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('cada acceso visible del panel tiene una ruta real protegida', () => {
  const hub = read('src/AdminHub.jsx');
  const routes = read('src/main.jsx');
  const modulePaths = [...hub.matchAll(/\bpath:\s*'([^']+)'/gu)].map((match) => match[1]);
  const routePaths = new Set([...routes.matchAll(/<Route\s+path="([^"]+)"/gu)].map((match) => match[1]));

  assert.ok(modulePaths.length > 10);
  for (const modulePath of modulePaths) {
    assert.ok(routePaths.has(modulePath), `Falta proteger la ruta visible ${modulePath}`);
  }
});

test('panel y rutas reutilizan los mismos conjuntos de permisos configurables', () => {
  const hub = read('src/AdminHub.jsx');
  const routes = read('src/main.jsx');
  for (const key of [
    'analytics', 'students', 'visits', 'operations', 'punctualitySettings',
    'coexistence', 'documents', 'followUp', 'chat', 'agenda', 'resources',
    'punctuality', 'families', 'directory',
  ]) {
    assert.match(hub, new RegExp(`MODULE_ACCESS_PERMISSIONS\\.${key}`, 'u'));
    assert.match(routes, new RegExp(`MODULE_ACCESS_PERMISSIONS\\.${key}`, 'u'));
  }
});

test('el editor explica por qué algunos permisos se seleccionan o retiran juntos', () => {
  const editor = read('src/UsuariosAdmin.jsx');
  assert.match(editor, /Accesos coherentes automáticamente/u);
  assert.match(editor, /entrada necesaria a su módulo/u);
  assert.match(editor, /acciones dependientes/u);
});

test('gobierno de datos no se anuncia a perfiles sin permiso para su API', () => {
  const hub = read('src/AdminHub.jsx');
  const routes = read('src/main.jsx');
  const card = hub.match(/key: 'gobierno-datos'[\s\S]*?\n {2}\},/u)?.[0] || '';
  assert.match(card, /permissions: \[PERMISSIONS\.SETTINGS_MANAGE\]/u);
  assert.doesNotMatch(card, /PUNCTUALITY_CONTROLS_MANAGE/u);
  assert.match(routes, /path="\/admin\/gobierno-datos"[\s\S]*permission=\{PERMISSIONS\.SETTINGS_MANAGE\}/u);
});

test('la ayuda explica cómo se evitan accesos parciales al configurar perfiles', () => {
  const help = read('src/help/tours.js');
  assert.match(help, /incorpora también el acceso necesario a su módulo/u);
  assert.match(help, /retira sus acciones dependientes/u);
});
