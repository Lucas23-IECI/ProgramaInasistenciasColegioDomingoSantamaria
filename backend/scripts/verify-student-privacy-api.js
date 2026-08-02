const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const pool = require('../db');
const { attachPermissionProfile } = require('../utils/permissions');

const API_URL = process.env.PRIVACY_API_URL || 'http://127.0.0.1:5000/api';

const tokenFor = (user) => jwt.sign({
  id: user.id,
  correo: user.correo,
  rol: user.rol,
  token_version: user.token_version || 1
}, process.env.JWT_SECRET, { expiresIn: '5m' });

const main = async () => {
  assert.ok(process.env.JWT_SECRET, 'JWT_SECRET debe existir en el entorno de prueba.');
  const [studentResult, usersResult] = await Promise.all([
    pool.query(`
      SELECT id_alumno FROM alumno
      WHERE activo = true AND fusionado_en_id IS NULL AND rut IS NOT NULL
      ORDER BY id_alumno LIMIT 1
    `),
    pool.query(`
      SELECT id, correo, rol, nombre, token_version
      FROM usuarios WHERE activo = true AND eliminado_en IS NULL ORDER BY id
    `)
  ]);
  const users = await Promise.all(usersResult.rows.map((user) => attachPermissionProfile(pool, user)));
  const user = users.find((candidate) => candidate.permissions.includes('students.view'));
  const student = studentResult.rows[0];
  assert.ok(student, 'Se necesita una ficha con RUN para la prueba.');
  assert.ok(user, 'Se necesita una cuenta con permiso para consultar estudiantes.');

  const response = await fetch(`${API_URL}/students/${student.id_alumno}/details`, {
    headers: { Cookie: `token=${tokenFor(user)}` }
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control') || '', /no-store/);
  const body = await response.json();
  assert.ok(body.alumno.rut);
  assert.equal(body.alumno.identificadores_protegidos, false);
  assert.equal(body.identificadores.every((identifier) => identifier.protegido === false), true);
  assert.equal(body.identificadores.every((identifier) => Boolean(identifier.valor_original)), true);
  assert.equal(body.identificadores.some((identifier) => /\*/.test(identifier.valor_mostrado)), false);

  console.log('Identificadores estudiantiles verificados: valores completos en ficha y listado de identificadores.');
};

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
