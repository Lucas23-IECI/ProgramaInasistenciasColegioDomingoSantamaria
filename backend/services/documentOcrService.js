const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { createWorker } = require('tesseract.js');
const spanishData = require('@tesseract.js-data/spa');

const OCR_CACHE_DIR = path.resolve(process.env.OCR_CACHE_DIR || path.join(os.tmpdir(), 'ldsm-ocr-cache'));
let workerPromise = null;
let queue = Promise.resolve();

const getWorker = async () => {
  if (!workerPromise) {
    await fs.promises.mkdir(OCR_CACHE_DIR, { recursive: true, mode: 0o700 });
    workerPromise = createWorker('spa', 1, {
      langPath: spanishData.langPath,
      gzip: spanishData.gzip,
      cachePath: OCR_CACHE_DIR,
      logger: () => {}
    }).catch((error) => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
};

const normalizeOcrText = (value) => String(value || '')
  .replace(/\u0000/g, '')
  .replace(/[ \t]+/g, ' ')
  .replace(/\n{3,}/g, '\n\n')
  .trim()
  .slice(0, 24000);

const extractCandidateData = (text) => {
  const dates = [...text.matchAll(/\b([0-3]?\d)[/.-]([01]?\d)[/.-]((?:19|20)\d{2})\b/g)]
    .slice(0, 8)
    .map((match) => match[0]);
  const documents = [...text.matchAll(/\b(?:\d{1,2}[.]?\d{3}[.]?\d{3}-[0-9Kk]|\d{7,12}|[A-Z]{1,3}\d{5,12})\b/g)]
    .slice(0, 8)
    .map((match) => match[0]);
  const emails = [...text.matchAll(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi)]
    .slice(0, 5)
    .map((match) => match[0]);
  return { fechas_detectadas: dates, identificadores_detectados: documents, correos_detectados: emails };
};

const recognizeImage = async ({ filePath, mimeType }) => {
  if (!['image/png', 'image/jpeg'].includes(mimeType)) {
    return {
      estado: 'NO_COMPATIBLE',
      texto: '',
      confianza: null,
      datos: {},
      motor: 'Tesseract.js 7 · spa local',
      message: 'El OCR local se encuentra habilitado para imágenes PNG y JPG. Los PDF deben revisarse manualmente.'
    };
  }

  const run = async () => {
    const prepared = await sharp(filePath, { limitInputPixels: 36_000_000 })
      .rotate()
      .resize({ width: 2200, height: 2200, fit: 'inside', withoutEnlargement: true })
      .grayscale()
      .normalize()
      .png({ compressionLevel: 8 })
      .toBuffer();
    const worker = await getWorker();
    const result = await worker.recognize(prepared);
    const text = normalizeOcrText(result.data.text);
    return {
      estado: 'PROPUESTO',
      texto: text,
      confianza: Number.isFinite(result.data.confidence) ? Number(result.data.confidence.toFixed(2)) : null,
      datos: extractCandidateData(text),
      motor: 'Tesseract.js 7 · spa local',
      message: 'Extracción terminada. Una persona autorizada debe revisar y aprobar la propuesta.'
    };
  };

  const resultPromise = queue.then(run, run);
  queue = resultPromise.catch(() => {});
  return resultPromise;
};

module.exports = {
  extractCandidateData,
  normalizeOcrText,
  recognizeImage
};
