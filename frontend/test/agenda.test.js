import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('la agenda es un módulo aditivo con permisos propios y rutas protegidas', () => {
  const permissions = read('src/permissions.js');
  const routes = read('src/main.jsx');
  const hub = read('src/AdminHub.jsx');
  assert.match(permissions, /AGENDA_VIEW: 'agenda\.view'/u);
  assert.match(permissions, /AGENDA_CREATE: 'agenda\.create'/u);
  assert.match(permissions, /agenda: \[PERMISSIONS\.AGENDA_VIEW, PERMISSIONS\.AGENDA_CREATE\]/u);
  assert.match(routes, /path="\/agenda"[\s\S]*MODULE_ACCESS_PERMISSIONS\.agenda/u);
  assert.match(hub, /title: 'Agenda interna'/u);
  assert.match(hub, /permissions: MODULE_ACCESS_PERMISSIONS\.agenda/u);
});

test('la agenda abre enlaces fuera de la semana y valida horarios antes de enviar', () => {
  const source = read('src/AgendaInternal.jsx');
  assert.match(source, /axios\.get\(`\$\{API\}\/\$\{requestedEventId\}`/u);
  assert.match(source, /setWeekStart\(requestedWeek\)/u);
  assert.match(source, /end <= start/u);
  assert.match(source, /El término debe ser posterior al inicio/u);
  assert.match(source, /setSearchParams\(\{ evento: String\(response\.data\.id_evento\) \}\)/u);
});

test('la interfaz presenta semana, detalle, invitaciones y estados accesibles', () => {
  const source = read('src/AgendaInternal.jsx');
  const css = read('src/styles/agenda.css');
  for (const text of ['Semana visible', 'Por responder', 'Invitar compañeros', 'Aceptar', 'Rechazar', 'Motivo para cancelar']) {
    assert.match(source, new RegExp(text, 'u'));
  }
  assert.match(source, /role="alert"/u);
  assert.match(source, /role="dialog" aria-modal="true"/u);
  assert.match(source, /setPeopleLoading\(true\);[\s\S]*window\.setTimeout/u, 'el directorio debe mostrar carga durante el debounce');
  assert.match(source, /if \(!cancelled\) setPeople\(/u, 'una búsqueda anterior no debe reemplazar resultados más nuevos');
  assert.doesNotMatch(source, /setForm\(\{ \.\.\.form/u, 'los cambios rápidos no deben sobrescribir campos hermanos');
  assert.match(source, /event\.currentTarget\.type === 'checkbox'/u);
  assert.match(css, /:focus-visible/u);
  assert.match(css, /@media \(max-width: 720px\)/u);
});

test('la ayuda contextual explica privacidad, navegación y respuestas', () => {
  const help = read('src/help/tours.js');
  assert.match(help, /'\/agenda'/u);
  assert.match(help, /Los eventos de otras cuentas no son visibles/u);
  assert.match(help, /aceptarla o rechazarla/u);
  assert.match(help, /agenda-grid/u);
});
