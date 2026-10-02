const test = require('node:test');
const assert = require('node:assert/strict');

const permissions = require('../utils/permissions');
const {
  createDocument,
  createDocumentFromBuffer,
  deleteDocumentIfUnreferenced,
  parseDocumentData,
  removeStoredFile,
  resolveDocumentPath,
  sanitizeOriginalName,
} = require('../services/documentService');
const { recognizeImage } = require('../services/documentOcrService');
const { runDueInstitutionalReports, startInstitutionalReportScheduler } = require('../services/institutionalReportScheduler');
const { buildInstitutionalAnalytics } = require('../services/institutionalAnalyticsService');
const { operateCases, upsertSignalAndCase } = require('../services/institutionalFollowUpService');

test('los ayudantes de permisos recorren catálogo, perfiles, validación y reemplazos', async () => {
  const calls = [];
  const queryable = {
    query: async (sql, params = []) => {
      const source = String(sql);
      calls.push({ source, params });
      if (/FROM permisos_sistema\s+WHERE codigo <>/u.test(source)) {
        return { rows: [{ codigo: 'a.view' }, { codigo: 'b.manage' }] };
      }
      if (/FROM permisos_rol/u.test(source) && /ORDER BY permiso_codigo/u.test(source)) {
        return { rows: [{ permiso_codigo: 'a.view' }] };
      }
      if (/FROM perfiles_acceso p/u.test(source) && /GROUP BY/u.test(source)) {
        return { rows: [{ value: 'direccion', label: 'Dirección', recommended_permissions: ['resources.manage'] }] };
      }
      if (/FROM perfiles_acceso/u.test(source)) {
        return { rows: params[0] === 'inexistente' ? [] : [{ codigo: params[0], nombre: 'Dirección', descripcion: 'Equipo directivo' }] };
      }
      if (/FROM permisos_sistema p/u.test(source)) {
        return { rows: [
          { codigo: 'a.view', recomendado: true, concedido: true },
          { codigo: 'b.manage', recomendado: false, concedido: false },
        ] };
      }
      if (/SELECT COUNT\(\*\)::int AS total/u.test(source)) return { rows: [{ total: 3 }] };
      return { rows: [], rowCount: 0 };
    },
  };

  assert.deepEqual(permissions.normalizePermissions([' b ', null, 'a', 'b']), ['a', 'b']);
  assert.equal(permissions.normalizeProfileCode(' Dirección General '), 'direccion_general');
  assert.deepEqual(await permissions.getPermissionCatalog(queryable), [{ codigo: 'a.view' }, { codigo: 'b.manage' }]);
  assert.deepEqual(await permissions.getRecommendedPermissions(queryable, 'direccion'), ['a.view']);
  const accessProfile = (await permissions.getAccessProfiles(queryable, { includeInactive: false }))[0];
  assert.equal(accessProfile.value, 'direccion');
  assert.deepEqual(accessProfile.recommended_permissions, ['resources.manage', 'resources.view']);
  assert.equal((await permissions.getAccessProfile(queryable, 'direccion')).nombre, 'Dirección');
  assert.equal(await permissions.getAccessProfile(queryable, 'inexistente'), null);
  assert.deepEqual(await permissions.getEffectivePermissionProfile(queryable, 7, 'direccion'), {
    permissions: ['a.view'], recommended_permissions: ['a.view'],
  });
  assert.match((await permissions.validatePermissionSelection(queryable, 'a.view')).error, /lista/u);
  assert.match((await permissions.validatePermissionSelection(queryable, ['no.existe'])).error, /no reconocidos/u);
  assert.deepEqual(await permissions.validatePermissionSelection(queryable, ['a.view']), { error: null, permissions: ['a.view'] });
  await permissions.replaceUserPermissionOverrides(queryable, {
    userId: 7, role: 'direccion', permissions: ['b.manage'], updatedBy: 2,
  });
  await permissions.replaceProfilePermissions(queryable, 'direccion', ['b.manage', 'a.view', 'a.view']);
  assert.equal(await permissions.countActivePermissionHolders(queryable, 'users.manage', 7), 3);
  assert.equal(calls.some(({ source }) => /INSERT INTO permisos_usuario/u.test(source)), true);
  assert.equal(calls.filter(({ source }) => /INSERT INTO permisos_rol \(rol/u.test(source)).length, 2);
});

test('una sesión existente recibe solo los accesos base exigidos por sus acciones', async () => {
  const profile = await permissions.getEffectivePermissionProfile({
    query: async () => ({ rows: [
      { codigo: 'resources.manage', recomendado: true, concedido: true },
      { codigo: 'documents.sign', recomendado: false, concedido: true },
      { codigo: 'audit.view', recomendado: false, concedido: false },
    ] }),
  }, 7, 'personalizado');

  assert.deepEqual(profile.permissions, [
    'documents.sign', 'documents.view', 'resources.manage', 'resources.view',
  ]);
  assert.deepEqual(profile.recommended_permissions, ['resources.manage', 'resources.view']);
  assert.equal(profile.permissions.includes('audit.view'), false);
});

test('los ajustes personales comparan contra el perfil guardado y conservan un acceso base explícito', async () => {
  const inserts = [];
  const queryable = {
    query: async (sql, params = []) => {
      const source = String(sql);
      if (/FROM permisos_rol/u.test(source) && /ORDER BY permiso_codigo/u.test(source)) {
        return { rows: [{ permiso_codigo: 'resources.manage' }] };
      }
      if (/FROM permisos_sistema\s+WHERE codigo <>/u.test(source)) {
        return { rows: [{ codigo: 'resources.view' }, { codigo: 'resources.manage' }] };
      }
      if (/INSERT INTO permisos_usuario/u.test(source)) inserts.push(params);
      return { rows: [], rowCount: 0 };
    },
  };

  await permissions.replaceUserPermissionOverrides(queryable, {
    userId: 7, role: 'personalizado', permissions: ['resources.view'], updatedBy: 2,
  });
  assert.deepEqual(inserts, [
    [7, 'resources.view', true, 2],
    [7, 'resources.manage', false, 2],
  ]);
});

test('el servicio documental cubre formatos, rutas seguras, persistencia y limpieza', async () => {
  const pdf = Buffer.from('%PDF-1.4\ncontenido');
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 1]);
  const asData = (mime, buffer) => `data:${mime};base64,${buffer.toString('base64')}`;
  assert.equal(parseDocumentData({ fileData: asData('application/pdf', pdf), fileName: '../informe?.pdf' }).extension, '.pdf');
  assert.equal(parseDocumentData({ fileData: asData('image/png', png), fileName: 'foto.png' }).extension, '.png');
  assert.equal(parseDocumentData({ fileData: asData('image/jpeg', jpg), fileName: 'foto.jpg' }).extension, '.jpg');
  assert.throws(() => parseDocumentData({}), /adjuntar/u);
  assert.throws(() => parseDocumentData({ fileData: 'texto', fileName: 'x.pdf' }), /codificación/u);
  assert.throws(() => parseDocumentData({ fileData: asData('text/plain', Buffer.from('hola')), fileName: 'x.txt' }), /Formato/u);
  assert.throws(() => parseDocumentData({ fileData: asData('application/pdf', Buffer.from('hola')), fileName: 'x.pdf' }), /contenido/u);
  assert.equal(sanitizeOriginalName('..\\carpeta\\certificado<>.pdf').includes('<'), false);
  assert.equal(resolveDocumentPath('../fuera.pdf'), null);
  assert.equal(resolveDocumentPath(''), null);

  let storedName;
  const client = {
    query: async (_sql, params) => {
      storedName = params[1];
      return { rows: [{ id_documento: 91, nombre_almacenado: storedName }] };
    },
  };
  const created = await createDocument(client, {
    fileData: asData('application/pdf', pdf), fileName: 'informe.pdf', userId: 7,
  });
  assert.equal(created.id_documento, 91);
  assert.ok(resolveDocumentPath(storedName));
  await removeStoredFile(storedName);
  await removeStoredFile('../fuera.pdf');
  await removeStoredFile('archivo-inexistente.pdf');

  await assert.rejects(() => createDocumentFromBuffer(client, {
    buffer: Buffer.alloc(0), fileName: 'vacío.pdf', mimeType: 'application/pdf', extension: '.pdf', userId: 7,
  }), /vacío/u);
  await assert.rejects(() => createDocumentFromBuffer(client, {
    buffer: Buffer.from('incorrecto'), fileName: 'falso.pdf', mimeType: 'application/pdf', extension: '.pdf', userId: 7,
  }), /contenido/u);

  const referenced = await deleteDocumentIfUnreferenced({ query: async () => ({ rows: [{ total: 1 }] }) }, 4);
  assert.equal(referenced, null);
  let queryIndex = 0;
  const deleted = await deleteDocumentIfUnreferenced({
    query: async () => (++queryIndex === 1
      ? { rows: [{ total: 0 }] }
      : { rows: [{ nombre_almacenado: 'anterior.pdf' }] }),
  }, 4);
  assert.equal(deleted, 'anterior.pdf');
  assert.equal(await deleteDocumentIfUnreferenced(client, null), null);
});

