/* global process */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const isolatedDatabase = 'ldsm_codex_manual_019ffb95';
const isolatedContainer = 'ldsm_backend_codex_manual';
const documentFixture = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../backend/test/fixtures/certificado-prueba.pdf'
);

// Real HTTP QA only: no routes, fixtures or mocked responses are installed.
// A single authenticated account proves persistence, not multi-user delivery or TLS.
// Never retain request traces: the real login contains a secret loaded by the config.
test.use({ trace: 'off', video: 'off', ignoreHTTPSErrors: false });

test.beforeEach(async ({ baseURL, request }) => {
  test.skip(process.env.E2E_ISOLATED_MUTATIONS !== '1', 'Requiere autorización explícita de escrituras en QA aislado.');
  const target = new URL(baseURL);
  expect(target.protocol).toBe('http:');
  expect(['127.0.0.1', 'localhost']).toContain(target.hostname);
  expect(['4174', '5193']).toContain(target.port);

  // Inspect stays in memory: never print the container environment or credentials.
  let container;
  try {
    [container] = JSON.parse(execFileSync('docker', ['inspect', isolatedContainer], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
    }));
  } catch {
    throw new Error('No se pudo verificar el contenedor QA; no se permite iniciar sesión ni escribir.');
  }
  const environment = Object.fromEntries(container.Config.Env.map((entry) => {
    const separator = entry.indexOf('=');
    return [entry.slice(0, separator), entry.slice(separator + 1)];
  }));
  expect(container.Name).toBe(`/${isolatedContainer}`);
  expect(container.State.Running).toBe(true);
  expect(environment.DB_NAME).toBe(isolatedDatabase);
  expect(environment.POSTGRES_DB).toBe(isolatedDatabase);
  expect(container.NetworkSettings.Ports['5000/tcp']).toEqual([
    { HostIp: '127.0.0.1', HostPort: '5002' }
  ]);
  const servedConfig = await request.get('/src/config.js');
  expect(servedConfig.ok()).toBe(true);
  expect(await servedConfig.text(), 'Vite QA debe usar VITE_API_URL=/api, no el backend predeterminado de localhost:5000.')
    .toMatch(/"VITE_API_URL"\s*:\s*"\/api"/u);
  // Vite answers OPTIONS itself, so probe a real backend route without a session.
  // The expected 401 proves Origin passed CORS without performing any write.
  const originCheck = await request.get('/api/chat/directorio', {
    headers: { Origin: target.origin }
  });
  expect(originCheck.status(), 'El proxy/CORS de QA debe aceptar su Origin loopback antes de iniciar sesión o escribir.').toBe(401);
});

const readJson = async (response, action, status = 200) => {
  expect(response.status(), `${action}: HTTP ${response.status()}`).toBe(status);
  return response.json();
};

const dismissCurrentRelease = async (page) => {
  const dialog = page.getByRole('dialog', { name: 'Novedades para tu trabajo diario' });
  const visible = await dialog.waitFor({ state: 'visible', timeout: 3000 })
    .then(() => true).catch(() => false);
  if (visible) {
    await dialog.getByRole('button', { name: 'Cerrar novedades' }).click();
    await expect(dialog).toBeHidden();
  }
};

