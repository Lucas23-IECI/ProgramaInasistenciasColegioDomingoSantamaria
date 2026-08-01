const http = require('node:http');
const pool = require('../db');

const baseUrl = process.env.TEST_API_URL || 'http://127.0.0.1:5000/api';

const requestJson = (path, { method = 'GET', body, cookie } = {}) => new Promise((resolve, reject) => {
  const payload = body ? JSON.stringify(body) : null;
  const request = http.request(`${baseUrl}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      ...(cookie ? { Cookie: cookie } : {})
    }
  }, (response) => {
    let raw = '';
    response.setEncoding('utf8');
    response.on('data', (chunk) => { raw += chunk; });
    response.on('end', () => {
      let data = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        data = { raw };
      }
      resolve({
        status: response.statusCode,
        data,
        cookie: response.headers['set-cookie']?.map((value) => value.split(';')[0]).join('; ')
      });
    });
  });
  request.on('error', reject);
  if (payload) request.write(payload);
  request.end();
});

const requireStatus = (response, expected, label) => {
  if (response.status !== expected) {
    throw new Error(`${label}: se esperaba HTTP ${expected} y se recibió ${response.status} (${response.data.message || 'sin detalle'}).`);
  }
  return response.data;
};

const run = async () => {
  const studentIds = [];
  let importId = null;
  try {
    const login = await requestJson('/auth/login', {
      method: 'POST',
      body: {
        correo: process.env.TEST_ADMIN_EMAIL || 'admin@ldsm.local',
        password: process.env.DEFAULT_USER_PASSWORD
      }
    });
    requireStatus(login, 200, 'Inicio de sesión');
    if (!login.cookie) throw new Error('El acceso de prueba no entregó una sesión.');

    const coursesResponse = await requestJson('/courses', { cookie: login.cookie });
    const courses = requireStatus(coursesResponse, 200, 'Consulta de cursos');
    const course = courses[0]?.nombre_curso;
    if (!course) throw new Error('No existen cursos para verificar las identidades manuales.');

    let ipeNumber = 1990000000;
    while ((await pool.query(
      `SELECT 1
       FROM alumno_identificador
       WHERE tipo = 'IPE_MINEDUC' AND valor_normalizado = $1 AND estado <> 'REVOCADO'`,
      [String(ipeNumber)]
    )).rows.length) {
      ipeNumber -= 1;
    }
    const uniqueSuffix = String(Date.now()).slice(-8);
    const passportNumber = `QA${uniqueSuffix}`;

    const commonStudent = {
      nombres: 'Prueba Identidad',
      paterno: 'Codex',
      materno: 'Temporal',
      grade: course,
      motivo_alta_manual: 'PENDIENTE_ERP',
      detalle_alta_manual: 'Verificación automatizada controlada de identidad'
    };

    const ipeCreated = requireStatus(await requestJson('/students', {
      method: 'POST',
      cookie: login.cookie,
      body: {
        ...commonStudent,
        tipo_identificador: 'IPE_MINEDUC',
        documento: String(ipeNumber)
      }
    }), 201, 'Alta con IPE');
    studentIds.push(ipeCreated.id_alumno);

    const passportCreated = requireStatus(await requestJson('/students', {
      method: 'POST',
      cookie: login.cookie,
      body: {
        ...commonStudent,
        nombres: 'Prueba Pasaporte',
        tipo_identificador: 'PASAPORTE',
        documento: passportNumber,
        pais_emisor: 'DEU'
      }
    }), 201, 'Alta con pasaporte');
    studentIds.push(passportCreated.id_alumno);

    const undocumentedCreated = requireStatus(await requestJson('/students', {
      method: 'POST',
      cookie: login.cookie,
      body: {
        ...commonStudent,
        nombres: 'Prueba Sin Documento',
        tipo_identificador: 'SIN_DOCUMENTO',
        documento: '',
        detalle_alta_manual: 'Documento civil pendiente de entrega por la familia'
      }
    }), 201, 'Alta sin documento');
    studentIds.push(undocumentedCreated.id_alumno);

    const expectedPrincipalTypes = new Map([
      [Number(ipeCreated.id_alumno), 'IPE_MINEDUC'],
      [Number(passportCreated.id_alumno), 'PASAPORTE'],
      [Number(undocumentedCreated.id_alumno), 'CODIGO_INTERNO']
    ]);
    for (const studentId of studentIds) {
      const detail = requireStatus(
        await requestJson(`/students/${studentId}/details`, { cookie: login.cookie }),
        200,
        `Detalle de estudiante ${studentId}`
      );
      const principal = detail.identificadores?.find((identifier) => identifier.es_principal);
      if (principal?.tipo !== expectedPrincipalTypes.get(Number(studentId))) {
        throw new Error(`La ficha ${studentId} no conservó su identificador principal esperado.`);
      }
      if (!detail.alumno?.codigo_barra) {
        throw new Error(`La ficha ${studentId} no recibió código operativo.`);
      }
    }

    const createAudits = await pool.query(
      `SELECT entidad_id, accion, detalle
       FROM audit_log
       WHERE entidad = 'alumno'
         AND entidad_id = ANY($1::int[])
         AND accion = 'CREAR_ALUMNO'`,
      [studentIds]
    );
    if (createAudits.rowCount !== studentIds.length) {
      throw new Error('No todas las altas manuales quedaron registradas en auditoría.');
    }
    const serializedAudits = JSON.stringify(createAudits.rows);
    if (
      serializedAudits.includes(String(ipeNumber))
      || serializedAudits.includes(passportNumber)
    ) {
      throw new Error('La auditoría expuso un identificador personal completo.');
    }

    const duplicatePassport = await requestJson('/students', {
      method: 'POST',
      cookie: login.cookie,
      body: {
        ...commonStudent,
        nombres: 'Prueba Duplicada',
        tipo_identificador: 'PASAPORTE',
        documento: passportNumber,
        pais_emisor: 'DEU'
      }
    });
    requireStatus(duplicatePassport, 409, 'Bloqueo de pasaporte duplicado');

    const preview = requireStatus(await requestJson('/students/import-preview', {
      method: 'POST',
      cookie: login.cookie,
      body: {
        students: [{
          'ID de Usuario (no modificar)': `qa-ipe-${uniqueSuffix}`,
          RUT: String(ipeNumber),
          Nombres: commonStudent.nombres,
          Apellidos: `${commonStudent.paterno} ${commonStudent.materno}`,
          Curso: course,
          Rol: 'Estudiante'
        }]
      }
    }), 200, 'Previsualización ERP de IPE');
    if (preview.rows?.[0]?.existing_student?.id_alumno !== ipeCreated.id_alumno) {
      throw new Error('La previsualización ERP no encontró la ficha manual mediante su IPE.');
    }
    if (preview.rows?.[0]?.reconciliation?.code !== 'VINCULAR_MANUAL') {
      throw new Error('La previsualización ERP no anunció la vinculación de la ficha IPE manual.');
    }

    const imported = requireStatus(await requestJson('/students/bulk-sync', {
      method: 'POST',
      cookie: login.cookie,
      body: {
        import_mode: 'PARCIAL',
        file_name: 'qa-identidades-manuales.xlsx',
        file_hash: `qa-identidades-${uniqueSuffix}`,
        students: [{
          'ID de Usuario (no modificar)': `qa-ipe-${uniqueSuffix}`,
          RUT: String(ipeNumber),
          Nombres: commonStudent.nombres,
          Apellidos: `${commonStudent.paterno} ${commonStudent.materno}`,
          Curso: course,
          Rol: 'Estudiante'
        }]
      }
    }), 200, 'Vinculación ERP de IPE');
    importId = imported.import_id;
    if (imported.linked_manual !== 1 || !importId) {
      throw new Error('La sincronización ERP no vinculó exactamente una ficha IPE manual.');
    }

    const afterImport = requireStatus(
      await requestJson(`/students/${ipeCreated.id_alumno}/details`, { cookie: login.cookie }),
      200,
      'Detalle posterior a vinculación ERP'
    );
    if (
      Number(afterImport.alumno?.id_alumno) !== Number(ipeCreated.id_alumno)
      || !afterImport.alumno?.erp_vinculado_en
    ) {
      throw new Error('La vinculación ERP duplicó la ficha o no registró su procedencia.');
    }

    const inbox = requireStatus(
      await requestJson('/operaciones/bandeja', { cookie: login.cookie }),
      200,
      'Bandeja operativa'
    );
    const pendingIds = new Set(
      (inbox.tasks?.manual_students_pending || []).map((student) => Number(student.id_alumno))
    );
    if (
      !pendingIds.has(Number(passportCreated.id_alumno))
      || !pendingIds.has(Number(undocumentedCreated.id_alumno))
    ) {
      throw new Error('La bandeja no mostró las identidades manuales pendientes de ERP.');
    }

    const quality = requireStatus(
      await requestJson('/padron/quality', { cookie: login.cookie }),
      200,
      'Panel de calidad'
    );
    if (Number(quality.indicators?.manuales_pendientes || 0) < 2) {
      throw new Error('El panel de calidad no contabilizó las identidades manuales pendientes.');
    }
    const qualityPendingIds = new Set(
      (quality.cases?.manuales_pendientes || []).map((student) => Number(student.id_alumno))
    );
    if (
      !qualityPendingIds.has(Number(passportCreated.id_alumno))
      || !qualityPendingIds.has(Number(undocumentedCreated.id_alumno))
    ) {
      throw new Error('El panel de calidad contabilizó pendientes, pero no permitió navegar a sus fichas.');
    }

    console.log('Flujo verificado: IPE, pasaporte extranjero, alta sin documento, auditoría protegida, duplicidad, bandeja, calidad navegable y vinculación ERP sin duplicar.');
  } finally {
    if (importId) {
      await pool.query('DELETE FROM importaciones_estudiantes WHERE id = $1', [importId]);
    }
    for (const studentId of studentIds.reverse()) {
      await pool.query("DELETE FROM audit_log WHERE entidad = 'alumno' AND entidad_id = $1", [studentId]);
      await pool.query('DELETE FROM matricula WHERE id_alumno = $1', [studentId]);
      await pool.query('DELETE FROM alumno WHERE id_alumno = $1', [studentId]);
    }
    if (studentIds.length) {
      const remaining = await pool.query(
        'SELECT COUNT(*)::int AS total FROM alumno WHERE id_alumno = ANY($1::int[])',
        [studentIds]
      );
      if (remaining.rows[0].total !== 0) {
        throw new Error('La limpieza no eliminó todas las fichas temporales.');
      }
      console.log('Datos temporales de la prueba eliminados y limpieza verificada.');
    }
    await pool.end();
  }
};

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
