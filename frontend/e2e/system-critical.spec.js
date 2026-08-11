/* global process */
import { Buffer } from 'node:buffer';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const adminEmail = process.env.E2E_ADMIN_EMAIL || 'admin@ldsm.local';
const readerEmail = process.env.E2E_READER_EMAIL || (process.env.CI ? '' : 'lector@ldsm.local');
const password = process.env.DEFAULT_USER_PASSWORD;

const login = async (page, email = adminEmail) => {
  test.skip(!password, 'DEFAULT_USER_PASSWORD no está configurada para la prueba local.');
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: 'Ingresar al sistema' }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  const releaseNotes = page.getByRole('dialog').filter({ hasText: 'Novedades del sistema' });
  if (await releaseNotes.isVisible().catch(() => false)) {
    await releaseNotes.getByRole('button', { name: 'Cerrar novedades' }).click();
  }
};

const expectNoHorizontalOverflow = async (page) => {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
};

const expectSpanishTextIsWellEncoded = async (page) => {
  const visibleText = await page.locator('body').innerText();
  const mojibakePatterns = [
    /\u00c3[\u0080-\u00bf]/u,
    /\u00c2[\u0080-\u00bf]/u,
    /\u00e2[\u0080-\u00bf]{1,2}/u,
    /\u00f0[\u0080-\u00bf]{1,3}/u,
    /\ufffd/u,
  ];
  expect(mojibakePatterns.some((pattern) => pattern.test(visibleText))).toBe(false);
};

test('el acceso es usable y no presenta barreras críticas', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact))).toEqual([]);
  await expectNoHorizontalOverflow(page);
});

test('administración abre padrón, alta manual y lectura MRZ restringida', async ({ page }) => {
  await login(page);
  await page.goto('/admin/estudiantes');
  await expect(page.getByRole('heading', { name: 'Personas y cursos' })).toBeVisible();
  await page.getByRole('button', { name: /Agregar estudiante/ }).click();
  await expect(page.getByRole('dialog', { name: 'Agregar estudiante manualmente' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Tipo de identificación del estudiante' }).click();
  await page.getByRole('option', { name: 'Pasaporte' }).click();
  await expect(page.getByRole('button', { name: 'Leer zona MRZ' })).toBeVisible();
  await page.getByRole('button', { name: 'Leer zona MRZ' }).click();
  await expect(page.getByRole('dialog', { name: 'Leer zona MRZ' })).toBeVisible();
  await expect(page.getByText('No se cargan ni guardan fotografías.')).toBeVisible();
});

test('gestión documental abre expedientes y se adapta a escritorio y móvil', async ({ page }) => {
  await login(page);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Gestión documental', exact: true })).toBeVisible();
  await expect(page.getByText('Documentación estudiantil', { exact: true })).toBeVisible();
  await expectSpanishTextIsWellEncoded(page);
  await page.goto('/admin/documentos');
  await expect(page.getByRole('heading', { name: 'Gestión documental', exact: true })).toBeVisible();
  await expect(page.getByText('documentos activos')).toBeVisible();
  await page.getByPlaceholder('Buscar estudiante por nombre o documento').fill('an');
  const firstStudent = page.locator('.docs-search-results button').first();
  await expect(firstStudent).toBeVisible();
  await firstStudent.click();
  await expect(page.getByText('Expediente documental')).toBeVisible();
  await expect(page.getByRole('button', { name: /Incorporar documento/ })).toBeVisible();
  await expectSpanishTextIsWellEncoded(page);
  await expectNoHorizontalOverflow(page);
  const accessibility = await new AxeBuilder({ page }).include('.docs-page').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact))).toEqual([]);
});

test('la instalación PWA explica escritorio y móvil con identidad del colegio', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Abrir menú de usuario' }).click();
  await page.getByRole('menuitem', { name: /Instalar aplicación|Aplicación instalada/ }).click();
  const dialog = page.getByRole('dialog', { name: /Instalar en este dispositivo|Aplicación instalada/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByAltText('Escudo del Liceo Domingo Santa María')).toBeVisible();
  await expect(dialog.getByText('Siempre disponible desde el navegador')).toBeVisible();
  await expect(dialog.getByText(/recibirá sus actualizaciones|Ya está instalada/)).toBeVisible();
  await expectSpanishTextIsWellEncoded(page);
  await expectNoHorizontalOverflow(page);
  const accessibility = await new AxeBuilder({ page }).include('.pwa-experience').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact))).toEqual([]);
});

