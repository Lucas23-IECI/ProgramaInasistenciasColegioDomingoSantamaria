const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const pool = require('../db');

const API_URL = process.env.PRIVACY_API_URL || 'http://127.0.0.1:5000/api';
const PERMISSION = 'students.identifiers.view_sensitive';

const tokenFor = (user) => jwt.sign({
  id: user.id,
  correo: user.correo,
  rol: user.rol,
  token_version: user.token_version || 1
}, process.env.JWT_SECRET, { expiresIn: '5m' });

const request = (path, user) => fetch(`${API_URL}${path}`, {
  headers: { Cookie: `token=${tokenFor(user)}` }
});

const findUser = async (granted) => {
  const result = await pool.query(`
    SELECT u.id, u.correo, u.rol, u.token_version
    FROM usuarios u
    WHERE u.activo = true AND u.eliminado_en IS NULL
      AND COALESCE(
        (SELECT pu.concedido FROM permisos_usuario pu
         WHERE pu.usuario_id = u.id AND pu.permiso_codigo = $1),
        EXISTS (SELECT 1 FROM permisos_rol pr
                WHERE pr.rol = u.rol AND pr.permiso_codigo = $1)
      ) = $2
    ORDER BY u.id
    LIMIT 1
  `, [PERMISSION, granted]);
  return result.rows[0] || null;
};

const main = async () => {
  assert.ok(process.env.JWT_SECRET, 'JWT_SECRET debe existir en el entorno de prueba.');
  const studentResult = await pool.query(`
    SELECT id_alumno FROM alumno
    WHERE activo = true AND fusionado_en_id IS NULL AND rut IS NOT NULL
    ORDER BY id_alumno LIMIT 1
  `);
  const student = studentResult.rows[0];
  const privileged = await findUser(true);
  const restricted = await findUser(false);
  assert.ok(student, 'Se necesita una ficha con RUN para la prueba.');
  assert.ok(privileged, 'Se necesita una cuenta con permiso de revelación.');
  assert.ok(restricted, 'Se necesita una cuenta sin permiso de revelación.');

  const maskedResponse = await request(`/students/${student.id_alumno}/details`, privileged);
  assert.equal(maskedResponse.status, 200);
  assert.match(maskedResponse.headers.get('cache-control') || '', /no-store/);
  const masked = await maskedResponse.json();
  assert.equal(masked.proteccion_identidad.identificadores_completos, false);
  assert.equal('rut' in masked.alumno, false);
  assert.equal('codigo_barra' in masked.alumno, false);
  assert.equal(masked.identificadores.every((identifier) => !('valor_original' in identifier)), true);

  const deniedResponse = await request(`/students/${student.id_alumno}/details?include_sensitive=true`, restricted);
  assert.equal(deniedResponse.status, 403);

  const auditBefore = await pool.query(`
    SELECT count(*)::int AS total FROM audit_log
    WHERE accion = 'REVELAR_IDENTIFICADORES_ESTUDIANTE'
      AND usuario_id = $1 AND entidad_id = $2
  `, [privileged.id, String(student.id_alumno)]);
  const revealedResponse = await request(`/students/${student.id_alumno}/details?include_sensitive=true`, privileged);
  assert.equal(revealedResponse.status, 200);
  const revealed = await revealedResponse.json();
  assert.equal(revealed.proteccion_identidad.identificadores_completos, true);
  assert.ok(revealed.alumno.rut);
  assert.equal(revealed.identificadores.some((identifier) => identifier.valor_original), true);

  const auditAfter = await pool.query(`
    SELECT count(*)::int AS total FROM audit_log
    WHERE accion = 'REVELAR_IDENTIFICADORES_ESTUDIANTE'
      AND usuario_id = $1 AND entidad_id = $2
  `, [privileged.id, String(student.id_alumno)]);
  assert.equal(auditAfter.rows[0].total, auditBefore.rows[0].total + 1);

  console.log('Protección API verificada: máscara por defecto, rechazo 403, revelación autorizada y auditoría.');
};

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
