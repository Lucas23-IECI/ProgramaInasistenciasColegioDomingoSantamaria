const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DocumentValidationError,
  parseDocumentData,
  sanitizeOriginalName
} = require('../services/documentService');

const asDataUrl = (mime, buffer) => `data:${mime};base64,${buffer.toString('base64')}`;

test('acepta un PDF auténtico y calcula metadatos', () => {
  const pdf = Buffer.from('%PDF-1.7\ncontenido de prueba');
  const parsed = parseDocumentData({
    fileName: 'certificado médico.pdf',
    fileData: asDataUrl('application/pdf', pdf)
  });

  assert.equal(parsed.mimeType, 'application/pdf');
  assert.equal(parsed.extension, '.pdf');
  assert.equal(parsed.size, pdf.length);
  assert.match(parsed.sha256, /^[a-f0-9]{64}$/);
});

test('rechaza una extensión declarada cuyo contenido no corresponde', () => {
  assert.throws(() => parseDocumentData({
    fileName: 'falso.pdf',
    fileData: asDataUrl('application/pdf', Buffer.from('esto no es un pdf'))
  }), DocumentValidationError);
});

test('rechaza formatos que no están en la lista permitida', () => {
  assert.throws(() => parseDocumentData({
    fileName: 'archivo.exe',
    fileData: asDataUrl('application/octet-stream', Buffer.from('MZ'))
  }), /Formato no permitido/);
});

test('normaliza el nombre original sin aceptar rutas', () => {
  const name = sanitizeOriginalName('../../certificado<>.pdf');
  assert.equal(name, 'certificado__.pdf');
  assert.equal(name.includes('..'), false);
});

