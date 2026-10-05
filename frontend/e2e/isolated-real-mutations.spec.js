/* global process */
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dismissReleaseNotes } from './helpers.js';

const adminEmail = process.env.E2E_ADMIN_EMAIL || 'admin@ldsm.local';
const password = process.env.DEFAULT_USER_PASSWORD;
const auditRun = process.env.E2E_AUDIT_RUN || 'codex-audit';
// Esta suite escribe y puede revertir importaciones: nunca ejecutarla por defecto
// sobre la instalación que el usuario utiliza para revisar sus datos.
test.beforeEach(async ({ baseURL }) => {
  test.skip(process.env.E2E_ISOLATED_MUTATIONS !== '1', 'Requiere una base aislada y E2E_ISOLATED_MUTATIONS=1.');
  const url = new URL(baseURL);
  expect(['127.0.0.1', 'localhost']).toContain(url.hostname);
  expect(url.port).not.toBe('');
  expect(url.port).not.toBe('80');
});
const documentFixture = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../backend/test/fixtures/certificado-prueba.pdf'
);

const login = async (request) => {
  test.skip(!password, 'DEFAULT_USER_PASSWORD no está configurada para la auditoría aislada.');
  const response = await request.post('/api/auth/login', { data: { correo: adminEmail, password } });
  expect(response.ok(), `El acceso de auditoría respondió ${response.status()}.`).toBe(true);
};

const expectOk = async (response, action) => {
  const body = await response.json().catch(() => ({}));
  expect(response.ok(), `${action} respondió ${response.status()}: ${body.message || 'sin detalle'}`).toBe(true);
  return body;
};

test('tareas internas ejecutan el ciclo real crear, iniciar, completar e historial', async ({ request }) => {
  await login(request);
  const created = await expectOk(await request.post('/api/operaciones/tareas', { data: {
    titulo: `[AUDITORÍA] Tarea ${auditRun}`,
    detalle: 'Registro aislado para validar el contrato real con PostgreSQL.',
    prioridad: 'ALTA',
    fecha_limite: '2026-09-15'
  } }), 'crear tarea');

  const started = await expectOk(await request.patch(`/api/operaciones/tareas/${created.id_tarea}/estado`, {
    data: { estado: 'EN_PROGRESO' }
  }), 'iniciar tarea');
  expect(started.estado).toBe('EN_PROGRESO');

  const completed = await expectOk(await request.patch(`/api/operaciones/tareas/${created.id_tarea}/estado`, {
    data: { estado: 'COMPLETADA', motivo: 'Ciclo aislado verificado de extremo a extremo.' }
  }), 'completar tarea');
  expect(completed.estado).toBe('COMPLETADA');

  const history = await expectOk(await request.get(`/api/operaciones/tareas/${created.id_tarea}`), 'leer historial de tarea');
  expect(history.eventos.map((event) => event.tipo)).toEqual(['CREADA', 'ESTADO_CAMBIADO', 'ESTADO_CAMBIADO']);
});

test('la interfaz real conserva la fecha y completa el ciclo de una tarea interna', async ({ page }, testInfo) => {
  await login(page.context().request);
  await page.goto('/admin/operacion');
  await dismissReleaseNotes(page);

  const title = `[AUDITORÍA UI] Tarea ${auditRun}-${testInfo.project.name}`;
  await page.getByLabel('Título de la tarea').fill(title);
  await page.getByLabel('Prioridad').selectOption('URGENTE');
  await page.getByLabel('Responsable').selectOption({ index: 1 });
  await page.getByLabel('Fecha límite').fill('2026-09-18');
  await page.getByLabel('Detalle opcional').fill('Ciclo UI real contra la copia aislada de PostgreSQL.');

  const createdResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith('/api/operaciones/tareas')
      && response.request().method() === 'POST'
  ));
  await page.getByRole('button', { name: 'Crear tarea interna' }).click();
  const createdResponse = await createdResponsePromise;
  expect(createdResponse.status()).toBe(201);
  const created = await createdResponse.json();

  const taskCard = page.locator('.operations-task-item').filter({ hasText: title });
  await expect(taskCard).toContainText('vence 18-09-2026');
  await taskCard.getByRole('button', { name: 'Iniciar' }).click();
  await expect(taskCard).toContainText('En curso');

  await taskCard.getByRole('button', { name: 'Historial' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByText(/Tarea interna creada\./u)).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();

  await taskCard.getByRole('button', { name: 'Completar' }).click();
  await page.getByLabel('Motivo de resolución').fill('Flujo real comprobado manualmente de extremo a extremo.');
  await page.getByRole('button', { name: 'Completar tarea' }).click();
  await expect(taskCard).toHaveCount(0);

  const history = await expectOk(
    await page.context().request.get(`/api/operaciones/tareas/${created.id_tarea}`),
    'leer historial UI de tarea'
  );
  expect(history.tarea.fecha_limite).toContain('2026-09-18');
  expect(history.tarea.estado).toBe('COMPLETADA');
  expect(history.eventos.map((event) => event.tipo)).toEqual(['CREADA', 'ESTADO_CAMBIADO', 'ESTADO_CAMBIADO']);
});

