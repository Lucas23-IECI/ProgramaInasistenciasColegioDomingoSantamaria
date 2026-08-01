const http = require('node:http');
const pool = require('../db');

const baseUrl = process.env.TEST_API_URL || 'http://127.0.0.1:5000/api';

const requestJson = (path, { method = 'GET', body, cookie } = {}) => new Promise((resolve, reject) => {
  const payload = body ? JSON.stringify(body) : null;
  const request = http.request(`${baseUrl}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(payload ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      } : {}),
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
  try {
    const login = await requestJson('/auth/login', {
      method: 'POST',
      body: {
        correo: process.env.TEST_ADMIN_EMAIL || 'admin@ldsm.local',
        password: process.env.DEFAULT_USER_PASSWORD
      }
    });
    const samples = await pool.query(`
      SELECT DISTINCT ON (ai.tipo)
             ai.tipo, ai.valor_normalizado, ai.id_alumno,
             ai.validador_id, ai.validador_version,
             ai.resultado_validacion, ai.validado_en
      FROM alumno_identificador ai
      JOIN alumno a ON a.id_alumno = ai.id_alumno
      WHERE ai.estado <> 'REVOCADO'
        AND a.activo = true
        AND a.fusionado_en_id IS NULL
        AND ai.tipo IN ('RUN_CHILE', 'IPE_MINEDUC', 'ID_ERP', 'CODIGO_BARRAS')
      ORDER BY ai.tipo, ai.id_identificador
    `);
    const expectedTypes = new Set(['RUN_CHILE', 'IPE_MINEDUC', 'ID_ERP', 'CODIGO_BARRAS']);
    for (const sample of samples.rows) {
      if (!sample.validador_id || !sample.validador_version || !sample.resultado_validacion) {
        throw new Error(`El identificador ${sample.tipo} no conserva evidencia versionada.`);
      }
      const search = await requestJson(
        `/students/search?q=${encodeURIComponent(sample.valor_normalizado)}`,
        { cookie: login.cookie }
      );
      const found = search.data.some(
        (student) => Number(student.id_alumno) === Number(sample.id_alumno)
      );
      if (!found) {
        throw new Error(`La búsqueda no resolvió un identificador de tipo ${sample.tipo}.`);
      }
      expectedTypes.delete(sample.tipo);
    }
    if (expectedTypes.size) {
      throw new Error(`Faltan muestras activas para: ${[...expectedTypes].join(', ')}.`);
    }

    const principal = await pool.query(`
      SELECT ai.id_alumno
      FROM alumno_identificador ai
      WHERE ai.es_principal = true
        AND ai.estado <> 'REVOCADO'
      ORDER BY ai.id_identificador
      LIMIT 1
    `);
    const details = await requestJson(
      `/students/${principal.rows[0].id_alumno}/details`,
      { cookie: login.cookie }
    );
    if (!Array.isArray(details.data.identificadores) || !details.data.identificadores.length) {
      throw new Error('La ficha de estudiante no devolvió sus identificadores relacionados.');
    }
    if (details.data.identificadores.some((identifier) => (
      !identifier.validador_id
      || !identifier.validador_version
      || !identifier.resultado_validacion
    ))) {
      throw new Error('La ficha no expuso la evidencia versionada de todos sus identificadores.');
    }

    console.log(
      'Identificadores verificados: RUN, IPE, UUID ERP y código operativo resuelven la misma ficha sin exponer datos personales.'
    );
  } finally {
    await pool.end();
  }
};

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
