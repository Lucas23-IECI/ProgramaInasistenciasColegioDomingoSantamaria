const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const pool = require('../db');
const { removeStoredFile } = require('../services/documentService');

const API_URL = process.env.COEXISTENCE_API_URL || 'http://127.0.0.1:5000/api/convivencia';

const tokenFor = (user) => jwt.sign({
  id: user.id,
  correo: user.correo,
  rol: user.rol,
  token_version: user.token_version || 1
}, process.env.JWT_SECRET, { expiresIn: '10m' });

const request = async (path, { method = 'GET', token, body } = {}) => {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(token ? { Cookie: `token=${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.arrayBuffer();
  return { response, payload };
};

const main = async () => {
  assert.ok(process.env.JWT_SECRET, 'JWT_SECRET debe existir en el entorno de prueba.');
  const users = await pool.query(`
    SELECT id, correo, rol, token_version
    FROM usuarios
    WHERE activo = true AND eliminado_en IS NULL
    ORDER BY CASE WHEN rol = 'admin' THEN 0 WHEN rol = 'lector' THEN 1 ELSE 2 END, id
  `);
  const admin = users.rows.find((user) => user.rol === 'admin');
  const restricted = users.rows.find((user) => user.rol === 'lector')
    || users.rows.find((user) => user.rol !== 'admin');
  assert.ok(admin, 'Se necesita una cuenta administrativa activa para la prueba.');
  assert.ok(restricted, 'Se necesita una cuenta sin acceso a convivencia para la prueba.');

  const adminToken = tokenFor(admin);
  const restrictedToken = tokenFor(restricted);
  let caseId = null;
  const storedFiles = [];
  try {
    const anonymous = await request('/resumen');
    assert.equal(anonymous.response.status, 401);

    const forbidden = await request('/resumen', { token: restrictedToken });
    assert.equal(forbidden.response.status, 403);

    const today = new Date().toISOString().slice(0, 10);
    const created = await request('/casos', {
      method: 'POST',
      token: adminToken,
      body: {
        titulo: 'PRUEBA CODEX - convivencia protegida',
        categoria: 'CONVIVENCIA',
        prioridad: 'MEDIA',
        descripcion_inicial: 'Antecedente reservado creado exclusivamente para validar el flujo local.',
        fecha_situacion: today,
        participantes: [{
          tipo_persona: 'EXTERNA',
          rol_en_caso: 'TESTIGO',
          nombre_externo: 'Persona externa de prueba'
        }]
      }
    });
    assert.equal(created.response.status, 201, JSON.stringify(created.payload));
    caseId = created.payload.id_caso;
    assert.ok(caseId);
    assert.match(created.payload.codigo, /^CE-\d{4}-\d{6}$/);

    const detail = await request(`/casos/${caseId}`, { token: adminToken });
    assert.equal(detail.response.status, 200);
    assert.match(detail.response.headers.get('cache-control') || '', /no-store/);
    assert.equal(detail.payload.participants.length, 1);
    assert.equal(detail.payload.events[0].tipo, 'SITUACION');

    const participant = await request(`/casos/${caseId}/participantes`, {
      method: 'POST',
      token: adminToken,
      body: {
        tipo_persona: 'OTRA',
        rol_en_caso: 'PROFESIONAL',
        nombre_externo: 'Profesional de apoyo de prueba'
      }
    });
    assert.equal(participant.response.status, 201, JSON.stringify(participant.payload));

    const action = await request(`/casos/${caseId}/actuaciones`, {
      method: 'POST',
      token: adminToken,
      body: {
        tipo: 'MEDIDA',
        titulo: 'Medida inicial de prueba',
        detalle: 'Se registra una medida controlada para verificar la linea de tiempo.',
        participantes: [participant.payload.id_participante]
      }
    });
    assert.equal(action.response.status, 201, JSON.stringify(action.payload));

    const pdf = Buffer.from('%PDF-1.4\n% prueba de convivencia\n%%EOF\n');
    const uploaded = await request(`/casos/${caseId}/documentos`, {
      method: 'POST',
      token: adminToken,
      body: {
        nombre_archivo: 'respaldo-prueba.pdf',
        archivo: `data:application/pdf;base64,${pdf.toString('base64')}`,
        descripcion: 'Respaldo temporal de la prueba automatizada.'
      }
    });
    assert.equal(uploaded.response.status, 201, JSON.stringify(uploaded.payload));
    const documentId = uploaded.payload.id_convivencia_documento;

    const download = await request(`/documentos/${documentId}/descargar`, { token: adminToken });
    assert.equal(download.response.status, 200);
    assert.match(download.response.headers.get('content-type') || '', /application\/pdf/);
    assert.ok(download.payload.byteLength > 5);

    const closed = await request(`/casos/${caseId}/cerrar`, {
      method: 'POST',
      token: adminToken,
      body: { motivo: 'Cierre controlado para validar el ciclo completo del caso.' }
    });
    assert.equal(closed.response.status, 200, JSON.stringify(closed.payload));

    const blockedAction = await request(`/casos/${caseId}/actuaciones`, {
      method: 'POST',
      token: adminToken,
      body: {
        tipo: 'SEGUIMIENTO',
        titulo: 'No debe guardarse',
        detalle: 'Intento deliberado sobre un caso cerrado.'
      }
    });
    assert.equal(blockedAction.response.status, 409);

    const reopened = await request(`/casos/${caseId}/reabrir`, {
      method: 'POST',
      token: adminToken,
      body: { motivo: 'Reapertura controlada para comprobar continuidad del seguimiento.' }
    });
    assert.equal(reopened.response.status, 200, JSON.stringify(reopened.payload));

    const listing = await request(`/casos?q=${encodeURIComponent(created.payload.codigo)}`, { token: adminToken });
    assert.equal(listing.response.status, 200);
    assert.equal(listing.payload.total, 1);
    assert.equal(listing.payload.items[0].id_caso, caseId);

    const audit = await pool.query(`
      SELECT accion, detalle::text
      FROM audit_log
      WHERE entidad = 'convivencia_caso' AND entidad_id = $1
      ORDER BY id
    `, [caseId]);
    assert.ok(audit.rowCount >= 7);
    assert.equal(audit.rows.some((row) => /Antecedente reservado|linea de tiempo|Cierre controlado/.test(row.detalle || '')), false);

    console.log('Convivencia verificada: acceso reservado, caso, participantes, actuación, documento, cierre y reapertura.');
  } finally {
    if (caseId) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const documents = await client.query(`
          SELECT d.id_documento, d.nombre_almacenado
          FROM convivencia_documentos cd
          JOIN justification_documents d ON d.id_documento = cd.id_documento
          WHERE cd.id_caso = $1
        `, [caseId]);
        storedFiles.push(...documents.rows.map((row) => row.nombre_almacenado));
        await client.query('DELETE FROM convivencia_documentos WHERE id_caso = $1', [caseId]);
        if (documents.rows.length) {
          await client.query(
            'DELETE FROM justification_documents WHERE id_documento = ANY($1::int[])',
            [documents.rows.map((row) => row.id_documento)]
          );
        }
        await client.query('DELETE FROM convivencia_eventos WHERE id_caso = $1', [caseId]);
        await client.query('DELETE FROM convivencia_participantes WHERE id_caso = $1', [caseId]);
        await client.query("DELETE FROM audit_log WHERE entidad = 'convivencia_caso' AND entidad_id = $1", [caseId]);
        await client.query('DELETE FROM convivencia_casos WHERE id_caso = $1', [caseId]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      await Promise.all(storedFiles.map((name) => removeStoredFile(name)));
    }
    await pool.end();
  }
};

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
