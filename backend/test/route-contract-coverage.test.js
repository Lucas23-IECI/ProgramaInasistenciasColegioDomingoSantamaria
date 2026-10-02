const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { createAnalyticsRouter } = require('../routes/analytics');
const { createCoexistenceRouter } = require('../routes/coexistence');
const { createStudentDocumentsRouter } = require('../routes/studentDocuments');
const { createVisitsExtendedRouter } = require('../routes/visitsExtended');

const pass = (_req, _res, next) => next();
const permission = () => pass;
const audit = async () => {};

const queryResult = (sql) => {
  const source = String(sql);
  if (/COUNT\(\*\).*\btotal\b/isu.test(source)) return { rowCount: 1, rows: [{ total: 0 }] };
  if (/COUNT\(\*\) FILTER|SELECT\s+\(SELECT COUNT/isu.test(source)) return { rowCount: 1, rows: [{}] };
  return { rowCount: 0, rows: [] };
};

const createPool = () => ({
  query: async (sql) => queryResult(sql),
  connect: async () => ({
    query: async (sql) => queryResult(sql),
    release: () => {},
  }),
});

const startApp = async ({ pool = createPool() } = {}) => {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => {
    req.user = { id: 7, correo: 'equipo@ldsm.local', nombre: 'Equipo QA' };
    next();
  });
  app.use('/analytics', createAnalyticsRouter({
    pool, verifyToken: pass, verifyPermission: permission, insertarAudit: audit, getClientIp: () => '127.0.0.1',
  }));
  app.use('/coexistence', createCoexistenceRouter({
    pool, verifyToken: pass, verifyPermission: permission, insertarAudit: audit, getClientIp: () => '127.0.0.1',
  }));
  app.use('/documents', createStudentDocumentsRouter({
    pool, verifyToken: pass, verifyPermission: permission, verifyAnyPermission: permission, insertarAudit: audit,
  }));
  app.use('/visits', createVisitsExtendedRouter({
    pool, verifyToken: pass, verifyPermission: permission, verifyAnyPermission: permission, insertarAudit: audit,
  }));
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};

const request = async (baseUrl, entry) => {
  const response = await fetch(`${baseUrl}${entry.path}`, {
    method: entry.method || 'GET',
    headers: entry.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: entry.body === undefined ? undefined : JSON.stringify(entry.body),
  });
  if (entry.status !== 404) {
    assert.notEqual(response.status, 404, `${entry.method || 'GET'} ${entry.path} no alcanzó su ruta`);
  }
  if (entry.status !== 500) {
    assert.notEqual(response.status, 500, `${entry.method || 'GET'} ${entry.path} produjo un fallo interno`);
  }
  if (entry.status) assert.equal(response.status, entry.status, `${entry.method || 'GET'} ${entry.path}`);
  await response.arrayBuffer();
};

test('las rutas de analítica ejercen listados y rechazan entradas inválidas antes de consultar datos', async (t) => {
  const application = await startApp();
  t.after(application.close);
  const cases = [
    { path: '/analytics/institucional?desde=2026-02-30&hasta=2026-03-01', status: 400 },
    { path: '/analytics/institucional/exportar?formato=zip', status: 400 },
    { path: '/analytics/programaciones', status: 200 },
    { method: 'POST', path: '/analytics/programaciones', body: {}, status: 400 },
    { method: 'PATCH', path: '/analytics/programaciones/no/estado', body: { activa: true }, status: 400 },
    { path: '/analytics/programaciones/ejecuciones?pagina=1&limite=10', status: 200 },
    { path: '/analytics/programaciones/ejecuciones/no/descargar', status: 400 },
    { method: 'POST', path: '/analytics/programaciones/ejecuciones/no/reintentar', body: {}, status: 400 },
  ];
  for (const entry of cases) await request(application.baseUrl, entry);
});