test('el changelog conserva controles visibles y contenido adaptable', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await login(page);
  if (testInfo.project.name === 'escritorio') {
    await page.setViewportSize({ width: 835, height: 744 });
  }
  await page.getByRole('button', { name: 'Abrir menú de usuario' }).click();
  await page.getByRole('menuitem', { name: 'Novedades de la versión' }).click();

  const dialog = page.getByRole('dialog', { name: /Gestión institucional, analítica y operación resiliente/ });
  const body = dialog.locator('.release-notes__body');
    await expect(dialog).toBeVisible();
    const closeButton = dialog.getByRole('button', { name: 'Cerrar novedades' });
    await expect(closeButton).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Entendido' })).toBeVisible();
    await page.waitForTimeout(300);

    const closeButtonIsTopmost = await closeButton.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const topmost = document.elementFromPoint(
        rect.left + (rect.width / 2),
        rect.top + (rect.height / 2),
      );
      return topmost === element || element.contains(topmost);
    });
    expect(closeButtonIsTopmost).toBe(true);

  const geometry = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);

  await body.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect(closeButton).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Entendido' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  const accessibility = await new AxeBuilder({ page }).include('.release-notes').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact))).toEqual([]);
});

test('el terminal conserva regreso al panel y métodos operativos', async ({ page }) => {
  test.setTimeout(60_000);
  await login(page);
  await page.goto('/scanner');
  await expect(page.getByRole('heading', { name: 'Terminal de ingresos' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: /Panel principal/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Pistola de códigos/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Cámara del dispositivo/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Búsqueda manual/ })).toBeVisible();
});

test('seguimiento institucional conserva filtros, ayuda y adaptación responsive', async ({ page }) => {
  await login(page);
  await page.goto('/admin/seguimiento');
  await expect(page.getByRole('heading', { name: 'Seguimiento institucional' })).toBeVisible();
  await expect(page.getByLabel('Resumen de seguimiento')).toBeVisible();
  await expect(page.getByRole('button', { name: /Nuevo seguimiento/ })).toBeVisible();
  await page.getByRole('button', { name: /Configurar reglas/ }).click();
  const automation = page.getByRole('dialog', { name: /Reglas y automatización/ });
  await expect(automation).toBeVisible();
  await expect(automation.getByText('Asignación automática')).toBeVisible();
  await expect(automation.getByText('Escalamiento por plazo')).toBeVisible();
  await expect(automation.getByText('Avisar responsables')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await automation.getByRole('button', { name: 'Cancelar' }).click();
  await expectSpanishTextIsWellEncoded(page);
  await expectNoHorizontalOverflow(page);
  const results = await new AxeBuilder({ page }).include('.follow-page').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact))).toEqual([]);
});

test('chat interno abre como espacio institucional en escritorio y móvil', async ({ page }) => {
  await login(page);
  await page.goto('/chat');
  await expect(page.getByRole('heading', { name: 'Chat interno' })).toBeVisible();
  await expect(page.getByPlaceholder('Buscar conversaciones o mensajes')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nueva conversación' })).toBeVisible();
  await page.getByRole('button', { name: 'Política de retención' }).click();
  const retention = page.getByRole('dialog', { name: /Retención del chat institucional/ });
  await expect(retention).toBeVisible();
  await expect(retention.getByText(/mensajes vencidos/)).toBeVisible();
  await expect(retention.getByText(/adjuntos vinculados/)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await retention.getByRole('button', { name: 'Cancelar' }).click();
  await expectSpanishTextIsWellEncoded(page);
  await expectNoHorizontalOverflow(page);
  const results = await new AxeBuilder({ page }).include('.chat-page').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact))).toEqual([]);
});

test('la configuración de visitas es legible, accesible y conserva sus catálogos', async ({ page }) => {
  await login(page);
  await page.goto('/admin/visitas/configuracion');
  await expect(page.getByRole('heading', { name: 'Configuración de visitas y retiros' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Motivos de visita' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Guardar reglas' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Agregar' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Opciones de Motivos de visita' })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const results = await new AxeBuilder({ page }).include('.visit-settings-surface').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact))).toEqual([]);
});