test('el OCR no compatible y el programador sin bloqueo conservan salidas deterministas', async () => {
  const proposal = await recognizeImage({ filePath: 'no-se-lee.pdf', mimeType: 'application/pdf' });
  assert.equal(proposal.estado, 'NO_COMPATIBLE');
  assert.match(proposal.message, /PDF/u);

  let releases = 0;
  const noLockClient = {
    query: async () => ({ rows: [{ adquirido: false }], rowCount: 1 }),
    release: () => { releases += 1; },
  };
  assert.equal(await runDueInstitutionalReports({ connect: async () => noLockClient }), 0);
  assert.equal(releases, 1);

  const statements = [];
  const emptyClient = {
    query: async (sql) => {
      const source = String(sql);
      statements.push(source);
      if (/pg_try_advisory_lock/u.test(source)) return { rows: [{ adquirido: true }], rowCount: 1 };
      if (/CURRENT_DATE AS fecha/u.test(source)) {
        return { rows: [{ fecha: '2026-08-30', hora: '12:00', dia_semana: 7, dia_mes: 30 }], rowCount: 1 };
      }
      if (/FROM reportes_institucionales_programados/u.test(source)) return { rows: [], rowCount: 0 };
      return { rows: [{}], rowCount: 1 };
    },
    release: () => { releases += 1; },
  };
  assert.equal(await runDueInstitutionalReports({ connect: async () => emptyClient }), 0);
  assert.equal(statements.some((sql) => /pg_advisory_unlock/u.test(sql)), true);

  const errors = [];
  const stop = startInstitutionalReportScheduler(
    { connect: async () => noLockClient },
    { error: (message) => errors.push(message) },
  );
  await new Promise((resolve) => setImmediate(resolve));
  stop();
  assert.deepEqual(errors, []);
});

