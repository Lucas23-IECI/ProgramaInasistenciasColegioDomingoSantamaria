const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads'));

const ALLOWED_MIME_TYPES = {
  'application/pdf': {
    extension: '.pdf',
    validSignature: (buffer) => buffer.subarray(0, 5).toString('ascii') === '%PDF-'
  },
  'image/png': {
    extension: '.png',
    validSignature: (buffer) => buffer.length >= 8
      && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  },
  'image/jpeg': {
    extension: '.jpg',
    validSignature: (buffer) => buffer.length >= 3
      && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  }
};

class DocumentValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DocumentValidationError';
    this.statusCode = 400;
  }
}

const sanitizeOriginalName = (fileName) => {
  const baseName = path.basename(String(fileName || 'documento'));
  const cleaned = baseName
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ._ -]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || 'documento').slice(0, 180);
};

const parseDocumentData = ({ fileData, fileName }) => {
  if (!fileData || !fileName) {
    throw new DocumentValidationError('Debe adjuntar un archivo válido.');
  }

  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(String(fileData));
  if (!match) {
    throw new DocumentValidationError('El archivo no tiene una codificación válida.');
  }

  const mimeType = match[1].toLowerCase();
  const rule = ALLOWED_MIME_TYPES[mimeType];
  if (!rule) {
    throw new DocumentValidationError('Formato no permitido. Use PDF, PNG o JPG.');
  }

  const base64 = match[2].replace(/[\r\n]/g, '');
  const estimatedBytes = Math.floor((base64.length * 3) / 4);
  if (estimatedBytes > MAX_DOCUMENT_BYTES) {
    throw new DocumentValidationError('El archivo supera el máximo permitido de 8 MB.');
  }

  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length || buffer.length > MAX_DOCUMENT_BYTES) {
    throw new DocumentValidationError('El archivo está vacío o supera el máximo permitido.');
  }
  if (!rule.validSignature(buffer)) {
    throw new DocumentValidationError('El contenido del archivo no corresponde a su formato declarado.');
  }

  return {
    buffer,
    mimeType,
    extension: rule.extension,
    originalName: sanitizeOriginalName(fileName),
    size: buffer.length,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex')
  };
};

const ensureUploadsDirectory = async () => {
  await fs.promises.mkdir(UPLOADS_DIR, { recursive: true, mode: 0o700 });
};

const createDocument = async (client, { fileData, fileName, userId }) => {
  const parsed = parseDocumentData({ fileData, fileName });
  return createDocumentFromBuffer(client, {
    buffer: parsed.buffer,
    fileName: parsed.originalName,
    mimeType: parsed.mimeType,
    extension: parsed.extension,
    userId
  });
};

const createDocumentFromBuffer = async (client, { buffer, fileName, mimeType, extension, userId }) => {
  const rule = ALLOWED_MIME_TYPES[String(mimeType || '').toLowerCase()];
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_DOCUMENT_BYTES) {
    throw new DocumentValidationError('El archivo generado está vacío o supera el máximo permitido.');
  }
  if (!rule || !rule.validSignature(buffer)) {
    throw new DocumentValidationError('El contenido generado no corresponde a un formato permitido.');
  }
  const safeExtension = extension || rule.extension;
  const originalName = sanitizeOriginalName(fileName);
  await ensureUploadsDirectory();

  const storedName = `${crypto.randomUUID()}${safeExtension}`;
  const filePath = path.join(UPLOADS_DIR, storedName);

  await fs.promises.writeFile(filePath, buffer, { flag: 'wx', mode: 0o600 });
  try {
    const result = await client.query(
      `INSERT INTO justification_documents
        (nombre_original, nombre_almacenado, mime_type, tamano_bytes, sha256, creado_por)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [originalName, storedName, String(mimeType).toLowerCase(), buffer.length,
        crypto.createHash('sha256').update(buffer).digest('hex'), userId]
    );
    return result.rows[0];
  } catch (error) {
    await fs.promises.unlink(filePath).catch(() => {});
    throw error;
  }
};

const removeStoredFile = async (storedName) => {
  if (!storedName || path.basename(storedName) !== storedName) return;
  await fs.promises.unlink(path.join(UPLOADS_DIR, storedName)).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
};

const deleteDocumentIfUnreferenced = async (client, documentId) => {
  if (!documentId) return null;
  const references = await client.query(
    `SELECT (
       (SELECT COUNT(*) FROM attendance_registrations WHERE documento_id = $1)
       +
       (SELECT COUNT(*) FROM alumno_identificador WHERE respaldo_documento_id = $1)
       +
       (SELECT COUNT(*) FROM regularizaciones_identidad_estudiante WHERE documento_id = $1)
       +
       (SELECT COUNT(*) FROM convivencia_documentos WHERE id_documento = $1)
       +
       (SELECT COUNT(*) FROM documento_expediente_versiones WHERE id_documento = $1)
       +
       (SELECT COUNT(*) FROM seguimiento_documentos WHERE id_documento = $1)
       +
       (SELECT COUNT(*) FROM chat_adjuntos WHERE id_documento = $1)
     )::int AS total`,
    [documentId]
  );
  if (references.rows[0].total > 0) return null;

  const deleted = await client.query(
    'DELETE FROM justification_documents WHERE id_documento = $1 RETURNING nombre_almacenado',
    [documentId]
  );
  return deleted.rows[0]?.nombre_almacenado || null;
};

const resolveDocumentPath = (storedName) => {
  if (!storedName || path.basename(storedName) !== storedName) return null;
  const resolved = path.resolve(UPLOADS_DIR, storedName);
  if (!resolved.startsWith(`${UPLOADS_DIR}${path.sep}`)) return null;
  return resolved;
};

module.exports = {
  ALLOWED_MIME_TYPES,
  DocumentValidationError,
  MAX_DOCUMENT_BYTES,
  UPLOADS_DIR,
  createDocument,
  createDocumentFromBuffer,
  deleteDocumentIfUnreferenced,
  parseDocumentData,
  removeStoredFile,
  resolveDocumentPath,
  sanitizeOriginalName
};