test('perfil propio y directorio mantienen separación, accesibilidad y navegación', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  await page.goto('/mi-perfil');
  await expect(page.getByRole('heading', { name: 'Mi perfil' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Presentación' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Perfil guardado' })).toBeDisabled();
  await expect(page.getByText('Todo está guardado y queda registrado en auditoría.')).toBeVisible();
  const biography = page.getByLabel('Descripción');
  const originalBiography = await biography.inputValue();
  await biography.fill(`${originalBiography} prueba de cambios`.trim());
  await expect(page.getByRole('button', { name: 'Guardar perfil' })).toBeEnabled();
  await expect(page.getByText('Tienes cambios sin guardar.')).toBeVisible();
  await biography.fill(originalBiography);
  await expect(page.getByRole('button', { name: 'Perfil guardado' })).toBeDisabled();

  const sampleImage = {
    name: 'imagen-perfil-prueba.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAn0lEQVRoge2SQQkAQRDD6qXKTk9Mr4h7hIFCBKSh6cdpoht0A9ArdhfiLtENugHoFbsLcZfoBt0A9IrdhbhLdINuAHrF7kLcJbpBNwC9Ynch7hLdoBuAXrG7EHeJbtANQK/YXYi7RDfoBqBX7C7EXaIbdAPQK3YX4i7RDboB6BW7C3GX6AbdAPSK3YW4S3SDbgB6xe5C3CW6QTcAveIfHqKB8PEHVBptAAAAAElFTkSuQmCC', 'base64')
  };
  await page.getByLabel('Seleccionar foto de perfil').setInputFiles(sampleImage);
  await expect(page.getByRole('dialog', { name: 'Ajusta tu foto' })).toBeVisible();
  await expect(page.getByText('Vista final del avatar')).toBeVisible();
  await page.getByLabel('Nivel de zoom').fill('1.5');
  await page.getByRole('button', { name: 'Girar 90 grados a la derecha' }).click();
  await expect(page.getByText('150%')).toBeVisible();
  await expect(page.getByText('90°')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  const editorAccessibility = await new AxeBuilder({ page }).include('.profile-image-editor').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(editorAccessibility.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact))).toEqual([]);
  await page.getByRole('button', { name: 'Restablecer ajustes' }).click();
  await expect(page.getByText('100%')).toBeVisible();
  await expect(page.getByText('0°')).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByRole('dialog', { name: 'Ajusta tu foto' })).toHaveCount(0);

  await page.getByLabel('Seleccionar foto de perfil').setInputFiles(sampleImage);
  await expect(page.getByRole('dialog', { name: 'Ajusta tu foto' })).toBeVisible();
  await page.route('**/api/profile/me/avatar', async (route) => {
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Error controlado de prueba' }) });
  });
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByRole('dialog', { name: 'Ajusta tu foto' })).toBeVisible();
  await expect(page.getByText('Error controlado de prueba').first()).toBeVisible();
  await page.unroute('**/api/profile/me/avatar');
  await page.getByRole('button', { name: 'Cancelar' }).click();

  await page.getByLabel('Seleccionar imagen de portada').setInputFiles(sampleImage);
  await expect(page.getByRole('dialog', { name: 'Ajusta tu portada' })).toBeVisible();
  await expect(page.getByText('Vista final de la portada')).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await expectNoHorizontalOverflow(page);

  let accessibility = await new AxeBuilder({ page }).include('.staff-profile-page').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact))).toEqual([]);

  await page.goto('/directorio');
  await expect(page.getByRole('heading', { name: 'Directorio interno' })).toBeVisible();
  const showFilters = page.getByRole('button', { name: 'Mostrar filtros' });
  if (await showFilters.isVisible().catch(() => false)) await showFilters.click();
  await expect(page.getByLabel('Área', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Cargo', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Disponibilidad', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Tipo de cuenta', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Ordenar', { exact: true })).toBeVisible();
  await page.getByLabel('Buscar persona').fill('Lector');
  await expect(page.getByRole('button', { name: /Lector Puerta/ })).toBeVisible();
  await page.getByRole('button', { name: /Lector Puerta/ }).click();
  await expect(page.getByRole('heading', { name: 'Configuración institucional' })).toBeVisible();
  await expect(page.getByText('no reemplazan el cargo ni los permisos de acceso')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  accessibility = await new AxeBuilder({ page }).include('.staff-profile-page').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact))).toEqual([]);
});

