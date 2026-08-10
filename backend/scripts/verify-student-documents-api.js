const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const sharp = require('sharp');
const pool = require('../db');

const BASE_URL = process.env.DOCUMENTS_TEST_URL || 'http://127.0.0.1:5000';
const createdDocumentIds = [];
let studentId = null;
let expedienteExisted = false;

const cookieFor = (user) => `token=${jwt.sign({ id: user.id, token_version: user.token_version || 1 }, process.env.JWT_SECRET, { expiresIn: '15m' })}`;
const request = async (route, { cookie, method = 'GET', body } = {}) => {
  const response = await fetch(`${BASE_URL}${route}`, {
    method,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer());
  return { response, payload };
};

const createTestImage = async () => {
  const buffer = await sharp({
    create: { width: 1500, height: 520, channels: 3, background: '#ffffff' }
  }).composite([{ input: Buffer.from(`
    <svg width="1500" height="520" xmlns="http://www.w3.org/2000/svg">
      <rect width="1500" height="520" fill="white"/>
      <text x="80" y="155" font-family="Arial" font-size="76" font-weight="700" fill="black">CERTIFICADO ESCOLAR</text>
      <text x="80" y="275" font-family="Arial" font-size="58" fill="black">Documento 12.345.678-5</text>
      <text x="80" y="385" font-family="Arial" font-size="58" fill="black">Fecha 09/08/2026</text>
    </svg>
  `) }]).png().toBuffer();
  return { fileData: `data:image/png;base64,${buffer.toString('base64')}`, fileName: 'certificado-ocr-prueba.png' };
};

const cleanup = async () => {
  if (!createdDocumentIds.length) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const binaries = await client.query(`
      SELECT jd.id_documento, jd.nombre_almacenado
      FROM documento_expediente_versiones v
      JOIN justification_documents jd ON jd.id_documento = v.id_documento
      WHERE v.id_documento_expediente = ANY($1::int[])
    `, [createdDocumentIds]);
    await client.query('DELETE FROM firmas_documentales WHERE id_version IN (SELECT id_version FROM documento_expediente_versiones WHERE id_documento_expediente = ANY($1::int[]))', [createdDocumentIds]);
    await client.query('DELETE FROM documento_expediente_versiones WHERE id_documento_expediente = ANY($1::int[])', [createdDocumentIds]);
    await client.query('DELETE FROM documentos_expediente WHERE id_documento_expediente = ANY($1::int[])', [createdDocumentIds]);
    await client.query('DELETE FROM justification_documents WHERE id_documento = ANY($1::int[])', [binaries.rows.map((row) => row.id_documento)]);
    await client.query("DELETE FROM audit_log WHERE entidad = 'documento_expediente' AND entidad_id = ANY($1::int[])", [createdDocumentIds]);
    if (!expedienteExisted && studentId) {
      await client.query('DELETE FROM expedientes_documentales WHERE id_alumno = $1 AND NOT EXISTS (SELECT 1 FROM documentos_expediente WHERE id_expediente = expedientes_documentales.id_expediente)', [studentId]);
    }
    await client.query('COMMIT');
    for (const binary of binaries.rows) {
      await fs.promises.unlink(path.join(process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads'), binary.nombre_almacenado)).catch(() => {});
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
};

const main = async () => {
  const unauthorized = await request('/api/documentos-estudiantes/resumen');
  assert.equal(unauthorized.response.status, 401, 'El módulo debe exigir sesión');

  const adminResult = await pool.query("SELECT id, token_version FROM usuarios WHERE activo = true AND eliminado_en IS NULL AND rol = 'admin' ORDER BY id LIMIT 1");
  assert.equal(adminResult.rowCount, 1, 'Se necesita una cuenta administradora local');
  const adminCookie = cookieFor(adminResult.rows[0]);
  const readerResult = await pool.query("SELECT id, token_version FROM usuarios WHERE activo = true AND eliminado_en IS NULL AND rol = 'lector' ORDER BY id LIMIT 1");
  if (readerResult.rowCount) {
    const forbidden = await request('/api/documentos-estudiantes/resumen', { cookie: cookieFor(readerResult.rows[0]) });
    assert.equal(forbidden.response.status, 403, 'Portería no debe consultar expedientes documentales');
  }

  const studentResult = await pool.query('SELECT id_alumno FROM alumno WHERE activo = true ORDER BY id_alumno LIMIT 1');
  assert.equal(studentResult.rowCount, 1, 'Se necesita un estudiante local activo');
  studentId = studentResult.rows[0].id_alumno;
  expedienteExisted = Boolean((await pool.query('SELECT 1 FROM expedientes_documentales WHERE id_alumno = $1', [studentId])).rowCount);

  const image = await createTestImage();
  const created = await request(`/api/documentos-estudiantes/estudiantes/${studentId}/documentos`, {
    cookie: adminCookie,
    method: 'POST',
    body: {
      titulo: 'Prueba automatizada de expediente documental', categoria: 'CERTIFICADO', estado: 'VIGENTE',
      nivel_acceso: 'RESERVADO', vigente_desde: '2026-08-09', vence_en: '2027-08-09',
      descripcion: 'Registro temporal creado por la verificación local y eliminado al terminar.', ...image
    }
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.payload));
  createdDocumentIds.push(created.payload.document.id_documento_expediente);
  const documentId = created.payload.document.id_documento_expediente;
  const versionId = created.payload.version.id_version;

  const file = await request(`/api/documentos-estudiantes/estudiantes/${studentId}/expediente`, { cookie: adminCookie });
  assert.equal(file.response.status, 200);
  assert(file.payload.documents.some((document) => document.id_documento_expediente === documentId));

  const ocr = await request(`/api/documentos-estudiantes/versiones/${versionId}/ocr`, { cookie: adminCookie, method: 'POST', body: {} });
  assert.equal(ocr.response.status, 200, JSON.stringify(ocr.payload));
  assert.equal(ocr.payload.estado, 'PROPUESTO');
  assert(ocr.payload.texto.length > 5, 'El motor OCR debe devolver una propuesta revisable');
  const review = await request(`/api/documentos-estudiantes/versiones/${versionId}/ocr/revisar`, { cookie: adminCookie, method: 'POST', body: { accion: 'APROBAR', texto_revisado: ocr.payload.texto } });
  assert.equal(review.response.status, 200, JSON.stringify(review.payload));

  const sign = await request(`/api/documentos-estudiantes/versiones/${versionId}/firmar`, { cookie: adminCookie, method: 'POST', body: { tipo: 'REVISION', declaracion: 'Prueba automatizada de revisión interna del archivo.' } });
  assert.equal(sign.response.status, 201, JSON.stringify(sign.payload));
  assert.equal(sign.payload.sha256_version.length, 64);

  const versionTwo = await request(`/api/documentos-estudiantes/documentos/${documentId}/versiones`, { cookie: adminCookie, method: 'POST', body: { ...image, fileName: 'certificado-version-2.png', notas_version: 'Segunda versión de prueba.' } });
  assert.equal(versionTwo.response.status, 201, JSON.stringify(versionTwo.payload));
  assert.equal(versionTwo.payload.numero_version, 2);

  const templates = await request('/api/documentos-estudiantes/plantillas', { cookie: adminCookie });
  assert.equal(templates.response.status, 200);
  const template = templates.payload.find((item) => item.codigo === 'CERTIFICADO_MATRICULA');
  assert(template, 'Debe existir la plantilla institucional de matrícula');
  const generated = await request(`/api/documentos-estudiantes/estudiantes/${studentId}/generar`, { cookie: adminCookie, method: 'POST', body: { id_plantilla: template.id_plantilla, titulo: 'PDF de prueba automatizada', valores: { observacion: 'Documento temporal de control.' } } });
  assert.equal(generated.response.status, 201, JSON.stringify(generated.payload));
  createdDocumentIds.push(generated.payload.document.id_documento_expediente);

  const download = await request(`/api/documentos-estudiantes/versiones/${generated.payload.version.id_version}/descargar`, { cookie: adminCookie });
  assert.equal(download.response.status, 200);
  assert.equal(download.payload.subarray(0, 5).toString('ascii'), '%PDF-');

  const detail = await request(`/api/documentos-estudiantes/documentos/${documentId}`, { cookie: adminCookie });
  assert.equal(detail.response.status, 200);
  assert.equal(detail.payload.versions.length, 2);
  assert(detail.payload.versions.some((version) => version.firmas.length === 1));

  await cleanup();
  console.log(JSON.stringify({ ok: true, student_id: studentId, ocr_characters: ocr.payload.texto.length, verified: ['auth', 'permissions', 'upload', 'versions', 'ocr', 'human_review', 'signature', 'template_pdf', 'download', 'cleanup'] }));
};

main().catch(async (error) => {
  console.error(error);
  try { await cleanup(); } catch (cleanupError) { console.error('Cleanup failed:', cleanupError); }
  process.exitCode = 1;
}).finally(() => pool.end());