test('la interfaz real de Convivencia conserva fecha, revisión y participante', async ({ page }, testInfo) => {
  await login(page.context().request);
  await page.goto('/admin/convivencia');
  await dismissReleaseNotes(page);

  const title = `[AUDITORÍA UI] Convivencia ${auditRun}-${testInfo.project.name}-${Date.now()}`;
  await page.getByRole('button', { name: 'Registrar situación' }).click();
  await page.getByLabel('Título breve del caso').fill(title);
  await page.getByLabel('Fecha de la situación').fill('2026-08-30');
  await page.getByLabel('Primera fecha de revisión').fill('2026-09-05');
  await page.getByLabel('Descripción inicial').fill('Caso ficticio y no sensible para verificar persistencia real de todos los campos relacionados.');
  await page.getByLabel('Buscar persona').fill('Fernanda QA Historica');
  await page.getByRole('button', { name: /Fernanda QA Historica Pre-Kinder/u }).click();

  await expect(page.getByLabel('Fecha de la situación')).toHaveValue('2026-08-30');
  await expect(page.getByLabel('Primera fecha de revisión')).toHaveValue('2026-09-05');

  const createdResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith('/api/convivencia/casos')
      && response.request().method() === 'POST'
  ));
  await page.getByRole('button', { name: 'Crear caso protegido' }).click();
  const createdResponse = await createdResponsePromise;
  expect(createdResponse.status()).toBe(201);
  const created = await createdResponse.json();
  await expect(page).toHaveURL(new RegExp(`/admin/convivencia/${created.id_caso}$`, 'u'));
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await expect(page.getByText('Fernanda QA Historica', { exact: true })).toBeVisible();

  const detail = await expectOk(
    await page.context().request.get(`/api/convivencia/casos/${created.id_caso}`),
    'leer caso de Convivencia creado por la interfaz'
  );
  expect(String(detail.case.fecha_situacion)).toContain('2026-08-30');
  expect(String(detail.case.proxima_revision)).toContain('2026-09-05');
  expect(detail.participants.some((participant) => participant.nombre === 'Fernanda QA Historica')).toBe(true);

  await expectOk(await page.context().request.post(`/api/convivencia/casos/${created.id_caso}/cerrar`, {
    data: { motivo: 'Cierre controlado al finalizar la auditoría aislada.' }
  }), 'cerrar caso de Convivencia aislado');
});

