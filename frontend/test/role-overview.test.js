import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('el panel principal obtiene indicadores reales según permisos y cargo', () => {
  const source = read('src/components/RoleOverview.jsx');
  assert.match(source, /Promise\.allSettled/u);
  assert.match(source, /hasPermission/u);
  assert.match(source, /\/api\/operaciones\/bandeja/u);
  assert.match(source, /\/api\/puntualidad\/resumen-hoy/u);
  assert.match(source, /\/api\/seguimiento\/resumen/u);
  assert.match(source, /\/api\/documentos-estudiantes\/resumen/u);
  assert.match(source, /\/api\/convivencia\/resumen/u);
  assert.match(source, /\/api\/visitas\/resumen/u);
  assert.match(source, /\/api\/analitica\/institucional/u);
  assert.match(source, /\/api\/notificaciones\/enviadas/u);
  assert.match(source, /Tendencia mensual de atrasos/u);
  assert.match(source, /Avisos institucionales enviados/u);
  assert.match(source, /open-notification-history/u);
  for (const role of ['direction', 'inspector', 'reader', 'secretary', 'coexistence', 'documents']) {
    assert.match(source, new RegExp(`${role}:`));
  }
  assert.match(read('src/AdminHub.jsx'), /<RoleOverview user=\{user\} navigate=\{navigate\}/u);
  assert.match(read('src/help/tours.js'), /Dirección también compara las dos mitades del mes/u);
});

test('la conectividad global explica el límite seguro del modo sin conexión', () => {
  const source = read('src/components/GlobalTools.jsx');
  assert.match(source, /navigator\.onLine/u);
  assert.match(source, /addEventListener\('offline'/u);
  assert.match(source, /Solo el terminal de puntualidad puede guardar ingresos pendientes/u);
  assert.match(source, /Las demás operaciones esperan/u);
});

test('los accesos del panel preservan filtros de seguimiento y documentos', () => {
  assert.match(read('src/InstitutionalFollowUp.jsx'), /params\.get\('responsable'\)/u);
  assert.match(read('src/InstitutionalFollowUp.jsx'), /Asignados a mí/u);
  assert.match(read('src/StudentDocuments.jsx'), /params\.get\('vencimiento'\) === '30'/u);
});
