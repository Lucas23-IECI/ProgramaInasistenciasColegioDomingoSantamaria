/* global process */
import { test, expect } from '@playwright/test';
import { dismissReleaseNotes } from './helpers.js';

const adminEmail = process.env.E2E_ADMIN_EMAIL || 'admin@ldsm.local';
const password = process.env.DEFAULT_USER_PASSWORD;

const login = async (page) => {
  test.skip(!password, 'DEFAULT_USER_PASSWORD no está configurada para la prueba local.');
  const response = await page.context().request.post('/api/auth/login', {
    data: { correo: adminEmail, password },
  });
  expect(response.ok(), `El acceso de prueba respondió ${response.status()}.`).toBe(true);
};

test('las audiencias y el historial consultan PostgreSQL sin modificar registros', async ({ page }) => {
  await login(page);
  const audiences = await page.context().request.get('/api/notificaciones/audiencias');
  expect(audiences.ok(), `Audiencias respondió ${audiences.status()}.`).toBe(true);
  const audienceData = await audiences.json();
  expect(Array.isArray(audienceData.personas)).toBe(true);
  expect(Array.isArray(audienceData.perfiles)).toBe(true);
  expect(Array.isArray(audienceData.grupos)).toBe(true);

  const history = await page.context().request.get('/api/notificaciones/enviadas?pagina=1&limite=20');
  expect(history.ok(), `Historial respondió ${history.status()}.`).toBe(true);
  const historyData = await history.json();
  expect(Array.isArray(historyData.items)).toBe(true);
  expect(historyData.pagination.page).toBe(1);
  expect(historyData.summary).toEqual(expect.objectContaining({
    total: expect.any(Number),
    destinatarios: expect.any(Number),
    entregadas: expect.any(Number),
    leidas: expect.any(Number),
    fallidos: expect.any(Number),
  }));

  await page.goto('/admin');
  await dismissReleaseNotes(page);
  await page.getByRole('button', { name: /Centro de notificaciones/ }).click();
  await page.locator('.global-notifications-panel').getByRole('button', { name: 'Enviar aviso' }).click();
  const composer = page.getByRole('dialog', { name: 'Enviar una notificación' });
  await expect(composer).toBeVisible();
  await expect(composer.getByRole('tab', { name: 'Personas' })).toBeVisible();
  await expect(composer.getByRole('tab', { name: 'Perfiles' })).toBeVisible();
  await expect(composer.getByRole('tab', { name: 'Equipos' })).toBeVisible();
});

test('el acceso contextual al chat conserva un retorno interno seguro', async ({ page }) => {
  await login(page);
  await page.goto('/chat?contexto_tipo=ESTUDIANTE&contexto_id=1&contexto_nombre=Ficha%20de%20prueba&origen=%2Fadmin%2Festudiantes%3Festudiante_id%3D1&origen_etiqueta=Volver%20a%20la%20ficha');
  await dismissReleaseNotes(page);
  const dialog = page.getByRole('dialog', { name: 'Coordinar este registro' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('ficha de estudiante');
  await expect(page).toHaveURL(/origen=%2Fadmin%2Festudiantes%3Festudiante_id%3D1/u);
});
