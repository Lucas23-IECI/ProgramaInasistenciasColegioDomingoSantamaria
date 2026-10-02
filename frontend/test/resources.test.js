import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('Recursos internos es aditivo y queda protegido por permisos propios', () => {
  const permissions = read('src/permissions.js');
  const routes = read('src/main.jsx');
  const hub = read('src/AdminHub.jsx');
  assert.match(permissions, /RESOURCES_VIEW: 'resources\.view'/u);
  assert.match(permissions, /RESOURCES_REQUEST: 'resources\.request'/u);
  assert.match(permissions, /RESOURCES_MANAGE: 'resources\.manage'/u);
  assert.match(permissions, /resources: \[PERMISSIONS\.RESOURCES_VIEW, PERMISSIONS\.RESOURCES_REQUEST, PERMISSIONS\.RESOURCES_MANAGE\]/u);
  assert.match(routes, /path="\/admin\/recursos"[\s\S]*MODULE_ACCESS_PERMISSIONS\.resources/u);
  assert.match(hub, /key: 'recursos'[\s\S]*MODULE_ACCESS_PERMISSIONS\.resources/u);
});

test('la interfaz distingue solicitudes, entregas y disponibilidad real', () => {
  const source = read('src/InternalResources.jsx');
  assert.match(source, /Las solicitudes pendientes no reservan unidades/u);
  assert.match(source, /La solicitud no descuenta stock hasta/u);
  assert.match(source, /vuelve a comprobar el stock bajo bloqueo/u);
  assert.match(source, /stock_disponible/u);
  assert.match(source, /Registrar devolución/u);
  assert.match(source, /getApiErrorMessage/u);
  assert.match(source, /peopleError/u);
  assert.match(source, /No fue posible cargar las personas habilitadas/u);
  assert.match(source, /RESOURCE_CATEGORY_SUGGESTIONS/u);
  assert.match(source, /resource-category-suggestions/u);
});

test('la ayuda explica permisos, privacidad y control transaccional', () => {
  const help = read('src/help/tours.js');
  assert.match(help, /'\/admin\/recursos'/u);
  assert.match(help, /Cada cuenta sin administración ve solamente sus propios préstamos y solicitudes/u);
  assert.match(help, /impedir cantidades negativas/u);
});

test('Recursos mantiene diseño móvil, foco visible y estados accesibles', () => {
  const source = read('src/InternalResources.jsx');
  const css = read('src/styles/internal-resources.css');
  assert.match(source, /role="dialog" aria-modal="true"/u);
  assert.match(source, /createPortal\(/u);
  assert.match(source, /role="alert"/u);
  assert.match(source, /aria-current=/u);
  assert.match(css, /@media \(max-width: 700px\)/u);
  assert.match(css, /button:focus-visible/u);
  assert.match(css, /grid-template-columns: 1fr;/u);
  assert.match(css, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/u);
  assert.doesNotMatch(css, /\.resources-tabs \{ overflow-x: auto; \}/u);
  const globalCss = read('src/index.css');
  assert.match(globalCss, /\.sr-only \{[\s\S]*clip: rect\(0, 0, 0, 0\)/u);
});