test('las rutas documentales cubren consultas vacías y validaciones de todas las mutaciones', async (t) => {
  const application = await startApp();
  t.after(application.close);
  const cases = [
    { path: '/documents/resumen', status: 200 },
    { path: '/documents/estudiantes/buscar?q=ana', status: 200 },
    { path: '/documents/documentos?pagina=1&limite=20', status: 200 },
    { path: '/documents/estudiantes/no/expediente', status: 400 },
    { path: '/documents/documentos/no', status: 400 },
    { path: '/documents/versiones/no/descargar', status: 400 },
    { path: '/documents/plantillas', status: 200 },
    { method: 'POST', path: '/documents/estudiantes/no/documentos', body: {}, status: 400 },
    { method: 'POST', path: '/documents/documentos/no/versiones', body: {}, status: 400 },
    { method: 'PATCH', path: '/documents/documentos/no', body: {}, status: 400 },
    { method: 'POST', path: '/documents/plantillas', body: {}, status: 400 },
    { method: 'POST', path: '/documents/estudiantes/no/generar', body: {}, status: 400 },
    { method: 'POST', path: '/documents/versiones/no/ocr', body: {}, status: 400 },
    { method: 'POST', path: '/documents/versiones/no/ocr/revisar', body: {}, status: 400 },
    { method: 'POST', path: '/documents/versiones/no/firmar', body: {}, status: 400 },
  ];
  for (const entry of cases) await request(application.baseUrl, entry);
});

test('las rutas reservadas de Convivencia responden sin datos y validan cada identificador', async (t) => {
  const application = await startApp();
  t.after(application.close);
  const cases = [
    { path: '/coexistence/resumen', status: 200 },
    { path: '/coexistence/personas/buscar?q=ana', status: 200 },
    { path: '/coexistence/casos?pagina=1&limite=20', status: 200 },
    { path: '/coexistence/casos/no', status: 400 },
    { method: 'POST', path: '/coexistence/casos', body: {}, status: 400 },
    { method: 'PATCH', path: '/coexistence/casos/no', body: {}, status: 400 },
    { method: 'POST', path: '/coexistence/casos/no/participantes', body: {}, status: 400 },
    { method: 'POST', path: '/coexistence/casos/no/actuaciones', body: {}, status: 400 },
    { method: 'POST', path: '/coexistence/casos/no/cerrar', body: {}, status: 400 },
    { method: 'POST', path: '/coexistence/casos/no/reabrir', body: {}, status: 400 },
    { method: 'POST', path: '/coexistence/casos/no/documentos', body: {}, status: 400 },
    { path: '/coexistence/documentos/no/descargar', status: 400 },
  ];
  for (const entry of cases) await request(application.baseUrl, entry);
});

test('Portería ampliada cubre todas sus lecturas y rechaza mutaciones incompletas de forma segura', async (t) => {
  const application = await startApp();
  t.after(application.close);
  const reads = [
    '/visits/operacion-ampliada/resumen', '/visits/entidades-externas', '/visits/preinscripciones',
    '/visits/restricciones-acceso', '/visits/encomiendas', '/visits/permanencias-excedidas',
    '/visits/visitantes-frecuentes', '/visits/vehiculos',
    '/visits/emergencias/actual', '/visits/puntos-reunion',
  ];
  for (const path of reads) await request(application.baseUrl, { path, status: 200 });
  const writes = [
    ['POST', '/visits/entidades-externas'], ['POST', '/visits/preinscripciones'],
    ['POST', '/visits/preinscripciones/validar'], ['POST', '/visits/preinscripciones/ingresar'],
    ['PATCH', '/visits/preinscripciones/no/cancelar'], ['POST', '/visits/restricciones-acceso'],
    ['PATCH', '/visits/restricciones-acceso/no/desactivar'], ['POST', '/visits/encomiendas'],
    ['PATCH', '/visits/encomiendas/no/entregar'], ['PATCH', '/visits/visitantes/no/operacion'],
    ['POST', '/visits/vehiculos'], ['POST', '/visits/visitas/no/vehiculos/no'],
    ['POST', '/visits/puntos-reunion'], ['POST', '/visits/emergencias'],
    ['PATCH', '/visits/emergencias/no/personas/no'], ['PATCH', '/visits/emergencias/no/cerrar'],
  ];
  for (const [method, path] of writes) {
    await request(application.baseUrl, { method, path, body: {}, status: 400 });
  }
});

