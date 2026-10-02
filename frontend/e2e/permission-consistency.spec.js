/* global process */
import { test, expect } from '@playwright/test';
import { dismissReleaseNotes } from './helpers.js';

const adminEmail = process.env.E2E_ADMIN_EMAIL || 'admin@ldsm.local';
const initialPassword = process.env.DEFAULT_USER_PASSWORD;

const expectOk = async (response, action) => {
  const body = await response.json().catch(() => ({}));
  expect(response.ok(), `${action} respondió ${response.status()}: ${body.message || 'sin detalle'}`).toBe(true);
  return body;
};

test('un permiso de acción incorpora el módulo y permite operarlo en una sesión real', async ({ page, request }) => {
  test.skip(!initialPassword, 'DEFAULT_USER_PASSWORD no está configurada para la auditoría aislada.');
  await expectOk(await request.post('/api/auth/login', {
    data: { correo: adminEmail, password: initialPassword },
  }), 'iniciar sesión administrativa');

  const run = `${Date.now()}-${test.info().parallelIndex}`;
  const profileName = `Auditoría recursos ${run}`;
  const email = `auditoria-recursos-${run}@ldsm.test`;
  const nextPassword = `AccesoSeguro${Date.now()}Aa1`;
  let profileCode = '';
  let userId = 0;

  try {
    const profileResult = await expectOk(await request.post('/api/access-profiles', {
      data: {
        name: profileName,
        description: 'Perfil temporal aislado para comprobar dependencias de permisos.',
        permissions: ['resources.manage'],
      },
    }), 'crear perfil temporal');
    profileCode = profileResult.profile.value;

    const catalog = await expectOk(await request.get('/api/permissions/catalog'), 'leer perfiles configurables');
    const storedProfile = catalog.templates.find((profile) => profile.value === profileCode);
    expect(storedProfile?.recommended_permissions).toEqual(expect.arrayContaining([
      'resources.manage',
      'resources.view',
    ]));

    const created = await expectOk(await request.post('/api/users', {
      data: {
        correo: email,
        password: initialPassword,
        rol: profileCode,
        nombre: 'Auditoría Recursos',
        cargo: 'Cuenta temporal aislada',
        permissions: ['resources.manage'],
      },
    }), 'crear cuenta temporal');
    userId = created.user.id;
    expect(created.user.permissions).toEqual(expect.arrayContaining(['resources.manage', 'resources.view']));

    await expectOk(await page.context().request.post('/api/auth/login', {
      data: { correo: email, password: initialPassword },
    }), 'iniciar sesión con el perfil temporal');
    await expectOk(await page.context().request.post('/api/auth/change-password', {
      data: { current_password: initialPassword, new_password: nextPassword },
    }), 'completar cambio de contraseña temporal');

    const session = await expectOk(await page.context().request.get('/api/auth/me'), 'verificar permisos de sesión');
    expect(session.user.permissions).toEqual(expect.arrayContaining(['resources.manage', 'resources.view']));

    await page.goto('/admin');
    await dismissReleaseNotes(page);
    await expect(page.getByRole('heading', { name: 'Recursos internos', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Gobierno de datos', exact: true })).toHaveCount(0);

    await page.goto('/admin/recursos');
    await expect(page.getByRole('heading', { name: 'Recursos internos', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Agregar recurso' })).toBeVisible();
    await expectOk(await page.context().request.get('/api/recursos/resumen'), 'consultar resumen de recursos');
  } finally {
    if (userId) {
      await expectOk(await request.delete(`/api/users/${userId}`, {
        data: { motivo: 'Limpieza de la auditoría aislada de permisos.' },
      }), 'eliminar cuenta temporal');
    }
    if (profileCode) {
      await expectOk(await request.delete(`/api/access-profiles/${profileCode}`), 'eliminar perfil temporal');
    }
  }
});
