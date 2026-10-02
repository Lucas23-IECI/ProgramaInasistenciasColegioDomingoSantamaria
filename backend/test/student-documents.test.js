const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractCandidateData, normalizeOcrText } = require('../services/documentOcrService');
const { createInstitutionalPdf, renderTemplate } = require('../services/documentPdfService');
const { isoDate } = require('../routes/studentDocuments');

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

test('la consulta transversal limita y pagina los documentos en el servidor', () => {
  assert.match(route, /req\.query\.pagina/);
  assert.match(route, /req\.query\.limite/);
  assert.match(route, /LIMIT \$5 OFFSET \$6/);
  assert.match(route, /pagina:\s*page/);
  assert.match(route, /limite:\s*limit/);
});

test('las vigencias aceptan solo fechas de calendario reales', () => {
  assert.equal(isoDate('2026-02-28'), true);
  assert.equal(isoDate('2028-02-29'), true);
  assert.equal(isoDate('2026-02-29'), false);
  assert.equal(isoDate('2026-13-01'), false);
  assert.equal(isoDate('31-12-2026'), false);
  assert.equal(isoDate(''), true);
});

test('el filtro próximos a vencer excluye vencidos y archivados', () => {
  assert.match(route, /d\.estado <> 'ARCHIVADO'[\s\S]*d\.vence_en BETWEEN CURRENT_DATE AND CURRENT_DATE \+ 30/);
  assert.doesNotMatch(route, /\$4::boolean = false OR d\.vence_en <= CURRENT_DATE \+ 30/);
});

test('el detalle calcula el estado efectivo con la misma regla que la lista', () => {
  assert.match(route, /SELECT d\.\*,[\s\S]*AS estado_efectivo,[\s\S]*e\.id_alumno/);
});

test('OCR y firma bloquean solicitudes duplicadas concurrentes', () => {
  assert.match(route, /FOR UPDATE OF v/);
  assert.match(route, /\['NO_SOLICITADO', 'ERROR', 'RECHAZADO'\]\.includes\(version\.ocr_estado\)/);
  assert.match(route, /El OCR de esta versión ya se está procesando/);
  assert.match(route, /firmante_usuario_id = \$3[\s\S]*revocada_en IS NULL/);
  assert.match(route, /Ya registraste una firma activa de este tipo/);
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

test('un PDF extenso no agrega páginas fantasma al escribir sus pies', async () => {
  const paragraphs = Array.from({ length: 14 }, (_, index) => (
    `Antecedente ${index + 1}. Este texto comprueba la continuidad de un documento institucional extenso entre páginas. `
    + 'La información debe conservar márgenes, legibilidad y un pie numerado sin crear hojas adicionales.'
  ));
  const pdf = await createInstitutionalPdf({
    template: {
      nombre: 'Constancia extensa',
      categoria: 'CERTIFICADO',
      contenido: paragraphs.join('\n\n'),
      campos_permitidos: []
    },
    values: {},
    student: { nombre: 'Estudiante de prueba' },
    generatedBy: 'Prueba automatizada'
  });
  const source = pdf.toString('latin1');
  const pages = source.match(/\/Type\s*\/Page\b/g) || [];
  assert(pages.length >= 2, 'la muestra debe ocupar más de una página');
  assert(pages.length <= 4, `la muestra no debe crear páginas fantasma: generó ${pages.length}`);
});

test('OCR normaliza texto y propone candidatos sin aplicar cambios', () => {
  const text = normalizeOcrText(' Documento   12.345.678-5\n\n\nFecha 09/08/2026 ');
  assert.equal(text, 'Documento 12.345.678-5\n\nFecha 09/08/2026');
  const candidates = extractCandidateData(text);
  assert.deepEqual(candidates.identificadores_detectados, ['12.345.678-5']);
  assert.deepEqual(candidates.fechas_detectadas, ['09/08/2026']);
});
