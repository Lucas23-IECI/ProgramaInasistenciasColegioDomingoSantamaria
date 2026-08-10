const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 36_000_000;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export const PROFILE_IMAGE_OUTPUTS = Object.freeze({
  avatar: { width: 640, height: 640, aspect: 1 },
  cover: { width: 1800, height: 600, aspect: 3 }
});

const loadImage = (source) => new Promise((resolve, reject) => {
  const image = new Image();
  image.decoding = 'async';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('No fue posible leer la imagen seleccionada.'));
  image.src = source;
});

const canvasToBlob = (canvas, type = 'image/webp', quality = 0.92) => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => {
    if (blob) resolve(blob);
    else reject(new Error('No fue posible generar la imagen final.'));
  }, type, quality);
});

export const blobAsDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('No fue posible preparar la imagen para guardarla.'));
  reader.readAsDataURL(blob);
});

export const rotatedBoundingBox = (width, height, rotation) => {
  const radians = (rotation * Math.PI) / 180;
  return {
    width: Math.abs(Math.cos(radians) * width) + Math.abs(Math.sin(radians) * height),
    height: Math.abs(Math.sin(radians) * width) + Math.abs(Math.cos(radians) * height)
  };
};

export const validateProfileImageFile = async (file) => {
  if (!file || !ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error('Selecciona una imagen JPG, PNG o WEBP.');
  }
  if (!file.size || file.size > MAX_IMAGE_BYTES) {
    throw new Error('La imagen debe pesar como máximo 5 MB.');
  }

  const source = URL.createObjectURL(file);
  try {
    const image = await loadImage(source);
    if (!image.naturalWidth || !image.naturalHeight) {
      throw new Error('La imagen no contiene dimensiones válidas.');
    }
    if (image.naturalWidth * image.naturalHeight > MAX_IMAGE_PIXELS) {
      throw new Error('La imagen supera el máximo de 36 megapíxeles.');
    }
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(source);
  }
};

export const createCroppedImageBlob = async ({
  imageSrc,
  pixelCrop,
  rotation = 0,
  outputWidth,
  outputHeight,
  quality = 0.92
}) => {
  if (!pixelCrop?.width || !pixelCrop?.height) {
    throw new Error('Ajusta el encuadre antes de guardar.');
  }

  const image = await loadImage(imageSrc);
  const bounds = rotatedBoundingBox(image.naturalWidth, image.naturalHeight, rotation);
  const rotationCanvas = document.createElement('canvas');
  rotationCanvas.width = Math.max(1, Math.round(bounds.width));
  rotationCanvas.height = Math.max(1, Math.round(bounds.height));
  const rotationContext = rotationCanvas.getContext('2d', { alpha: false });
  if (!rotationContext) throw new Error('El navegador no permite procesar esta imagen.');

  rotationContext.fillStyle = '#ffffff';
  rotationContext.fillRect(0, 0, rotationCanvas.width, rotationCanvas.height);
  rotationContext.translate(rotationCanvas.width / 2, rotationCanvas.height / 2);
  rotationContext.rotate((rotation * Math.PI) / 180);
  rotationContext.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);

  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = outputWidth;
  outputCanvas.height = outputHeight;
  const outputContext = outputCanvas.getContext('2d', { alpha: false });
  if (!outputContext) throw new Error('El navegador no permite generar el recorte.');

  outputContext.imageSmoothingEnabled = true;
  outputContext.imageSmoothingQuality = 'high';
  outputContext.drawImage(
    rotationCanvas,
    Math.max(0, Math.round(pixelCrop.x)),
    Math.max(0, Math.round(pixelCrop.y)),
    Math.max(1, Math.round(pixelCrop.width)),
    Math.max(1, Math.round(pixelCrop.height)),
    0,
    0,
    outputWidth,
    outputHeight
  );

  return canvasToBlob(outputCanvas, 'image/webp', quality);
};

export const profileImageLimits = Object.freeze({
  maxBytes: MAX_IMAGE_BYTES,
  maxPixels: MAX_IMAGE_PIXELS,
  allowedTypes: [...ALLOWED_IMAGE_TYPES]
});
