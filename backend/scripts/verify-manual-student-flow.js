const http = require('node:http');
const pool = require('../db');
const { calculateRutDv } = require('../utils/students');

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
      const data = raw ? JSON.parse(raw) : {};
      if (response.statusCode < 200 || response.statusCode >= 300) {
        reject(new Error(`${method} ${path}: ${response.statusCode} ${data.message || raw}`));
        return;
      }
      resolve({
        data,
        cookie: response.headers['set-cookie']?.map((value) => value.split(';')[0]).join('; ')
      });
    });
  });
  request.on('error', reject);
  if (payload) request.write(payload);
  request.end();
});

const run = async () => {
  let idAlumno = null;
  let importId = null;
  let reactivationImportId = null;
  try {
    const login = await requestJson('/auth/login', {
      method: 'POST',
      body: {
        correo: process.env.TEST_ADMIN_EMAIL || 'admin@ldsm.local',
        password: process.env.DEFAULT_USER_PASSWORD
      }
    });
    if (!login.cookie) throw new Error('El acceso de prueba no entregó una sesión.');

    const courseResponse = await requestJson('/courses', { cookie: login.cookie });
    const course = courseResponse.data[0]?.nombre_curso;
    if (!course) throw new Error('No existen cursos para verificar el flujo.');

    let rut = 29000000;
    while ((await pool.query('SELECT 1 FROM alumno WHERE rut = $1', [String(rut)])).rows.length) rut += 1;
    const dv = calculateRutDv(String(rut));

    const created = await requestJson('/students', {
      method: 'POST',
      cookie: login.cookie,
      body: {
        rut: `${rut}-${dv}`,
        nombres: 'Prueba Controlada',
        paterno: 'Codex',
        materno: 'Temporal',
        grade: course,
        email: 'prueba.controlada@example.invalid',
        telefono: '+56 9 1111 1111',
        motivo_alta_manual: 'PENDIENTE_ERP',
        detalle_alta_manual: 'Prueba institucional controlada'
      }
    });
    idAlumno = created.data.id_alumno;

    await requestJson(`/students/${idAlumno}`, {
      method: 'PUT',
      cookie: login.cookie,
      body: {
        nombres: 'Prueba Editada',
        paterno: 'Codex',
        materno: 'Temporal',
        grade: course,
        email: 'prueba.editada@example.invalid',
        telefono: '+56 9 2222 2222'
      }
    });
    await requestJson(`/students/${idAlumno}`, {
      method: 'DELETE',
      cookie: login.cookie,
      body: { motivo: 'Prueba automatizada de retiro temporal' }
    });
    await requestJson(`/students/${idAlumno}/reactivate`, {
      method: 'POST',
      cookie: login.cookie,
      body: { grade: course }
    });

    const detail = await requestJson(`/students/${idAlumno}/details`, { cookie: login.cookie });
    if (detail.data.alumno?.nombres !== 'Prueba Editada' || !detail.data.alumno?.activo) {
      throw new Error('La ficha final no refleja la edición y reactivación.');
    }
    if (detail.data.alumno?.origen_alta !== 'MANUAL' || detail.data.alumno?.erp_vinculado_en) {
      throw new Error('La ficha manual no conserva correctamente su origen pendiente de ERP.');
    }
    if (detail.data.alumno?.motivo_alta_manual !== 'PENDIENTE_ERP') {
      throw new Error('La ficha manual no conservó su motivo institucional.');
    }

    const manualPending = await requestJson('/padron/manual-pending', { cookie: login.cookie });
    if (!manualPending.data.students?.some((student) => Number(student.id_alumno) === Number(idAlumno))) {
      throw new Error('La bandeja no mostró el alta manual pendiente.');
    }
    const operationalInbox = await requestJson('/operaciones/bandeja', { cookie: login.cookie });
    if (!operationalInbox.data.tasks?.manual_students_pending?.some(
      (student) => Number(student.id_alumno) === Number(idAlumno)
    )) {
      throw new Error('La bandeja operativa no incorporó el alta manual pendiente.');
    }
    const quality = await requestJson('/padron/quality', { cookie: login.cookie });
    if (Number(quality.data.indicators?.manuales_pendientes || 0) < 1) {
      throw new Error('El panel de calidad no contabilizó el alta manual pendiente.');
    }

    const matchingPreview = await requestJson('/students/import-preview', {
      method: 'POST',
      cookie: login.cookie,
      body: {
        students: [{
          'ID de Usuario (no modificar)': `prueba-reconciliacion-${rut}`,
          RUT: `${rut}-${dv}`,
          Nombres: 'Prueba Editada',
          Apellidos: 'Codex Temporal',
          Curso: course,
          Rol: 'Estudiante'
        }]
      }
    });
    if (matchingPreview.data.rows?.[0]?.reconciliation?.code !== 'VINCULAR_MANUAL') {
      throw new Error('La importación no anunció la vinculación del alta manual.');
    }
    if (!matchingPreview.data.rows?.[0]?.field_comparison?.length) {
      throw new Error('La previsualización no entregó comparación campo por campo.');
    }

    const completePreview = await requestJson('/students/import-preview', {
      method: 'POST',
      cookie: login.cookie,
      body: {
        import_mode: 'COMPLETA',
        students: [{
          'ID de Usuario (no modificar)': `prueba-reconciliacion-${rut}`,
          RUT: `${rut}-${dv}`,
          Nombres: 'Prueba Editada',
          Apellidos: 'Codex Temporal',
          Curso: course,
          Rol: 'Estudiante'
        }]
      }
    });
    if (!completePreview.data.missing_students?.length) {
      throw new Error('La nómina completa no detectó estudiantes vigentes ausentes.');
    }

    const conflictPreview = await requestJson('/students/import-preview', {
      method: 'POST',
      cookie: login.cookie,
      body: {
        students: [{
          RUT: `${rut}-${dv}`,
          Nombres: 'Persona Distinta',
          Apellidos: 'Apellido Ajeno',
          Curso: course,
          Rol: 'Estudiante'
        }]
      }
    });
    if (conflictPreview.data.rows?.[0]?.status !== 'CONFLICTO_IDENTIDAD') {
      throw new Error('La importación no bloqueó una identidad incompatible para el mismo RUT.');
    }

    const invalidRutPreview = await requestJson('/students/import-preview', {
      method: 'POST',
      cookie: login.cookie,
      body: {
        students: [{
          RUT: `${rut}-${dv === '9' ? '8' : '9'}`,
          Nombres: 'Prueba Editada',
          Apellidos: 'Codex Temporal',
          Curso: course,
          Rol: 'Estudiante'
        }]
      }
    });
    if (invalidRutPreview.data.rows?.[0]?.status !== 'RECHAZADA') {
      throw new Error('La importación no rechazó un RUT con dígito verificador incorrecto.');
    }

    const imported = await requestJson('/students/bulk-sync', {
      method: 'POST',
      cookie: login.cookie,
      body: {
        import_mode: 'PARCIAL',
        file_name: 'prueba-controlada.xlsx',
        file_hash: `qa-${rut}`,
        students: [{
          'ID de Usuario (no modificar)': `prueba-reconciliacion-${rut}`,
          RUT: `${rut}-${dv}`,
          Nombres: 'Prueba Editada',
          Apellidos: 'Codex Temporal',
          Curso: course,
          Rol: 'Estudiante'
        }]
      }
    });
    importId = imported.data.import_id;
    if (imported.data.linked_manual !== 1 || !importId) {
      throw new Error('La importación parcial no vinculó ni registró el alta manual.');
    }
    const afterImport = await requestJson(`/students/${idAlumno}/details`, { cookie: login.cookie });
    if (!afterImport.data.alumno?.erp_vinculado_en || Number(afterImport.data.alumno?.id_alumno) !== Number(idAlumno)) {
      throw new Error('La importación creó otra identidad o no vinculó el ERP.');
    }
    const importHistory = await requestJson(`/padron/imports/${importId}`, { cookie: login.cookie });
    if (importHistory.data.changes?.[0]?.accion !== 'VINCULADO_MANUAL') {
      throw new Error('El historial no registró la vinculación manual con ERP.');
    }

    await requestJson(`/students/${idAlumno}`, {
      method: 'DELETE',
      cookie: login.cookie,
      body: { motivo: 'Prueba automatizada de ficha ERP inactiva' }
    });
    const inactivePreview = await requestJson('/students/import-preview', {
      method: 'POST',
      cookie: login.cookie,
      body: {
        students: [{
          'ID de Usuario (no modificar)': `prueba-reconciliacion-${rut}`,
          RUT: `${rut}-${dv}`,
          Nombres: 'Prueba Editada',
          Apellidos: 'Codex Temporal',
          Curso: course,
          Rol: 'Estudiante'
        }]
      }
    });
    if (inactivePreview.data.rows?.[0]?.status !== 'FICHA_INACTIVA_REAPARECE') {
      throw new Error('La importación no exigió confirmar la reaparición de una ficha inactiva.');
    }
    const reactivated = await requestJson('/students/bulk-sync', {
      method: 'POST',
      cookie: login.cookie,
      body: {
        import_mode: 'PARCIAL',
        file_name: 'prueba-reactivacion.xlsx',
        file_hash: `qa-reactivacion-${rut}`,
        identity_resolutions: { '2': 'REACTIVAR_FICHA' },
        students: [{
          'ID de Usuario (no modificar)': `prueba-reconciliacion-${rut}`,
          RUT: `${rut}-${dv}`,
          Nombres: 'Prueba Editada',
          Apellidos: 'Codex Temporal',
          Curso: course,
          Rol: 'Estudiante'
        }]
      }
    });
    reactivationImportId = reactivated.data.import_id;
    if (reactivated.data.reactivated !== 1) {
      throw new Error('La confirmación no reactivó exactamente una ficha.');
    }
    const reactivationHistory = await requestJson(`/padron/imports/${reactivationImportId}`, { cookie: login.cookie });
    if (reactivationHistory.data.changes?.[0]?.accion !== 'REACTIVADO_DESDE_ERP') {
      throw new Error('El historial no registró la reactivación confirmada desde ERP.');
    }

    console.log('Flujo verificado: alta manual, bandeja, comparación, nómina completa segura, vinculación ERP, reactivación explícita e historial.');
  } finally {
    if (idAlumno) {
      if (reactivationImportId) await pool.query('DELETE FROM importaciones_estudiantes WHERE id = $1', [reactivationImportId]);
      if (importId) await pool.query('DELETE FROM importaciones_estudiantes WHERE id = $1', [importId]);
      await pool.query("DELETE FROM audit_log WHERE entidad = 'alumno' AND entidad_id = $1", [idAlumno]);
      await pool.query('DELETE FROM matricula WHERE id_alumno = $1', [idAlumno]);
      await pool.query('DELETE FROM alumno WHERE id_alumno = $1', [idAlumno]);
      console.log('Datos temporales de la prueba eliminados.');
    }
    await pool.end();
  }
};

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