test('las rutas de lectura traducen fallos internos sin dejar solicitudes colgadas', async (t) => {
  const pool = {
    query: async () => { throw new Error('connect ECONNREFUSED postgres'); },
    connect: async () => { throw new Error('connect ECONNREFUSED postgres'); },
  };
  const application = await startApp({ pool });
  t.after(application.close);
  const cases = [
    '/analytics/programaciones', '/analytics/programaciones/ejecuciones',
    '/documents/resumen', '/documents/estudiantes/buscar?q=ana', '/documents/documentos',
    '/documents/estudiantes/1/expediente', '/documents/documentos/1',
    '/documents/versiones/1/descargar', '/documents/plantillas',
    '/coexistence/resumen', '/coexistence/personas/buscar?q=ana', '/coexistence/casos',
    '/coexistence/casos/1', '/coexistence/documentos/1/descargar',
    '/visits/operacion-ampliada/resumen', '/visits/entidades-externas', '/visits/preinscripciones',
    '/visits/restricciones-acceso', '/visits/encomiendas', '/visits/permanencias-excedidas',
    '/visits/visitantes-frecuentes', '/visits/vehiculos',
    '/visits/emergencias/actual', '/visits/puntos-reunion',
  ];
  const originalConsoleError = console.error;
  console.error = () => {};
  t.after(() => { console.error = originalConsoleError; });
  for (const path of cases) await request(application.baseUrl, { path, status: 500 });
});

test('las mutaciones directas válidas atraviesan persistencia, auditoría y respuesta pública', async (t) => {
  const pool = {
    query: async (sql, params = []) => {
      const source = String(sql);
      if (/INSERT INTO reportes_institucionales_programados/u.test(source)) {
        return { rowCount: 1, rows: [{ id_reporte: 4, nombre: params[0], activo: true }] };
      }
      if (/UPDATE reportes_institucionales_programados/u.test(source)) {
        return { rowCount: 1, rows: [{ id_reporte: 4, activo: params[1] }] };
      }
      if (/UPDATE documentos_expediente/u.test(source)) {
        return { rowCount: 1, rows: [{ id_documento_expediente: 2, version_registro: 2 }] };
      }
      if (/INSERT INTO plantillas_documentales/u.test(source)) {
        return { rowCount: 1, rows: [{ id_plantilla: 3, nombre: params[1] }] };
      }
      if (/UPDATE documento_expediente_versiones/u.test(source)) {
        return { rowCount: 1, rows: [{ id_documento_expediente: 2, ocr_estado: params[1] }] };
      }
      if (/UPDATE visitantes SET/u.test(source)) {
        return { rowCount: 1, rows: [{ id: 9, nombre_completo: 'Visita QA', frecuente: params[1], entidad_externa_id: params[2] }] };
      }
      return { rowCount: 1, rows: [{ id: 1, estado: 'ENTREGADA', activo: false }] };
    },
    connect: async () => { throw new Error('La mutación seleccionada no debe abrir una transacción'); },
  };
  const application = await startApp({ pool });
  t.after(application.close);
  const cases = [
    { method: 'POST', path: '/analytics/programaciones', body: { nombre: 'Resumen semanal', frecuencia: 'SEMANAL', formato: 'PDF', dia_semana: 1, hora: '07:30' }, status: 201 },
    { method: 'PATCH', path: '/analytics/programaciones/4/estado', body: { activo: false }, status: 200 },
    { method: 'PATCH', path: '/documents/documentos/2', body: { version_registro: 1, categoria: 'CERTIFICADO', estado: 'PENDIENTE', nivel_acceso: 'RESERVADO', titulo: 'Certificado vigente', vigente_desde: '2026-08-01', vence_en: '2026-12-31' }, status: 200 },
    { method: 'POST', path: '/documents/plantillas', body: { nombre: 'Constancia interna', categoria: 'CERTIFICADO', contenido: 'Contenido institucional suficientemente extenso.', campos_permitidos: ['nombre', 'nombre', 'campo inválido'] }, status: 201 },
    { method: 'POST', path: '/documents/versiones/5/ocr/revisar', body: { accion: 'APROBAR', texto_revisado: 'Texto confirmado' }, status: 200 },
    { method: 'POST', path: '/documents/versiones/6/ocr/revisar', body: { accion: 'RECHAZAR' }, status: 200 },
    { method: 'POST', path: '/visits/entidades-externas', body: { tipo: 'PROVEEDOR', nombre: 'Proveedor QA', email: 'QA@EXAMPLE.CL' }, status: 201 },
    { method: 'POST', path: '/visits/restricciones-acceso', body: { visitante_id: 9, tipo: 'ALERTA', motivo: 'Verificar identidad al ingresar.' }, status: 201 },
    { method: 'PATCH', path: '/visits/restricciones-acceso/1/desactivar', body: { motivo: 'Antecedente institucional resuelto.' }, status: 200 },
    { method: 'POST', path: '/visits/encomiendas', body: { remitente: 'Proveedor', destinatario: 'Secretaría', descripcion: 'Documentación' }, status: 201 },
    { method: 'PATCH', path: '/visits/encomiendas/1/entregar', body: { observaciones: 'Entregada personalmente.' }, status: 200 },
    { path: '/visits/visitantes-operativos?q=ana', status: 200 },
    { method: 'PATCH', path: '/visits/visitantes/9/operacion', body: { frecuente: true }, status: 200 },
    { method: 'POST', path: '/visits/vehiculos', body: { patente: 'ABCD12', tipo: 'AUTOMOVIL', marca: 'Marca' }, status: 201 },
    { method: 'POST', path: '/visits/puntos-reunion', body: { codigo: 'PATIO_1', nombre: 'Patio principal' }, status: 201 },
  ];
  for (const entry of cases) await request(application.baseUrl, entry);
});

