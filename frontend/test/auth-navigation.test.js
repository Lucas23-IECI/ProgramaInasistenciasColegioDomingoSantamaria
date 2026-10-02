import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReturnPath, getSafeReturnPath } from '../src/utils/authNavigation.js';

test('conserva la sección protegida y sus filtros después de iniciar sesión', () => {
  const path = buildReturnPath({
    pathname: '/admin/documentos',
    search: '?pagina=2&estado=VENCIDO',
    hash: '#resultado',
  });

  assert.equal(path, '/admin/documentos?pagina=2&estado=VENCIDO#resultado');
});

test('rechaza destinos externos y no permite volver al propio login', () => {
  assert.equal(getSafeReturnPath('https://otro-sitio.example/robo'), '/');
  assert.equal(getSafeReturnPath('//otro-sitio.example/robo'), '/');
  assert.equal(getSafeReturnPath('/login'), '/');
  assert.equal(getSafeReturnPath('/admin/operacion'), '/admin/operacion');
});
