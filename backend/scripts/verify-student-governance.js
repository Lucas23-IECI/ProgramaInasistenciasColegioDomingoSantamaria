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
  const ids = [];
  try {
    const login = await requestJson('/auth/login', {
      method: 'POST',
      body: {
        correo: process.env.TEST_ADMIN_EMAIL || 'admin@ldsm.local',
        password: process.env.DEFAULT_USER_PASSWORD
      }
    });
    const courses = await requestJson('/courses', { cookie: login.cookie });
    const grade = courses.data[0]?.nombre_curso;
    if (!grade) throw new Error('No existen cursos para la prueba de fusión.');

    let baseRut = 29100000;
    while ((await pool.query('SELECT 1 FROM alumno WHERE rut = ANY($1::text[])', [[String(baseRut), String(baseRut + 1)]])).rowCount) {
      baseRut += 2;
    }
    for (const [offset, suffix] of [[0, 'Principal'], [1, 'Duplicada']]) {
      const rut = String(baseRut + offset);
      const created = await requestJson('/students', {
        method: 'POST',
        cookie: login.cookie,
        body: {
          rut: `${rut}-${calculateRutDv(rut)}`,
          nombres: 'Verificación',
          paterno: suffix,
          materno: 'Temporal',
          grade,
          motivo_alta_manual: 'REGULARIZACION_INSTITUCIONAL',
          detalle_alta_manual: 'Prueba automatizada de fusión controlada'
        }
      });
      ids.push(created.data.id_alumno);
    }

    const collisionUuid = `qa-colision-${baseRut}`;
    await pool.query('UPDATE alumno SET uuid_erp = $1 WHERE id_alumno = $2', [collisionUuid, ids[0]]);
    const duplicateRut = String(baseRut + 1);
    const collisionPreview = await requestJson('/students/import-preview', {
      method: 'POST',
      cookie: login.cookie,
      body: {
        students: [{
          'ID de Usuario (no modificar)': collisionUuid,
          RUT: `${duplicateRut}-${calculateRutDv(duplicateRut)}`,
          Nombres: 'Verificación',
          Apellidos: 'Duplicada Temporal',
          Curso: grade,
          Rol: 'Estudiante'
        }]
      }
    });
    if (!['COLISION_UUID_RUT', 'COLISION_IDENTIFICADORES'].includes(
      collisionPreview.data.rows?.[0]?.status
    )) {
      throw new Error('La previsualización no detuvo una colisión real entre UUID y RUT.');
    }

    const preview = await requestJson('/padron/merge-preview', {
      method: 'POST',
      cookie: login.cookie,
      body: { primary_id: ids[0], duplicate_id: ids[1] }
    });
    if (!preview.data.can_merge || preview.data.counts.duplicate.enrollments !== 1) {
      throw new Error('La previsualización de fusión no reconoció un caso seguro.');
    }
    await requestJson('/padron/merge', {
      method: 'POST',
      cookie: login.cookie,
      body: {
        primary_id: ids[0],
        duplicate_id: ids[1],
        motivo: 'Prueba automatizada de identidad duplicada confirmada'
      }
    });
    const merged = await pool.query(
      'SELECT activo, fusionado_en_id FROM alumno WHERE id_alumno = $1',
      [ids[1]]
    );
    if (merged.rows[0]?.activo || Number(merged.rows[0]?.fusionado_en_id) !== Number(ids[0])) {
      throw new Error('La ficha duplicada no quedó trazablemente fusionada.');
    }
    console.log('Gobernanza verificada: colisión UUID/RUT, previsualización de fusión, transferencia, desactivación y trazabilidad.');
  } finally {
    if (ids.length) {
      await pool.query(
        'DELETE FROM fusiones_alumnos WHERE alumno_principal_id = ANY($1::int[]) OR alumno_duplicado_id = ANY($1::int[])',
        [ids]
      );
      await pool.query(
        "DELETE FROM audit_log WHERE entidad = 'alumno' AND entidad_id = ANY($1::int[])",
        [ids]
      );
      await pool.query('DELETE FROM matricula WHERE id_alumno = ANY($1::int[])', [ids]);
      if (ids[1]) await pool.query('DELETE FROM alumno WHERE id_alumno = $1', [ids[1]]);
      if (ids[0]) await pool.query('DELETE FROM alumno WHERE id_alumno = $1', [ids[0]]);
      console.log('Datos temporales de fusión eliminados.');
    }
    await pool.end();
  }
};

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