test('Portería completa los flujos transaccionales de vehículo y emergencia', async (t) => {
  const transactionalQuery = async (sql) => {
    const source = String(sql);
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*$/iu.test(source)) return { rowCount: 0, rows: [] };
    if (/SELECT id, estado FROM visitas/iu.test(source)) return { rowCount: 1, rows: [{ id: 11, estado: 'DENTRO' }] };
    if (/SELECT id, activo FROM visita_vehiculos/iu.test(source)) return { rowCount: 1, rows: [{ id: 12, activo: true }] };
    if (/INSERT INTO visita_vehiculo_movimientos/iu.test(source)) return { rowCount: 1, rows: [{ id: 13, visita_id: 11, vehiculo_id: 12 }] };
    if (/SELECT id FROM visita_emergencias WHERE estado = 'ACTIVA'/iu.test(source)) return { rowCount: 0, rows: [] };
    if (/INSERT INTO visita_emergencias/iu.test(source)) return { rowCount: 1, rows: [{ id: 21, tipo: 'SIMULACRO', estado: 'ACTIVA' }] };
    if (/INSERT INTO visita_emergencia_presentes/iu.test(source)) return { rowCount: 1, rows: [] };
    if (/SELECT id FROM visita_emergencias WHERE id=\$1 AND estado='ACTIVA'/iu.test(source)) return { rowCount: 1, rows: [{ id: 21 }] };
    if (/UPDATE visita_emergencia_presentes/iu.test(source)) return { rowCount: 1, rows: [{ emergencia_id: 21, visita_id: 11, estado: 'CONFIRMADO' }] };
    if (source.includes('COUNT(*)::int AS total')) return { rowCount: 1, rows: [{ total: 0 }] };
    if (source.includes("UPDATE visita_emergencias SET estado='CERRADA'")) return { rowCount: 1, rows: [{ id: 21, estado: 'CERRADA' }] };
    return { rowCount: 0, rows: [] };
  };
  const pool = {
    query: transactionalQuery,
    connect: async () => ({ query: transactionalQuery, release: () => {} }),
  };
  const application = await startApp({ pool });
  t.after(application.close);

  const cases = [
    { method: 'POST', path: '/visits/visitas/11/vehiculos/12', body: {}, status: 201 },
    { method: 'POST', path: '/visits/emergencias', body: { tipo: 'SIMULACRO', descripcion: 'Simulacro preventivo', punto_reunion_id: 3 }, status: 201 },
    { method: 'PATCH', path: '/visits/emergencias/21/personas/11', body: { estado: 'CONFIRMADO', punto_reunion_id: 3, observaciones: 'Persona verificada.' }, status: 200 },
  ];
  for (const entry of cases) await request(application.baseUrl, entry);
});

