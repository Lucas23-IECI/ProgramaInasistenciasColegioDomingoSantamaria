const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractCandidateData, normalizeOcrText } = require('../services/documentOcrService');
const { createInstitutionalPdf, renderTemplate } = require('../services/documentPdfService');

const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations', '034_gestion_documental_estudiantes.sql'), 'utf8');
const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'studentDocuments.js'), 'utf8');

test('la migración documental es aditiva y protege relaciones históricas', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS expedientes_documentales/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS documento_expediente_versiones/);
  assert.match(migration, /ON DELETE RESTRICT/);
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM alumno|DELETE FROM matricula/i);
});

test('los permisos documentales son granulares y se asignan solo a perfiles previstos', () => {
  for (const permission of ['documents.view', 'documents.upload', 'documents.manage', 'documents.sign', 'documents.templates', 'documents.ocr']) {
    assert.match(migration, new RegExp(permission.replace('.', '\\.')));
  }
  assert.match(migration, /SELECT 'admin', codigo/);
  assert.match(migration, /SELECT 'documental', codigo/);
  assert.doesNotMatch(migration, /SELECT 'lector', codigo/);
});

test('la API exige permisos en backend y no expone eliminación física', () => {
  assert.match(route, /router\.use\(verifyToken\)/);
  assert.match(route, /verifyPermission\('documents\.view'\)/);
  assert.match(route, /verifyPermission\('documents\.upload'\)/);
  assert.match(route, /verifyPermission\('documents\.sign'\)/);
  assert.match(route, /verifyPermission\('documents\.ocr'\)/);
  assert.doesNotMatch(route, /router\.delete\(/);
});

test('las plantillas reemplazan solo campos permitidos y marcan pendientes', () => {
  const rendered = renderTemplate({ contenido: 'Alumno {{nombre}} · dato {{secreto}}', campos_permitidos: ['nombre'] }, { nombre: 'Josefa', secreto: 'no usar' });
  assert.equal(rendered.content, 'Alumno Josefa · dato [secreto pendiente]');
  assert.deepEqual(rendered.unresolved, ['secreto']);
});

test('el PDF generado mantiene una firma PDF válida', async () => {
  const pdf = await createInstitutionalPdf({
    template: { nombre: 'Certificado de prueba', categoria: 'CERTIFICADO', contenido: 'Se certifica a {{estudiante_nombre}}.', campos_permitidos: ['estudiante_nombre'] },
    values: { estudiante_nombre: 'Josefa Alarcón' },
    student: { nombre: 'Josefa Alarcón' },
    generatedBy: 'Prueba automatizada'
  });
  assert.equal(pdf.subarray(0, 5).toString('ascii'), '%PDF-');
  assert(pdf.length > 1000);
});

test('OCR normaliza texto y propone candidatos sin aplicar cambios', () => {
  const text = normalizeOcrText(' Documento   12.345.678-5\n\n\nFecha 09/08/2026 ');
  assert.equal(text, 'Documento 12.345.678-5\n\nFecha 09/08/2026');
  const candidates = extractCandidateData(text);
  assert.deepEqual(candidates.identificadores_detectados, ['12.345.678-5']);
  assert.deepEqual(candidates.fechas_detectadas, ['09/08/2026']);
});