const analyticsPool = ({ withAlerts }) => ({
  query: async (sql) => {
    const source = String(sql);
    if (/SELECT id_curso, nombre_curso/u.test(source)) return { rows: [{ id_curso: 7, nombre_curso: 'Pre-Kínder' }] };
    if (/COUNT\(\*\) FILTER \(WHERE ar\.tipo_registro = 'Entrada'\)::int AS ingresos/u.test(source)) {
      return { rows: [{ ingresos: withAlerts ? 10 : 0, atrasos: withAlerts ? 3 : 0, a_tiempo: withAlerts ? 7 : 0 }] };
    }
    if (/FROM generate_series/u.test(source)) return { rows: [{ fecha: '2026-08-01', ingresos: 1, atrasos: 0 }] };
    if (/AS porcentaje_atrasos/u.test(source)) return { rows: [{ curso: 'Pre-Kínder', ingresos: 10, atrasos: 3 }] };
    if (/GROUP BY ar\.control_puntualidad_id/u.test(source)) {
      return { rows: withAlerts ? [{ bloque: 'Ingreso', atrasos: 3 }] : [] };
    }
    if (/FROM counts c JOIN alumno/u.test(source)) return { rows: [] };
    if (/WITH first_intervention/u.test(source)) return { rows: withAlerts ? [{ estudiantes_evaluados: 2, mejoraron: 1 }] : [] };
    if (/WITH contacted/u.test(source)) return { rows: withAlerts ? [{ casos_con_contacto: 1, cerrados: 1 }] : [] };
    if (/FROM retiros_alumno/u.test(source)) return { rows: [] };
    if (/FROM visitas v/u.test(source)) return { rows: [] };
    if (/FROM convivencia_casos WHERE/u.test(source)) {
      return { rows: [{ total: withAlerts ? 5 : 0, abiertos: withAlerts ? 5 : 0, resueltos: 0 }] };
    }
    if (/FROM convivencia_casos cc/u.test(source)) return { rows: [] };
    throw new Error(`Consulta analítica inesperada: ${source}`);
  },
});

test('la analítica agregada recorre filtros, valores vacíos y las tres alertas explicables', async () => {
  const empty = await buildInstitutionalAnalytics(analyticsPool({ withAlerts: false }), {
    from: '2026-08-01', to: '2026-08-02',
  });
  assert.equal(empty.resumen.tasa_atrasos, 0);
  assert.deepEqual(empty.alertas, []);
  assert.deepEqual(empty.reincidencia_post_intervencion, {
    estudiantes_evaluados: 0, mejoraron: 0, sin_cambio: 0, reincidieron: 0,
  });
  assert.equal(empty.contactos_apoderados.porcentaje_cierre, null);

  const alerted = await buildInstitutionalAnalytics(analyticsPool({ withAlerts: true }), {
    from: '2026-08-01', to: '2026-08-02', courseId: 7, justified: true, severity: 'Grave',
  });
  assert.equal(alerted.filtros.curso, 'Pre-Kínder');
  assert.equal(alerted.resumen.tasa_atrasos, 30);
  assert.deepEqual(alerted.alertas.map(({ level }) => level), ['alta', 'media', 'informativa']);
});