test('Portería cierra una emergencia sin personas pendientes', async (t) => {
  const responses = [
    { rowCount: 0, rows: [] },
    { rowCount: 1, rows: [{ id: 21 }] },
    { rowCount: 1, rows: [{ total: 0 }] },
    { rowCount: 1, rows: [{ id: 21, estado: 'CERRADA' }] },
    { rowCount: 0, rows: [] },
  ];
  const client = {
    query: async () => responses.shift() || { rowCount: 0, rows: [] },
    release: () => {},
  };
  const application = await startApp({
    pool: { query: async () => ({ rowCount: 0, rows: [] }), connect: async () => client },
  });
  t.after(application.close);
  await request(application.baseUrl, {
    method: 'PATCH',
    path: '/visits/emergencias/21/cerrar',
    body: { observaciones: 'Simulacro finalizado correctamente.' },
    status: 200,
  });
});

test('Portería distingue los conflictos al vincular un vehículo', async () => {
  const scenarios = [
    { visit: [], vehicle: [{ id: 12, activo: true }], movement: [], status: 404 },
    { visit: [{ id: 11, estado: 'SALIO' }], vehicle: [{ id: 12, activo: true }], movement: [], status: 409 },
    { visit: [{ id: 11, estado: 'DENTRO' }], vehicle: [{ id: 12, activo: false }], movement: [], status: 409 },
    { visit: [{ id: 11, estado: 'DENTRO' }], vehicle: [{ id: 12, activo: true }], movement: [], status: 409 },
  ];
  for (const scenario of scenarios) {
    const query = async (sql) => {
      const source = String(sql);
      if (/SELECT id, estado FROM visitas/iu.test(source)) return { rowCount: scenario.visit.length, rows: scenario.visit };
      if (/SELECT id, activo FROM visita_vehiculos/iu.test(source)) return { rowCount: scenario.vehicle.length, rows: scenario.vehicle };
      if (/INSERT INTO visita_vehiculo_movimientos/iu.test(source)) return { rowCount: scenario.movement.length, rows: scenario.movement };
      return { rowCount: 0, rows: [] };
    };
    const application = await startApp({
      pool: { query, connect: async () => ({ query, release: () => {} }) },
    });
    try {
      await request(application.baseUrl, {
        method: 'POST', path: '/visits/visitas/11/vehiculos/12', body: {}, status: scenario.status,
      });
    } finally {
      await application.close();
    }
  }
});

test('Portería protege la emergencia activa y sus verificaciones pendientes', async () => {
  const scenarios = [
    {
      path: '/visits/emergencias', method: 'POST',
      body: { tipo: 'EVACUACION', descripcion: 'Evacuación preventiva' }, status: 409,
      responses: [{ rows: [] }, { rows: [{ id: 21 }] }, { rows: [] }],
    },
    {
      path: '/visits/emergencias/21/personas/11', method: 'PATCH',
      body: { estado: 'CONFIRMADO' }, status: 409,
      responses: [{ rows: [] }, { rows: [] }, { rows: [] }],
    },
    {
      path: '/visits/emergencias/21/personas/11', method: 'PATCH',
      body: { estado: 'NO_UBICADO' }, status: 404,
      responses: [{ rows: [] }, { rows: [{ id: 21 }] }, { rows: [] }, { rows: [] }],
    },
    {
      path: '/visits/emergencias/21/cerrar', method: 'PATCH',
      body: { observaciones: 'Cierre revisado con pendientes.' }, status: 409,
      responses: [{ rows: [] }, { rows: [{ id: 21 }] }, { rows: [{ total: 2 }] }, { rows: [] }],
    },
  ];
  for (const scenario of scenarios) {
    const responses = scenario.responses.map((result) => ({ rowCount: result.rows.length, ...result }));
    const client = { query: async () => responses.shift() || { rowCount: 0, rows: [] }, release: () => {} };
    const application = await startApp({
      pool: { query: async () => ({ rowCount: 0, rows: [] }), connect: async () => client },
    });
    try {
      await request(application.baseUrl, scenario);
    } finally {
      await application.close();
    }
  }
});
