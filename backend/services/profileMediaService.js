const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const PROFILE_UPLOAD_DIR = path.join(process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads'), 'profiles');
const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const ensureProfileUploadDir = () => {
  fs.mkdirSync(PROFILE_UPLOAD_DIR, { recursive: true });
};

const parseImageDataUrl = (value) => {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([a-zA-Z0-9+/=\r\n]+)$/.exec(String(value || ''));
  if (!match || !ALLOWED_MIME_TYPES.has(match[1])) {
    throw new Error('La imagen debe ser JPG, PNG o WEBP.');
  }
  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (!buffer.length || buffer.length > MAX_PROFILE_IMAGE_BYTES) {
    throw new Error('La imagen debe pesar como máximo 5 MB.');
  }
  return buffer;
};

const profileImageGeometry = (category) => category === 'portada'
  ? { main: { width: 1800, height: 600 }, thumb: { width: 720, height: 240 }, fit: 'cover' }
  : { main: { width: 640, height: 640 }, thumb: { width: 160, height: 160 }, fit: 'cover' };

const createProfileSourceBuffer = async (input) => {
  const attempts = [
    { size: 4096, quality: 88 },
    { size: 3200, quality: 84 },
    { size: 2560, quality: 80 }
  ];
  for (const attempt of attempts) {
    const buffer = await sharp(input, { failOn: 'error', limitInputPixels: 36_000_000 })
      .rotate()
      .resize({ width: attempt.size, height: attempt.size, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: attempt.quality, effort: 4 })
      .toBuffer();
    if (buffer.length <= MAX_PROFILE_IMAGE_BYTES) return buffer;
  }
  throw new Error('La imagen fuente es demasiado compleja para conservarla. Prueba con una imagen de menor tamaño.');
};

const processProfileImage = async ({ dataUrl, sourceDataUrl, category, userId }) => {
  if (!['avatar', 'portada'].includes(category)) throw new Error('Categoría de imagen no válida.');
  const input = parseImageDataUrl(dataUrl);
  const sourceInput = sourceDataUrl ? parseImageDataUrl(sourceDataUrl) : input;
  const metadata = await sharp(input, { failOn: 'error', limitInputPixels: 36_000_000 }).metadata();
  const sourceMetadata = await sharp(sourceInput, { failOn: 'error', limitInputPixels: 36_000_000 }).metadata();
  if (!metadata.width || !metadata.height) throw new Error('No fue posible leer la imagen.');
  if (!sourceMetadata.width || !sourceMetadata.height) throw new Error('No fue posible leer la imagen fuente.');

  ensureProfileUploadDir();
  const geometry = profileImageGeometry(category);
  const token = crypto.randomBytes(18).toString('hex');
  const baseName = `${category}-${userId}-${token}`;
  const mainName = `${baseName}.webp`;
  const thumbName = `${baseName}-thumb.webp`;
  const sourceName = `${baseName}-source.webp`;
  const mainPath = path.join(PROFILE_UPLOAD_DIR, mainName);
  const thumbPath = path.join(PROFILE_UPLOAD_DIR, thumbName);
  const sourcePath = path.join(PROFILE_UPLOAD_DIR, sourceName);

  const normalized = sharp(input, { failOn: 'error', limitInputPixels: 36_000_000 }).rotate();
  const mainBuffer = await normalized.clone()
    .resize({ ...geometry.main, fit: geometry.fit, position: 'centre', withoutEnlargement: category === 'avatar' })
    .webp({ quality: 84, effort: 4 })
    .toBuffer();
  const thumbBuffer = await normalized.clone()
    .resize({ ...geometry.thumb, fit: geometry.fit, position: 'centre' })
    .webp({ quality: 78, effort: 4 })
    .toBuffer();
  const outputMetadata = await sharp(mainBuffer).metadata();
  const sourceBuffer = await createProfileSourceBuffer(sourceInput);

  const written = [];
  try {
    fs.writeFileSync(mainPath, mainBuffer, { flag: 'wx' });
    written.push(mainPath);
    fs.writeFileSync(thumbPath, thumbBuffer, { flag: 'wx' });
    written.push(thumbPath);
    fs.writeFileSync(sourcePath, sourceBuffer, { flag: 'wx' });
    written.push(sourcePath);
  } catch (error) {
    for (const filePath of written) fs.rmSync(filePath, { force: true });
    throw error;
  }

  return {
    mainName,
    thumbName,
    sourceName,
    mimeType: 'image/webp',
    mainBytes: mainBuffer.length,
    thumbBytes: thumbBuffer.length,
    sourceBytes: sourceBuffer.length,
    width: outputMetadata.width,
    height: outputMetadata.height,
    sha256: crypto.createHash('sha256').update(mainBuffer).digest('hex'),
    sourceSha256: crypto.createHash('sha256').update(sourceBuffer).digest('hex')
  };
};

const resolveProfileImagePath = (fileName) => {
  const safeName = path.basename(String(fileName || ''));
  if (!safeName || safeName !== fileName) return null;
  const resolved = path.resolve(PROFILE_UPLOAD_DIR, safeName);
  const root = `${path.resolve(PROFILE_UPLOAD_DIR)}${path.sep}`;
  return resolved.startsWith(root) ? resolved : null;
};

const removeProfileImageFiles = (media) => {
  for (const fileName of [media?.nombre_principal, media?.nombre_miniatura, media?.nombre_fuente]) {
    const filePath = resolveProfileImagePath(fileName);
    if (!filePath) continue;
    try {
      fs.rmSync(filePath, { force: true });
    } catch (error) {
      console.warn(`[profile-media:cleanup] ${error.message}`);
    }
  }
};

module.exports = {
  MAX_PROFILE_IMAGE_BYTES,
  processProfileImage,
  removeProfileImageFiles,
  resolveProfileImagePath
};