test('los perfiles reutilizables cumplen su ciclo de vida y Administrador permanece protegido', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await login(page);
  const profileName = `Perfil QA ${testInfo.project.name} ${Date.now()}`;
  let profileCode = '';
  try {
    const created = await page.request.post('/api/access-profiles', {
      data: { name: profileName, description: 'Perfil temporal para regresión automatizada.', permissions: [] }
    });
    expect(created.status()).toBe(201);
    profileCode = (await created.json()).profile.value;

    await page.goto(`/admin/usuarios/${encodeURIComponent(profileCode)}`);
    await expect(page.getByRole('heading', { level: 1, name: profileName, exact: true })).toBeVisible();
    const profileDetail = page.locator('.profile-detail');
    await expect(profileDetail.getByText('Activo', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Editar perfil' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Actividad' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Desactivar' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Eliminar' })).toBeVisible();

    await page.getByRole('button', { name: 'Desactivar' }).click();
    let dialog = page.getByRole('dialog', { name: 'Administrar perfil de usuario' });
    await expect(dialog.getByRole('heading', { name: `Desactivar ${profileName}` })).toBeVisible();
    await dialog.getByRole('button', { name: 'Desactivar perfil' }).click();
    await expect(profileDetail.getByText('Desactivado', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Crear cuenta' })).toBeDisabled();

    await page.getByRole('button', { name: 'Reactivar' }).click();
    dialog = page.getByRole('dialog', { name: 'Administrar perfil de usuario' });
    await expect(dialog.getByRole('heading', { name: `Reactivar ${profileName}` })).toBeVisible();
    await dialog.getByRole('button', { name: 'Reactivar perfil' }).click();
    await expect(profileDetail.getByText('Activo', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Actividad' }).click();
    await expect(page.getByRole('heading', { name: `Actividad del perfil ${profileName}` })).toBeVisible();
    await expect(page.getByText(/^Actividad consolidada ·/)).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Filtrar por cuenta del perfil' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Excel' })).toBeVisible();

    const filteredAudit = await page.request.get(`/api/audit?perfil_codigo=${encodeURIComponent(profileCode)}&accion=DESACTIVAR_PERFIL_ACCESO&limit=100`);
    expect(filteredAudit.ok()).toBe(true);
    const filteredBody = await filteredAudit.json();
    expect(filteredBody.total).toBeGreaterThanOrEqual(1);
    expect(filteredBody.rows.every((row) => row.accion === 'DESACTIVAR_PERFIL_ACCESO')).toBe(true);
    const exportedAudit = await page.request.get(`/api/audit?perfil_codigo=${encodeURIComponent(profileCode)}&accion=DESACTIVAR_PERFIL_ACCESO&exportar=1`);
    expect(exportedAudit.ok()).toBe(true);
    const exportedBody = await exportedAudit.json();
    expect(exportedBody.rows).toHaveLength(exportedBody.total);
    expect(exportedBody.rows.every((row) => row.accion === 'DESACTIVAR_PERFIL_ACCESO')).toBe(true);

    await page.getByRole('button', { name: 'Volver al perfil' }).click();

    await page.getByRole('button', { name: 'Eliminar' }).click();
    dialog = page.getByRole('dialog', { name: 'Administrar perfil de usuario' });
    await expect(dialog.getByRole('heading', { name: `Eliminar ${profileName}` })).toBeVisible();
    await dialog.getByLabel(`Escribe ${profileName} para confirmar`).fill(profileName);
    await dialog.getByRole('button', { name: 'Eliminar perfil' }).click();
    await expect(page).toHaveURL(/\/admin\/usuarios$/);
    profileCode = '';

    const adminDeactivate = await page.request.patch('/api/access-profiles/admin/status', { data: { activo: false } });
    expect(adminDeactivate.status()).toBe(409);
    const adminDelete = await page.request.delete('/api/access-profiles/admin');
    expect(adminDelete.status()).toBe(409);
    const linkedProfileDelete = await page.request.delete('/api/access-profiles/inspector');
    expect(linkedProfileDelete.status()).toBe(409);
  } finally {
    if (profileCode) await page.request.delete(`/api/access-profiles/${encodeURIComponent(profileCode)}`).catch(() => {});
  }
});