test('Gestión documental conserva campos, guarda el PDF y permite descargar el original', async ({ page }, testInfo) => {
  await login(page.context().request);
  const students = await expectOk(
    await page.context().request.get('/api/documentos-estudiantes/estudiantes/buscar?q=Fernanda'),
    'buscar estudiante para el expediente documental'
  );
  const student = students.find((item) => item.nombre === 'Fernanda QA Historica') || students[0];
  test.skip(!student, 'La copia aislada no contiene un estudiante para probar Gestión documental.');

  await page.goto(`/admin/documentos/estudiante/${student.id_alumno}`);
  await dismissReleaseNotes(page);
  await page.getByRole('button', { name: 'Incorporar documento' }).click();

  const title = `[AUDITORÍA UI] Certificado ${auditRun}-${testInfo.project.name}-${Date.now()}`;
  await page.getByLabel('Título').pressSequentially(title, { delay: 5 });
  await expect(page.getByLabel('Título')).toBeFocused();
  await page.getByLabel('Categoría').selectOption('CERTIFICADO');
  await page.getByLabel('Estado').selectOption('VIGENTE');
  await page.getByLabel('Nivel de acceso').selectOption('RESERVADO');
  await page.getByLabel('Vigente desde').fill('2026-08-30');
  await page.getByLabel('Vence el').fill('2026-09-30');
  await page.getByLabel('Descripción').fill('Documento ficticio para comprobar almacenamiento, metadatos y descarga en la copia aislada.');
  await page.locator('.docs-modal input[type="file"]').setInputFiles(documentFixture);

  await expect(page.getByLabel('Vigente desde')).toHaveValue('2026-08-30');
  await expect(page.getByLabel('Vence el')).toHaveValue('2026-09-30');
  await expect(page.getByLabel('Título')).toHaveValue(title);

  const createResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith(`/api/documentos-estudiantes/estudiantes/${student.id_alumno}/documentos`)
      && response.request().method() === 'POST'
  ));
  await page.getByRole('button', { name: 'Guardar documento' }).click();
  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBe(201);
  const created = await createResponse.json();

  const documentCard = page.locator('.docs-card').filter({ hasText: title });
  await expect(documentCard).toContainText('Certificado');
  await expect(documentCard).toContainText('30-09-2026');
  await documentCard.click();
  await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible();

  const detail = await expectOk(
    await page.context().request.get(`/api/documentos-estudiantes/documentos/${created.document.id_documento_expediente}`),
    'leer el documento incorporado por la interfaz'
  );
  expect(String(detail.document.vigente_desde)).toContain('2026-08-30');
  expect(String(detail.document.vence_en)).toContain('2026-09-30');
  expect(detail.versions).toHaveLength(1);
  expect(detail.versions[0].nombre_original).toBe('certificado-prueba.pdf');
  expect(detail.versions[0].sha256).toMatch(/^[a-f0-9]{64}$/u);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Descargar' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('certificado-prueba.pdf');
  const downloadedPath = await download.path();
  expect(downloadedPath).toBeTruthy();

  await page.getByRole('button', { name: 'Nueva versión' }).click();
  await page.locator('.docs-modal input[type="file"]').setInputFiles(documentFixture);
  await page.getByLabel('Notas de esta versión').fill('Segunda versión ficticia incorporada desde la interfaz real.');
  const versionResponsePromise = page.waitForResponse((response) => (
    response.url().endsWith(`/api/documentos-estudiantes/documentos/${created.document.id_documento_expediente}/versiones`)
      && response.request().method() === 'POST'
  ));
  await page.getByRole('button', { name: 'Crear versión' }).click();
  expect((await versionResponsePromise).status()).toBe(201);
  await expect(page.getByRole('heading', { level: 3, name: /Versión 2 · certificado-prueba\.pdf/u })).toBeVisible();

  await page.getByRole('button', { name: 'Firmar internamente' }).first().click();
  await page.getByLabel('Tipo').selectOption('CONFORMIDAD');
  await page.getByLabel('Declaración').fill('Declaro que esta versión ficticia fue revisada durante la auditoría aislada.');
  const signatureResponsePromise = page.waitForResponse((response) => (
    response.url().includes('/api/documentos-estudiantes/versiones/')
      && response.url().endsWith('/firmar')
      && response.request().method() === 'POST'
  ));
  await page.getByRole('button', { name: 'Registrar firma' }).click();
  expect((await signatureResponsePromise).status()).toBe(201);
  await expect(page.getByText(/CONFORMIDAD ·/u).first()).toBeVisible();

  const finalDetail = await expectOk(
    await page.context().request.get(`/api/documentos-estudiantes/documentos/${created.document.id_documento_expediente}`),
    'comprobar versión y firma documentales'
  );
  expect(finalDetail.versions).toHaveLength(2);
  expect(finalDetail.versions[0].numero_version).toBe(2);
  expect(finalDetail.versions[0].firmas).toHaveLength(1);

  await expectOk(await page.context().request.patch(
    `/api/documentos-estudiantes/documentos/${created.document.id_documento_expediente}`,
    { data: {
      ...finalDetail.document,
      estado: 'ARCHIVADO',
      vigente_desde: String(finalDetail.document.vigente_desde || '').slice(0, 10),
      vence_en: String(finalDetail.document.vence_en || '').slice(0, 10)
    } }
  ), 'archivar el documento aislado al finalizar la prueba');
});

test('agenda ejecuta creación, lectura y cancelación reales', async ({ request }) => {
  await login(request);
  const start = new Date(Date.now() + 7 * 86_400_000);
  start.setUTCHours(14, 0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60_000);
  const created = await expectOk(await request.post('/api/agenda', { data: {
    titulo: `[AUDITORÍA] Agenda ${auditRun}`,
    detalle: 'Evento personal aislado para comprobar persistencia real.',
    tipo: 'REVISION',
    inicio: start.toISOString(),
    fin: end.toISOString(),
    todo_el_dia: false,
    ubicacion: 'Entorno de auditoría',
    participantes_ids: [],
    recordatorio_minutos: 30
  } }), 'crear evento');

  const detail = await expectOk(await request.get(`/api/agenda/${created.id_evento}`), 'leer evento');
  expect(detail.event.titulo).toContain('[AUDITORÍA] Agenda');
  expect(detail.event.estado).toBe('PROGRAMADO');

  await expectOk(await request.patch(`/api/agenda/${created.id_evento}/cancelar`, {
    data: { motivo: 'Cancelación controlada al finalizar la auditoría aislada.' }
  }), 'cancelar evento');
  const cancelled = await expectOk(await request.get(`/api/agenda/${created.id_evento}`), 'leer evento cancelado');
  expect(cancelled.event.estado).toBe('CANCELADO');
});

