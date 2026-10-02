const sharp = require('sharp');
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const MANAGERS = new Set(['PROPIETARIO', 'MODERADOR']);
const ROLES = new Set(['PROPIETARIO', 'MODERADOR', 'MIEMBRO']);
const BACKGROUNDS = new Set(['institucional', 'salvia', 'arena', 'azul', 'personalizado']);
const DEFAULT_APPEARANCE = { fondo: 'institucional', tamano_texto: 'normal', fondo_data: null };
const assertManualConversation = (conversation) => {
  if (conversation.codigo_institucional) throw fail('Este canal se administra automáticamente desde los equipos institucionales. Aquí solo puedes cambiar tus avisos personales.', 409);
};
const assertCanSend = (conversation) => {
  if (conversation.solo_administradores && !MANAGERS.has(conversation.miembro_rol)) {
    throw fail('En este grupo solo los administradores pueden enviar mensajes y archivos.', 403);
  }
};
const processChatImage = async (value, avatar = false) => {
  if (typeof value !== 'string' || value.length > 5_600_000) throw fail('Selecciona una imagen JPG o PNG de hasta 4 MB.');
  const match = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw fail('La imagen debe ser JPG o PNG.');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 4 * 1024 * 1024) throw fail('La imagen debe pesar como máximo 4 MB.');
  try {
    const input = sharp(bytes, { failOn: 'error', limitInputPixels: 24_000_000 });
    const meta = await input.metadata();
    if (!['jpeg', 'png'].includes(meta.format) || (meta.pages || 1) !== 1) throw new Error('format');
    const normalized = await input.rotate().resize({ width: avatar ? 256 : 1600, height: avatar ? 256 : 1200, fit: avatar ? 'cover' : 'inside', withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer();
    if (normalized.length > (avatar ? 128 : 1024) * 1024) throw new Error('size');
    return `data:image/jpeg;base64,${normalized.toString('base64')}`;
  } catch { throw fail('No pudimos procesar esa imagen. Prueba con otra foto JPG o PNG de menor tamaño.'); }
};
const publicConversation = (conversation) => {
  const result = { ...conversation };
  delete result.foto_data;
  return result;
};
module.exports = { fail, MANAGERS, ROLES, BACKGROUNDS, DEFAULT_APPEARANCE, assertManualConversation, assertCanSend, processChatImage, publicConversation };