test('el perfil propio persiste los cambios y permite restaurar el valor original', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'escritorio', 'La escritura controlada se ejecuta una sola vez para evitar carreras entre proyectos.');
  await login(page);
  await page.goto('/mi-perfil');
  const biography = page.getByLabel('Descripción');
  const originalBiography = await biography.inputValue();
  const temporaryBiography = `Verificación temporal de persistencia ${Date.now()}`;
  let temporarySaved = false;

  try {
    await biography.fill(temporaryBiography);
    await page.getByRole('button', { name: 'Guardar perfil' }).click();
    await expect(page.getByRole('button', { name: 'Perfil guardado' })).toBeDisabled();
    temporarySaved = true;
    await page.reload();
    await expect(page.getByLabel('Descripción')).toHaveValue(temporaryBiography);
  } finally {
    if (temporarySaved) {
      await page.getByLabel('Descripción').fill(originalBiography);
      await page.getByRole('button', { name: 'Guardar perfil' }).click();
      await expect(page.getByRole('button', { name: 'Perfil guardado' })).toBeDisabled();
      await page.reload();
      await expect(page.getByLabel('Descripción')).toHaveValue(originalBiography);
    }
  }
});

test('recupera automáticamente una sección cuando su archivo versionado quedó obsoleto', async ({ page }) => {
  await login(page);
  await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker?.getRegistrations?.() || [];
    await Promise.all(registrations.map((registration) => registration.unregister()));
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
  });
  await page.reload();
  await expect(page).not.toHaveURL(/\/login$/);
  let rejectedOnce = false;
  await page.route(/VisitSettingsAdmin-.*\.js/, async (route) => {
    if (!rejectedOnce) {
      rejectedOnce = true;
      await route.fulfill({ status: 404, contentType: 'text/plain', body: 'archivo sustituido' });
      return;
    }
    await route.continue();
  });

  await page.goto('/admin/visitas/configuracion');
  await expect(page.getByRole('heading', { name: 'Configuración de visitas y retiros' })).toBeVisible({ timeout: 15_000 });
  expect(rejectedOnce).toBe(true);
});

test('la analítica institucional es explicable, exportable y adaptable', async ({ page }) => {
  await login(page);
  await page.goto('/admin/analiticas');
  await expect(page.getByRole('heading', { name: 'Estadísticas de puntualidad' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'Analítica explicable' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'Alertas con explicación' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Reportes automáticos' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'PDF' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Excel' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectSpanishTextIsWellEncoded(page);
});

test('la PWA publica instalación y excluye la API del caché', async ({ page }) => {
  const manifestResponse = await page.request.get('/manifest.webmanifest');
  expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json();
  expect(manifest.lang).toBe('es-CL');
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ sizes: '192x192' }),
    expect.objectContaining({ sizes: '512x512' }),
  ]));

  const workerResponse = await page.request.get('/sw.js');
  expect(workerResponse.ok()).toBe(true);
  const worker = await workerResponse.text();
  expect(worker).toContain("url.pathname.startsWith('/api/')");
});

test('Portería recibe solo sus dos módulos y el terminal operativo', async ({ page }) => {
  test.skip(!readerEmail, 'La cuenta de Portería no está preparada en este entorno efímero.');
  await login(page, readerEmail);
  await expect(page.getByRole('heading', { name: 'Control de visitas y retiros' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Registro de estudiantes' })).toBeVisible();
  await page.getByRole('button', { name: 'Abrir menú de usuario' }).click();
  await expect(page.getByRole('menuitem', { name: 'Mi perfil' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Directorio interno' })).toHaveCount(0);
  await page.goto('/scanner');
  await expect(page.getByRole('button', { name: /Cámara del dispositivo/ })).toBeVisible();
});

test('las pantallas críticas no desbordan en móvil', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'movil-android', 'Validación exclusiva del viewport móvil.');
  await login(page);
  for (const route of [
    '/admin',
    '/admin/atrasos',
    '/admin/estudiantes',
    '/admin/usuarios',
    '/admin/auditoria',
    '/admin/analiticas',
    '/admin/configuracion',
    '/admin/visitas',
    '/admin/visitas/configuracion',
    '/admin/operacion',
    '/admin/familias',
    '/admin/gobierno-datos',
    '/admin/seguimiento',
    '/chat',
    '/mi-perfil',
    '/directorio',
    '/scanner',
  ]) {
    await page.goto(route);
    await page.waitForLoadState('domcontentloaded');
    await expectNoHorizontalOverflow(page);
  }
});
