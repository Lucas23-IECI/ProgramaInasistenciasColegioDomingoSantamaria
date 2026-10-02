/* global process */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { dismissReleaseNotes } from './helpers.js';

const adminEmail = process.env.E2E_ADMIN_EMAIL || 'admin@ldsm.local';
const password = process.env.DEFAULT_USER_PASSWORD;

const login = async (page) => {
  test.skip(!password, 'DEFAULT_USER_PASSWORD no está configurada para la prueba local.');
  const response = await page.context().request.post('/api/auth/login', {
    data: { correo: adminEmail, password }
  });
  expect(response.ok(), `El acceso de prueba respondió ${response.status()}.`).toBe(true);
};

const monday = () => {
  const value = new Date();
  value.setHours(10, 0, 0, 0);
  const day = value.getDay() || 7;
  value.setDate(value.getDate() - day + 1);
  return value;
};
const plusDays = (value, count) => {
  const result = new Date(value);
  result.setDate(result.getDate() + count);
  return result;
};
const eventFixture = (id, start, overrides = {}) => ({
  id_evento: id,
  titulo: 'Revisión de coordinación',
  detalle: 'Revisar acuerdos y pendientes de la semana.',
  tipo: 'REVISION',
  estado: 'PROGRAMADO',
  inicio: start.toISOString(),
  fin: new Date(start.getTime() + 60 * 60_000).toISOString(),
  todo_el_dia: false,
  ubicacion: 'Sala de reuniones',
  alcance: 'INVITADOS',
  creado_por: 1,
  creador_nombre: 'Dirección',
  mi_rol: 'PARTICIPANTE',
  mi_respuesta: 'PENDIENTE',
  mi_recordatorio_minutos: 30,
  participantes: [
    { id: 1, nombre: 'Dirección', cargo: 'Directora', rol: 'ORGANIZADOR', respuesta: 'ACEPTADA' },
    { id: 7, nombre: 'Equipo', cargo: 'Inspectoría', rol: 'PARTICIPANTE', respuesta: 'PENDIENTE' }
  ],
  ...overrides
});

const mockAgenda = async (page) => {
  const current = eventFixture(41, plusDays(monday(), 1));
  const outside = eventFixture(99, plusDays(monday(), 9), { titulo: 'Reunión de la próxima semana' });
  const created = eventFixture(77, plusDays(monday(), 2), {
    titulo: 'Recordatorio creado', tipo: 'RECORDATORIO', mi_rol: 'ORGANIZADOR', mi_respuesta: 'ACEPTADA'
  });
  const createdPayloads = [];
  await page.route(/\/api\/agenda(?:\?.*)?$/u, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'POST') {
      createdPayloads.push(request.postDataJSON());
      await route.fulfill({ status: 201, json: { id_evento: 77, message: 'El evento quedó guardado en la agenda interna.' } });
      return;
    }
    const from = new Date(url.searchParams.get('desde'));
    const events = new Date(outside.inicio) >= from && new Date(outside.inicio) < new Date(from.getTime() + 7 * 86_400_000)
      ? [outside]
      : [current, ...(createdPayloads.length ? [created] : [])];
    await route.fulfill({ json: { events, from: from.toISOString(), to: url.searchParams.get('hasta') } });
  });
  await page.route(/\/api\/agenda\/directorio(?:\?.*)?$/u, (route) => route.fulfill({
    json: { people: [{ id: 12, nombre: 'Inspector General', cargo: 'Inspectoría' }] }
  }));
  await page.route(/\/api\/agenda\/41\/respuesta(?:\?.*)?$/u, (route) => route.fulfill({
    json: { message: 'Confirmaste tu asistencia.' }
  }));
  await page.route(/\/api\/agenda\/99(?:\?.*)?$/u, (route) => route.fulfill({ json: { event: outside } }));
  await page.route(/\/api\/agenda\/77(?:\?.*)?$/u, (route) => route.fulfill({ json: { event: created } }));
  return { createdPayloads };
};

test('la API real expone una agenda privada sin modificar datos', async ({ page }) => {
  await login(page);
  const from = monday();
  const response = await page.context().request.get(`/api/agenda?desde=${encodeURIComponent(from.toISOString())}&hasta=${encodeURIComponent(plusDays(from, 7).toISOString())}`);
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(Array.isArray(body.events)).toBe(true);
  for (const item of body.events) {
    expect(item).toHaveProperty('mi_rol');
    expect(Array.isArray(item.participantes)).toBe(true);
  }
});

test('la semana, el detalle y la respuesta a una invitación son claros y accesibles', async ({ page }) => {
  await login(page);
  await mockAgenda(page);
  await page.goto('/agenda');
  await dismissReleaseNotes(page);
  await expect(page.getByRole('heading', { name: 'Agenda interna' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Revisión de coordinación/u })).toBeVisible();
  await page.getByRole('button', { name: /Revisión de coordinación/u }).click();
  await expect(page.getByRole('heading', { name: 'Revisión de coordinación' })).toBeVisible();
  await expect(page.getByRole('definition').filter({ hasText: 'Sala de reuniones' })).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).include('.agenda-page').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations.filter((item) => ['critical', 'serious'].includes(item.impact))).toEqual([]);
  await page.getByRole('button', { name: 'Aceptar' }).click();
  await expect(page.getByText('Confirmaste tu asistencia.')).toBeVisible();
});

test('un enlace de notificación abre el evento aunque pertenezca a otra semana', async ({ page }) => {
  await login(page);
  await mockAgenda(page);
  await page.goto('/agenda?evento=99');
  await dismissReleaseNotes(page);
  await expect(page.getByRole('heading', { name: 'Reunión de la próxima semana' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Reunión de la próxima semana/u })).toBeVisible();
});

test('crear un recordatorio conserva horario, invitados y selección del evento nuevo', async ({ page }) => {
  await login(page);
  const fixture = await mockAgenda(page);
  await page.goto('/agenda');
  await dismissReleaseNotes(page);
  await page.getByRole('button', { name: 'Nuevo evento' }).click();
  const dialog = page.getByRole('dialog', { name: 'Crear evento' });
  await dialog.getByLabel('Título').fill('Recordatorio creado');
  await dialog.getByLabel('Tipo').selectOption('RECORDATORIO');
  await dialog.getByLabel('Descripción').fill('Confirmar antecedentes antes de la reunión.');
  await expect(dialog.getByText('Inspector General')).toBeVisible();
  await dialog.locator('label').filter({ hasText: 'Inspector General' }).getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Guardar evento' }).click();
  await expect(page.getByText('El evento quedó guardado en la agenda interna.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recordatorio creado' })).toBeVisible();
  expect(fixture.createdPayloads).toHaveLength(1);
  expect(fixture.createdPayloads[0].participantes_ids).toEqual([12]);
  expect(fixture.createdPayloads[0].recordatorio_minutos).toBe(30);
});

test('la agenda móvil apila días y detalle sin desbordamiento horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await login(page);
  await mockAgenda(page);
  await page.goto('/agenda');
  await dismissReleaseNotes(page);
  await page.getByRole('button', { name: /Revisión de coordinación/u }).click();
  await expect(page.getByRole('heading', { name: 'Revisión de coordinación' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
