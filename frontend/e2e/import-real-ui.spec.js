/* global process */
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';
import { dismissReleaseNotes } from './helpers.js';

for (const duplicateUsername of [false, true]) {
test(`Excel real ${duplicateUsername ? 'explica un rechazo parcial' : 'admite dos alumnos sin usuario ERP'} y permite revertir desde la interfaz`, async ({ page, baseURL }, testInfo) => {
  test.skip(process.env.E2E_ISOLATED_MUTATIONS !== '1' && process.env.E2E_ISOLATED_IMPORT !== '1', 'Requiere una base aislada explícitamente habilitada.');
  const url = new URL(baseURL);
  expect(['127.0.0.1', 'localhost']).toContain(url.hostname);
  expect(url.port).not.toBe('');
  expect(url.port).not.toBe('80');
  const login = await page.request.post('/api/auth/login', { data: {
    correo: process.env.E2E_ADMIN_EMAIL || 'admin@ldsm.local', password: process.env.DEFAULT_USER_PASSWORD
  } });
  expect(login.status()).toBe(200);
  const coursesResponse = await page.request.get('/api/courses');
  expect(coursesResponse.status()).toBe(200);
  const courses = await coursesResponse.json();
  expect(courses.length).toBeGreaterThan(0);
  const uuid = randomUUID();
  const filename = `qa-reversion-${uuid}.xlsx`;
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([1, 2].map((index) => ({
    'ID de Usuario (no modificar)': `${uuid}-${index}`,
    Nombres: `QA Reversión ${index} ${uuid.slice(0, 8)}`, Apellidos: 'Ficticio Aislado',
    Rol: 'Estudiante', Curso: courses[0].nombre_curso, Sección: '',
    'Nombre Usuario': duplicateUsername ? `qa.${uuid}` : ''
  }))), 'Usuarios');
  await page.goto('/admin/estudiantes');
  await dismissReleaseNotes(page);
  await page.getByRole('button', { name: 'Importar Excel ERP' }).click();
  await page.getByRole('button', { name: /Actualización parcial/ }).click();
  const previewPromise = page.waitForResponse((response) => response.url().endsWith('/api/students/import-preview') && response.request().method() === 'POST');
  await page.getByLabel('Seleccionar Archivo Excel').setInputFiles({
    name: filename, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
  });
  const previewResponse = await previewPromise;
  expect(previewResponse.status()).toBe(200);
  const preview = await previewResponse.json();
  expect(preview.summary.total).toBe(2);
  await expect(page.getByRole('button', { name: 'Confirmar importación' })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('excel-previsualizado.png'), fullPage: true });
  const importPromise = page.waitForResponse((response) => response.url().endsWith('/api/students/bulk-sync') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Confirmar importación' }).click();
  const importedResponse = await importPromise;
  expect(importedResponse.status()).toBe(200);
  const imported = await importedResponse.json();
  expect(imported.inserted).toBe(duplicateUsername ? 1 : 2);
  expect(imported.errors).toHaveLength(duplicateUsername ? 1 : 0);
  if (duplicateUsername) {
    await expect(page.getByText('Importación finalizada con filas rechazadas', { exact: true })).toBeVisible();
    await expect(page.getByText(/Fila 3: El nombre de usuario ERP ya pertenece a otra ficha/)).toBeVisible();
    await expect(page.locator('.student-import-summary')).toHaveCount(0);
    const result = page.locator('.students-import-result');
    await expect(result).toContainText('Estudiantes nuevos: 1');
    await expect(result).toContainText('Filas rechazadas: 1');
    const titleBox = await result.locator('div').nth(0).boundingBox();
    const countsBox = await result.locator('div').nth(1).boundingBox();
    expect(countsBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height);
    expect(await result.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(JSON.stringify(imported)).not.toMatch(/duplicate key|constraint|23505/);
    await page.getByText('Importación finalizada con filas rechazadas', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('excel-rechazo-parcial.png') });
  }
  expect(imported.import_id).toBeTruthy();
  const id = imported.import_id;
  const before = await (await page.request.get(`/api/padron/imports/${id}`)).json();
  expect(before.import.nombre_archivo).toBe(filename);
  expect(before.changes).toHaveLength(2);
  expect(before.changes[0].accion).toBe('CREADO');
  expect(before.changes[1].accion).toBe(duplicateUsername ? 'RECHAZADO' : 'CREADO');

  await page.goto('/admin/estudiantes?seccion=governance');
  await page.getByRole('button', { name: /Historial/ }).click();
  await page.getByRole('button', { name: new RegExp(filename.replaceAll('.', '\\.')) }).click();
  await page.getByRole('button', { name: 'Comprobar si puede revertirse' }).click();
  await expect(page.getByRole('heading', { name: 'La importación puede revertirse' })).toBeVisible();
  const revert = page.getByRole('button', { name: 'Revertir esta importación' });
  await expect(revert).toBeDisabled();
  await page.getByLabel('Motivo institucional').fill('Reversión de la planilla ficticia de la auditoría aislada.');
  await page.getByLabel(/Confirmo que revisé esta compensación/).check();
  const revertPromise = page.waitForResponse((response) => response.url().endsWith(`/api/padron/imports/${id}/revertir`));
  await revert.click();
  expect((await revertPromise).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Importación revertida' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('excel-revertido.png'), fullPage: true });
  const after = await (await page.request.get(`/api/padron/imports/${id}`)).json();
  expect(after.import.estado).toBe('REVERTIDA');
  expect(after.changes[0].id_alumno).toBe(before.changes[0].id_alumno);
  expect(after.reversions).toHaveLength(2);
  expect(after.reversions.filter((row) => row.resultado === 'REVERTIDO')).toHaveLength(duplicateUsername ? 1 : 2);
  expect(after.reversions.filter((row) => row.resultado === 'OMITIDO')).toHaveLength(duplicateUsername ? 1 : 0);
  const second = await (await page.request.post(`/api/padron/imports/${id}/reversion-preview`)).json();
  expect(second.can_revert).toBe(false);
  expect(second.global_reasons).toContain('Esta importación ya fue revertida.');
});
}