test('chat real crea grupo, envía por Enter, menciona, adjunta, descarga y conserva el fijado', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  test.skip(!process.env.DEFAULT_USER_PASSWORD, 'No se configuró DEFAULT_USER_PASSWORD; no se modifican cuentas.');
  const authenticated = await readJson(await page.request.post('/api/auth/login', {
    data: {
      correo: process.env.E2E_ADMIN_EMAIL || 'admin@ldsm.local',
      password: process.env.DEFAULT_USER_PASSWORD
    }
  }), 'Acceso real a QA; si falla, detener sin modificar cuentas');
  const permissions = authenticated.user.permissions || [];
  expect(permissions).toContain('chat.group.create');
  expect(permissions).toContain('chat.attach');
  const canUrgent = permissions.includes('chat.urgent');

  const directory = await readJson(await page.request.get('/api/chat/directorio'), 'Directorio real');
  const member = directory.find((person) => /\bQA\b|(?:^|[._+-])qa(?:[._+@-]|$)/iu.test(`${person.nombre} ${person.correo}`));
  expect(Boolean(member), 'Se requiere otra cuenta QA existente; no se crean ni alteran cuentas.').toBe(true);

  const groupName = `[QA CHAT ${testInfo.project.name} ${Date.now()}] Coordinación de jornada`;
  await page.goto('/chat');
  await dismissCurrentRelease(page);
  await expect(page.getByRole('button', { name: 'Nueva conversación', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Nueva conversación', exact: true }).click();
  const createDialog = page.getByRole('dialog', { name: 'Nueva conversación' });
  await createDialog.getByRole('button', { name: 'Grupo', exact: true }).click();
  await createDialog.getByLabel('Nombre', { exact: true }).fill(groupName);
  await createDialog.getByLabel('Buscar personas').fill(member.correo);
  await createDialog.getByRole('checkbox').check();
  const conversationResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === '/api/chat/conversaciones'
      && response.request().method() === 'POST'
  ));
  await createDialog.getByRole('button', { name: 'Continuar', exact: true }).click();
  const created = await readJson(await conversationResponse, 'Grupo creado desde UI', 201);
  const conversationId = created.id_conversacion;
  expect(Number(conversationId)).toBeGreaterThan(0);
  await expect(page).toHaveURL(new RegExp(`/chat/${conversationId}$`, 'u'));
  await expect(page.getByRole('heading', { name: groupName, exact: true })).toBeVisible();
  const thread = page.locator('.chat-thread');
  const editor = thread.getByRole('textbox', { name: 'Mensaje', exact: true });
  const messages = [];

  const sendByEnter = async (content, { urgent = false, mention = false } = {}) => {
    await expect(editor).toBeEnabled();
    await editor.fill(content);
    if (mention) {
      await thread.getByRole('button', { name: 'Mencionar a una persona' }).click();
      await thread.getByRole('button', { name: `@${member.nombre}`, exact: true }).click();
    }
    if (urgent) await thread.getByRole('button', { name: 'Marcar como urgente' }).click();
    const sentContent = (await editor.inputValue()).trim();
    const pending = page.waitForResponse((response) => (
      new URL(response.url()).pathname === `/api/chat/conversaciones/${conversationId}/mensajes`
        && response.request().method() === 'POST'
    ));
    await editor.press('Enter');
    const response = await pending;
    const message = await readJson(response, 'Mensaje enviado por Enter', 201);
    expect(message.contenido).toBe(sentContent);
    expect(message.tipo).toBe(urgent ? 'URGENTE' : 'NORMAL');
    if (mention) expect(response.request().postDataJSON().menciones.map(Number)).toContain(Number(member.id));
    const article = thread.getByRole('article').filter({ hasText: sentContent });
    await expect(article).toBeVisible();
    await expect(editor).toHaveValue('');
    if (urgent) {
      await expect(article).toContainText('Urgente');
      await expect(thread.getByRole('button', { name: 'Marcar como urgente' })).toHaveAttribute('aria-pressed', 'false');
    }
    messages.push(message);
    return message;
  };

  const firstMessage = await sendByEnter('Buenos días, equipo. Este grupo ficticio de QA revisa la coordinación de la jornada.');
  await sendByEnter('La reunión de preparación será a las 09:00 en la sala de profesores. Dejaremos aquí los acuerdos.');
  await sendByEnter('Para la actividad de prueba, confirmemos el material antes de las 10:00.', { urgent: canUrgent, mention: true });
  await sendByEnter('Comparto un certificado ficticio de prueba. No contiene antecedentes reales de estudiantes.');

  const attachmentResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === `/api/chat/conversaciones/${conversationId}/adjuntos`
      && response.request().method() === 'POST'
  ));
  await expect(thread.getByRole('button', { name: 'Adjuntar archivo' })).toBeEnabled();
  await thread.locator('input[type="file"]').setInputFiles(documentFixture);
  const attachmentMessage = await readJson(await attachmentResponse, 'PDF adjuntado desde UI', 201);
  expect(attachmentMessage.adjunto.nombre).toBe('certificado-prueba.pdf');
  const attachmentButton = thread.getByRole('button', { name: 'certificado-prueba.pdf Descargar archivo' });
  await expect(attachmentButton).toBeVisible();
  const downloadResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === `/api/chat/conversaciones/${conversationId}/adjuntos/${attachmentMessage.adjunto.id_adjunto}`
  ));
  const downloadEvent = page.waitForEvent('download');
  await attachmentButton.click();
  expect((await downloadResponse).status()).toBe(200);
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('certificado-prueba.pdf');
  const savedDownload = await download.path();
  expect(savedDownload).toBeTruthy();
  expect((await readFile(savedDownload)).equals(await readFile(documentFixture))).toBe(true);

  const firstArticle = thread.getByRole('article').filter({ hasText: firstMessage.contenido });
  const pinResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === `/api/chat/conversaciones/${conversationId}/mensajes/${firstMessage.id_mensaje}/fijar`
      && response.request().method() === 'POST'
  ));
  await firstArticle.getByRole('button', { name: 'Fijar mensaje', exact: true }).click();
  expect((await pinResponse).status()).toBe(200);
  await expect(thread.locator('.chat-pinned')).toContainText(firstMessage.contenido);
  await sendByEnter('Gracias. El acuerdo principal quedó fijado y el documento está disponible para el equipo.');

  // Exercise the integrated surface through the real API, not only mocked UI.
  const dockDraft = 'Prueba real: respondo desde el chat flotante sin salir del panel.';
  await editor.fill(dockDraft);
  await page.getByRole('button', { name: 'Usar chat flotante', exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  const dock = page.getByRole('region', { name: 'Chat rápido', exact: true });
  await expect(dock).toBeVisible();
  await expect(editor).toHaveValue(dockDraft);
  await dock.getByRole('button', { name: 'Minimizar chat', exact: true }).click();
  await page.getByRole('button', { name: /^Abrir mensajes/ }).click();
  await expect(editor).toHaveValue(dockDraft);
  await sendByEnter(dockDraft);
  await expect(page).toHaveURL(/\/admin$/);
  await dock.screenshot({ path: testInfo.outputPath(`chat-dock-real-${testInfo.project.name}.png`) });
  await dock.getByRole('button', { name: 'Abrir chat completo', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/chat/${conversationId}$`, 'u'));

  await page.reload();
  await dismissCurrentRelease(page);
  await expect(thread.getByRole('heading', { name: groupName })).toBeVisible();
  await expect(thread.locator('.chat-pinned')).toContainText(firstMessage.contenido);
  await expect(attachmentButton).toBeVisible();
  const persisted = await readJson(await page.request.get(`/api/chat/conversaciones/${conversationId}/mensajes`), 'Persistencia real de mensajes');
  expect(persisted).toHaveLength(messages.length + 1);
  for (const message of messages) {
    expect(persisted.find((item) => Number(item.id_mensaje) === Number(message.id_mensaje))).toMatchObject({
      contenido: message.contenido, tipo: message.tipo
    });
  }
  expect(persisted.find((item) => Number(item.id_mensaje) === Number(firstMessage.id_mensaje)).fijado).toBe(true);
  expect(persisted.find((item) => Number(item.id_mensaje) === Number(attachmentMessage.id_mensaje)).adjuntos).toHaveLength(1);
  const detail = await readJson(await page.request.get(`/api/chat/conversaciones/${conversationId}`), 'Persistencia real del grupo');
  expect(detail.nombre).toBe(groupName);
  expect(detail.members.map((person) => Number(person.usuario_id))).toContain(Number(member.id));
  expect(detail.pinned.map((message) => Number(message.id_mensaje))).toContain(Number(firstMessage.id_mensaje));

  // New presentation features go through the real UI and backend too.
  const photoBytes = await thread.locator(':scope > header').screenshot();
  await page.getByRole('button', { name: 'Preferencias', exact: true }).click();
  const settings = page.locator('.chat-group-settings');
  await settings.getByRole('tab', { name: 'Grupo', exact: true }).click();
  await settings.getByLabel('Descripción del grupo').fill('Grupo ficticio para verificar fotos y opciones desde la interfaz.');
  await settings.getByLabel('Foto del grupo', { exact: true }).setInputFiles({ name: 'foto-grupo-qa.png', mimeType: 'image/png', buffer: photoBytes });
  await settings.getByRole('checkbox', { name: 'Solo administradores pueden enviar mensajes', exact: true }).check();
  const savedGroup = page.waitForResponse((response) => response.url().endsWith(`/conversaciones/${conversationId}/grupo`) && response.request().method() === 'PATCH');
  await settings.getByRole('button', { name: 'Guardar grupo', exact: true }).click();
  expect((await savedGroup).status()).toBe(200);
  await settings.getByRole('button', { name: 'Cerrar preferencias', exact: true }).click();
  const avatar = thread.locator(':scope > header .chat-media-avatar img');
  await expect(avatar).toBeVisible();
  await expect.poll(() => avatar.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
  const uploadPhoto = page.waitForResponse((response) => response.url().endsWith(`/conversaciones/${conversationId}/adjuntos`) && response.request().method() === 'POST');
  await thread.locator('input[type="file"]').setInputFiles({ name: 'imagen-compartida-qa.png', mimeType: 'image/png', buffer: photoBytes });
  expect((await uploadPhoto).status()).toBe(201);
  await thread.getByRole('button', { name: 'Ver imagen imagen-compartida-qa.png', exact: true }).click();
  const viewer = page.getByRole('dialog', { name: 'imagen-compartida-qa.png', exact: true });
  await expect(viewer.getByRole('button', { name: 'Ampliar imagen', exact: true })).toBeEnabled();
  await viewer.getByRole('button', { name: 'Ampliar imagen', exact: true }).click();
  await viewer.getByRole('button', { name: 'Cerrar imagen', exact: true }).click();
  const previousAppearance = await readJson(await page.request.get('/api/chat/apariencia'), 'Apariencia previa');
  try {
    await page.goto('/chat');
    await page.getByRole('button', { name: 'Apariencia del chat', exact: true }).click();
    const appearance = page.getByRole('dialog', { name: 'Apariencia del chat', exact: true });
    await appearance.locator('input[type=file]').setInputFiles({ name: 'fondo-qa.png', mimeType: 'image/png', buffer: photoBytes });
    await appearance.getByLabel('Tamaño de los mensajes').selectOption('grande');
    await appearance.getByRole('button', { name: 'Guardar apariencia', exact: true }).click();
    await expect(appearance).toHaveCount(0);
    await page.goto(`/chat/${conversationId}`);
    await expect(page.locator('.chat-page')).toHaveAttribute('data-background', 'personalizado');
    await expect(page.locator('.chat-page')).toHaveAttribute('data-text-size', 'grande');
    expect(await page.locator('.chat-messages').evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('data:image/jpeg');
    const persistedAppearance = await readJson(await page.request.get('/api/chat/apariencia'), 'Fondo real persistente');
    expect(persistedAppearance.fondo).toBe('personalizado');
  } finally {
    await readJson(await page.request.patch('/api/chat/apariencia', { data: previousAppearance }), 'Restaurar apariencia previa de la cuenta QA');
  }
  await page.reload();
  await expect(avatar).toBeVisible();
  await expect(page.locator('.chat-page')).toHaveAttribute('data-background', previousAppearance.fondo);

  // Keep screenshots focused on this run's fictitious conversation, not unrelated QA data.
  if (testInfo.project.name === 'escritorio') {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('textbox', { name: 'Buscar conversaciones o mensajes' }).fill(groupName);
    await expect(page.locator('.chat-conversations > button')).toHaveCount(1);
  }
  await expect(editor).toBeEnabled();
  await expect(editor).toBeInViewport();
  await expect(thread.getByRole('button', { name: 'Enviar', exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath(`chat-real-${testInfo.project.name}.png`), fullPage: true });
  await testInfo.attach('chat-real-evidence', {
    body: JSON.stringify({
      conversationId, groupName, messageIds: messages.map((message) => message.id_mensaje),
      attachmentMessageId: attachmentMessage.id_mensaje, attachmentBytesMatch: true,
      urgentVerified: canUrgent, mentionAccepted: true, pinnedPersisted: true,
      floatingSendPersisted: true, fullDockDraftRoundTrip: true,
      groupPhotoPersisted: true, imageViewerReal: true, customAppearancePersistedAndRestored: true,
      scope: 'HTTP QA aislado; una cuenta autenticada. No acredita TLS ni entrega/lectura multiusuario. No se eliminaron datos ni se modificaron cuentas.'
    }, null, 2),
    contentType: 'application/json'
  });
});
