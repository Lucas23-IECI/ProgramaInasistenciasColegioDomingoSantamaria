const assert = require('node:assert/strict');
const http = require('node:http');
const jwt = require('jsonwebtoken');

const pool = require('../db');
const { attachPermissionProfile } = require('../utils/permissions');

const baseUrl = process.env.STUDENT_EXPORT_TEST_API_URL || 'http://127.0.0.1:5000';

const requestBinary = (path, token) => new Promise((resolve, reject) => {
  const request = http.get(`${baseUrl}${path}`, {
    headers: { Cookie: `token=${token}`, Accept: '*/*' }
  }, (response) => {
    const chunks = [];
    response.on('data', (chunk) => chunks.push(chunk));
    response.on('end', () => resolve({
      status: response.statusCode,
      headers: response.headers,
      body: Buffer.concat(chunks)
    }));
  });
  request.on('error', reject);
});

const tokenFor = (user) => jwt.sign({
  id: user.id,
  correo: user.correo,
  rol: user.rol,
  nombre: user.nombre,
  token_version: user.token_version
}, process.env.JWT_SECRET, { expiresIn: '10m' });

const assertWorkbook = (response, label) => {
  assert.equal(response.status, 200, `${label} debe responder HTTP 200`);
  assert.match(response.headers['content-type'] || '', /spreadsheetml/);
  assert.match(response.headers['content-disposition'] || '', /\.xlsx/);
  assert.match(response.headers['cache-control'] || '', /no-store/);
  assert.equal(response.body.subarray(0, 2).toString(), 'PK');
  assert.ok(response.body.length > 5000, `${label} debe contener un libro XLSX no vacío`);
};

const run = async () => {
  assert.ok(process.env.JWT_SECRET, 'JWT_SECRET debe estar disponible en el entorno del backend');
  const usersResult = await pool.query(`
    SELECT id, correo, rol, nombre, token_version
    FROM usuarios
    WHERE activo = true AND eliminado_en IS NULL
    ORDER BY id
  `);
  const users = await Promise.all(usersResult.rows.map((user) => attachPermissionProfile(pool, user)));
  const exporter = users.find((user) => user.permissions.includes('students.export'));
  const blocked = users.find((user) => !user.permissions.includes('students.export'));
  assert.ok(exporter, 'Se requiere una cuenta activa autorizada para exportar el padrón');
  assert.ok(blocked, 'Se requiere una cuenta activa sin permiso de exportación');

  const actionNames = [
    'EXPORTAR_PADRON_OPERATIVO',
    'EXPORTAR_PADRON_ADMINISTRATIVO',
    'EXPORTAR_CALIDAD_PADRON'
  ];
  const before = await pool.query(
    'SELECT count(*)::int AS total FROM audit_log WHERE usuario_id = $1 AND accion = ANY($2::varchar[])',
    [exporter.id, actionNames]
  );

  const exporterToken = tokenFor(exporter);
  assertWorkbook(await requestBinary('/api/padron/export?scope=operational', exporterToken), 'Padrón operativo');
  assertWorkbook(await requestBinary('/api/padron/export?scope=quality', exporterToken), 'Calidad del padrón');
  assertWorkbook(await requestBinary('/api/padron/export?scope=administrative', exporterToken), 'Padrón administrativo');
  assert.equal(
    (await requestBinary('/api/padron/export?scope=operational', tokenFor(blocked))).status,
    403,
    'Una cuenta sin permiso de exportación debe ser bloqueada'
  );

  const after = await pool.query(
    'SELECT count(*)::int AS total FROM audit_log WHERE usuario_id = $1 AND accion = ANY($2::varchar[])',
    [exporter.id, actionNames]
  );
  assert.equal(after.rows[0].total - before.rows[0].total, 3, 'Las tres descargas administrativas deben quedar auditadas');

  console.log(JSON.stringify({
    status: 'OK',
    exports_verified: 3,
    unauthorized_access_blocked: true,
    audit_events_verified: 3
  }));
};

run()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