test('Seguimiento recorre asignación, escalamiento, fallback y tareas vencidas', async () => {
  const statements = [];
  const client = {
    query: async (sql, params = []) => {
      const source = String(sql);
      statements.push({ source, params });
      if (/c\.responsable_usuario_id IS NULL/u.test(source)) {
        return { rows: [
          { id_caso: 10, titulo: 'Caso asignable', regla_codigo: 'R1', responsable_perfil_codigo: 'inspector', notificar_responsable: true },
          { id_caso: 11, titulo: 'Caso sin equipo', regla_codigo: 'R2', responsable_perfil_codigo: 'sin_cuentas', notificar_responsable: true },
        ] };
      }
      if (/FROM usuarios u/u.test(source) && /ORDER BY \(/u.test(source)) {
        return { rows: params[0] === 'inspector' ? [{ id: 21 }] : [] };
      }
      if (/c\.escalado_automatico_en IS NULL/u.test(source)) {
        return { rows: [
          { id_caso: 20, titulo: 'Caso a grupos', prioridad: 'MEDIA', responsable_usuario_id: 21, regla_codigo: 'R1', fecha_limite: '2026-08-20', escalamiento_dias: 0, notificar_responsable: true },
          { id_caso: 22, titulo: 'Caso al responsable', prioridad: 'URGENTE', responsable_usuario_id: 23, regla_codigo: 'R2', fecha_limite: '2026-08-19', escalamiento_dias: 1, notificar_responsable: true },
        ] };
      }
      if (/FROM seguimiento_regla_escalamiento_grupos/u.test(source)) {
        return { rows: params[0] === 'R1'
          ? [
            { usuario_id: 31, grupo_codigo: 'INSPECTORIA', grupo_nombre: 'Inspectoría' },
            { usuario_id: 31, grupo_codigo: 'GESTION', grupo_nombre: 'Equipo de gestión' },
          ]
          : [] };
      }
      if (/FROM seguimiento_tareas t/u.test(source)) {
        return { rows: [
          { id_tarea: 50, titulo: 'Llamar', prioridad: 'ALTA', fecha_limite: '2026-08-20', id_caso: 20, caso_titulo: 'Caso a grupos', destinatario_id: 31 },
          { id_tarea: 51, titulo: 'Revisar', prioridad: 'BAJA', fecha_limite: '2026-08-21', id_caso: 22, caso_titulo: 'Caso al responsable', destinatario_id: 23 },
        ] };
      }
      if (/INSERT INTO notificaciones_internas/u.test(source)) return { rowCount: 1, rows: [{ id_notificacion: 1 }] };
      return { rowCount: 1, rows: [] };
    },
  };
  const result = await operateCases(client, new Map(), {
    asignacion_automatica: true, escalamiento_automatico: true, notificaciones_activas: true,
  }, 7);
  assert.deepEqual(result, { assigned: 1, escalated: 2, taskReminders: 2, notified: 5 });
  assert.equal(statements.some(({ source }) => /ASIGNACION_AUTOMATICA/u.test(source)), true);
  assert.equal(statements.some(({ source }) => /ESCALAMIENTO_AUTOMATICO/u.test(source)), true);
  assert.equal(statements.filter(({ source }) => /INSERT INTO notificaciones_internas/u.test(source)).length, 5);
  assert.deepEqual(await operateCases(client, new Map(), {
    asignacion_automatica: false, escalamiento_automatico: false, notificaciones_activas: false,
  }), { assigned: 0, escalated: 0, taskReminders: 0, notified: 0 });
});

test('Seguimiento ignora reglas inactivas y conserva un caso vigente sin duplicarlo', async () => {
  const ignored = await upsertSignalAndCase({ query: async () => { throw new Error('no debe consultar'); } }, {
    rule: 'INACTIVA', key: 'x', entityType: 'ESTUDIANTE', entityId: 1, title: 'X', reason: 'X', data: {},
  }, new Map());
  assert.deepEqual(ignored, { ignored: true });

  const client = {
    query: async (sql) => {
      const source = String(sql);
      if (/INSERT INTO seguimiento_senales/u.test(source)) {
        return { rows: [{ id_senal: 3, id_caso: 8, ciclo_deteccion: 1 }], rowCount: 1 };
      }
      if (/SELECT estado FROM seguimiento_casos/u.test(source)) {
        return { rows: [{ estado: 'ASIGNADO' }], rowCount: 1 };
      }
      throw new Error(`Consulta inesperada: ${source}`);
    },
  };
  const active = await upsertSignalAndCase(client, {
    rule: 'ACTIVA', key: 'estudiante:1', entityType: 'ESTUDIANTE', entityId: 1,
    studentId: 1, occurrences: 2, title: 'Caso vigente', reason: 'Sigue vigente', data: {},
  }, new Map([['ACTIVA', { activa: true, prioridad: 'MEDIA', plazo_dias: 3 }]]));
  assert.deepEqual(active, { caseId: 8, created: false, detectionCycle: 1 });
});