test('recursos ejecuta inventario, edición, préstamo, devolución y solicitudes reales', async ({ request }) => {
  await login(request);
  const people = await expectOk(await request.get('/api/recursos/personas'), 'leer personas');
  expect(people.people.length).toBeGreaterThan(0);
  const userId = people.people[0].id;
  const code = `AUD-${Date.now()}`;

  const created = await expectOk(await request.post('/api/recursos/catalogo', { data: {
    nombre: `[AUDITORÍA] Proyector ${auditRun}`,
    categoria: 'Tecnología',
    codigo_interno: code,
    descripcion: 'Recurso aislado para validar las transacciones reales.',
    ubicacion: 'Bodega de auditoría',
    stock_total: 4,
    estado: 'ACTIVO'
  } }), 'crear recurso');

  const catalog = await expectOk(await request.get(`/api/recursos/catalogo?pagina=1&limite=12&q=${encodeURIComponent(code)}`), 'buscar recurso');
  const resource = catalog.items.find((item) => Number(item.id_recurso) === Number(created.id_recurso));
  expect(resource).toBeTruthy();
  await expectOk(await request.patch(`/api/recursos/catalogo/${created.id_recurso}`, { data: {
    nombre: resource.nombre,
    categoria: 'Audiovisual',
    codigo_interno: resource.codigo_interno,
    descripcion: resource.descripcion,
    ubicacion: 'Sala audiovisual',
    stock_total: 4,
    estado: 'ACTIVO',
    version: resource.version
  } }), 'editar recurso');

  const dueAt = new Date(Date.now() + 14 * 86_400_000).toISOString();
  const loan = await expectOk(await request.post('/api/recursos/prestamos', { data: {
    id_recurso: created.id_recurso,
    usuario_id: userId,
    cantidad: 1,
    vence_en: dueAt,
    condicion_entrega: 'Entregado en buenas condiciones.',
    observaciones: 'Préstamo aislado de auditoría.'
  } }), 'crear préstamo');
  await expectOk(await request.patch(`/api/recursos/prestamos/${loan.id_prestamo}/devolver`, {
    data: { condicion_devolucion: 'Devuelto en buenas condiciones.' }
  }), 'devolver préstamo');

  const resourceRequest = await expectOk(await request.post('/api/recursos/solicitudes', { data: {
    id_recurso: created.id_recurso,
    cantidad: 1,
    motivo: 'Validar el circuito aislado de solicitudes.',
    necesita_en: '2026-09-20'
  } }), 'crear solicitud');
  await expectOk(await request.patch(`/api/recursos/solicitudes/${resourceRequest.id_solicitud}/decision`, {
    data: { estado: 'APROBADA', respuesta: 'Solicitud aprobada durante la auditoría aislada.' }
  }), 'aprobar solicitud');
  const delivered = await expectOk(await request.post(`/api/recursos/solicitudes/${resourceRequest.id_solicitud}/entregar`, {
    data: { vence_en: dueAt, condicion_entrega: 'Entrega aislada confirmada.' }
  }), 'entregar solicitud');
  await expectOk(await request.patch(`/api/recursos/prestamos/${delivered.id_prestamo}/devolver`, {
    data: { condicion_devolucion: 'Devolución aislada confirmada.' }
  }), 'devolver solicitud entregada');

  const cancellable = await expectOk(await request.post('/api/recursos/solicitudes', { data: {
    id_recurso: created.id_recurso,
    cantidad: 1,
    motivo: 'Comprobar cancelación controlada.',
    necesita_en: '2026-09-21'
  } }), 'crear solicitud cancelable');
  await expectOk(await request.patch(`/api/recursos/solicitudes/${cancellable.id_solicitud}/cancelar`, { data: {} }), 'cancelar solicitud');

  const summary = await expectOk(await request.get('/api/recursos/resumen'), 'leer resumen final');
  expect(Number(summary.unidades_disponibles)).toBeGreaterThanOrEqual(4);
});

test('dos préstamos simultáneos nunca entregan la misma unidad disponible', async ({ request }) => {
  await login(request);
  const people = await expectOk(await request.get('/api/recursos/personas'), 'leer personas');
  const resource = await expectOk(await request.post('/api/recursos/catalogo', { data: {
    nombre: `[AUDITORÍA] Stock concurrente ${Date.now()}`, categoria: 'Tecnología', stock_total: 1, estado: 'ACTIVO'
  } }), 'crear recurso de una unidad');
  const attempts = await Promise.all([1, 2].map(() => request.post('/api/recursos/prestamos', { data: {
    id_recurso: resource.id_recurso, usuario_id: people.people[0].id, cantidad: 1
  } })));
  expect(attempts.map((response) => response.status()).sort()).toEqual([201, 409]);
  const loan = await attempts.find((response) => response.status() === 201).json();
  const returns = await Promise.all([1, 2].map(() => request.patch(`/api/recursos/prestamos/${loan.id_prestamo}/devolver`, {
    data: { condicion_devolucion: 'Devolución concurrente de prueba.' }
  })));
  expect(returns.map((response) => response.status()).sort()).toEqual([200, 409]);
});

test('Recursos permite crear y prestar desde la interfaz real y devolver sin perder stock', async ({ page }, testInfo) => {
  await login(page.request);
  await page.goto('/admin/recursos');
  await dismissReleaseNotes(page);
  const code = `UI-${Date.now()}`;
  await page.getByRole('button', { name: 'Agregar recurso', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Agregar recurso' });
  await dialog.getByLabel('Nombre', { exact: true }).fill(`[AUDITORÍA UI] Proyector ${code}`);
  await dialog.getByLabel('Categoría', { exact: true }).fill('Audiovisual');
  await dialog.getByLabel('Código interno').fill(code);
  await dialog.getByLabel('Stock total').fill('2');
  await dialog.getByRole('button', { name: 'Confirmar' }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('textbox', { name: /Buscar/ }).fill(code);
  await page.getByRole('textbox', { name: /Buscar/ }).press('Enter');
  await page.getByRole('button', { name: 'Prestar', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Registrar préstamo' });
  await dialog.getByLabel('Persona').selectOption({ index: 1 });
  await dialog.getByLabel('Cantidad').fill('1');
  const loanResponse = page.waitForResponse((response) => response.url().endsWith('/api/recursos/prestamos') && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Confirmar' }).click();
  const loan = await expectOk(await loanResponse, 'préstamo desde UI');
  await expect(page.getByText('1 de 2', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('recursos-prestamo-real.png'), fullPage: true });
  await expectOk(await page.request.patch(`/api/recursos/prestamos/${loan.id_prestamo}/devolver`, {
    data: { condicion_devolucion: 'Devuelto después de verificar la interfaz.' }
  }), 'devolución del préstamo UI');
  await page.reload();
  await page.getByRole('textbox', { name: /Buscar/ }).fill(code);
  await page.getByRole('textbox', { name: /Buscar/ }).press('Enter');
  const returnedResource = page.locator('.resource-card').filter({ hasText: code });
  await expect(returnedResource).toHaveCount(1);
  await expect(returnedResource.getByText('2 de 2', { exact: true })).toBeVisible();
});

test('búsqueda institucional consulta dominios reales sin exponer identificadores en resultados', async ({ request }) => {
  await login(request);
  const students = await expectOk(await request.get('/api/students'), 'leer estudiante para búsqueda');
  // Las importaciones revertidas conservan filas inactivas para trazabilidad.
  // La búsqueda global solo ofrece registros activos: usar el mismo universo.
  const student = students.find((item) => item.activo === true);
  test.skip(!student, 'La copia aislada no contiene estudiantes para comprobar la búsqueda real.');

  const fullName = [student.nombres, student.paterno, student.materno].filter(Boolean).join(' ').trim();
  const searchTerm = String(student.paterno || student.nombres || fullName).trim().slice(0, 30);
  test.skip(searchTerm.length < 2, 'La ficha disponible no contiene un nombre apto para la búsqueda.');

  const result = await expectOk(
    await request.get(`/api/busqueda-global?q=${encodeURIComponent(searchTerm)}`),
    'buscar en registros institucionales'
  );
  expect(result.total).toBeGreaterThan(0);
  const studentGroup = result.groups.find((group) => group.key === 'students');
  expect(studentGroup).toBeTruthy();
  expect(studentGroup.items.some((item) => String(item.id) === String(student.id_alumno || student.id))).toBe(true);
  const serializedResults = JSON.stringify(result.groups);
  if (student.rut) expect(serializedResults).not.toContain(String(student.rut));
  if (student.documento_erp) expect(serializedResults).not.toContain(String(student.documento_erp));
});

// La reversión real está en import-real-ui.spec.js: crea su propia planilla,
// nunca selecciona ni compensa importaciones preexistentes de otra prueba.
