const MRZ_WEIGHTS = [7, 3, 1];

const cleanMrzLine = (value) => String(value || '')
  .toUpperCase()
  .replace(/\s/g, '')
  .replace(/[^A-Z0-9<]/g, '');

const mrzCharacterValue = (character) => {
  if (/\d/.test(character)) return Number(character);
  if (/[A-Z]/.test(character)) return character.charCodeAt(0) - 55;
  return 0;
};

export const computeMrzCheckDigit = (value) => String(value || '')
  .split('')
  .reduce((total, character, index) => (
    total + (mrzCharacterValue(character) * MRZ_WEIGHTS[index % MRZ_WEIGHTS.length])
  ), 0) % 10;

const checkMrzField = (value, digit) => /^\d$/.test(digit)
  && computeMrzCheckDigit(value) === Number(digit);

const parseMrzDate = (value, kind) => {
  if (!/^\d{6}$/.test(value)) return null;
  const yy = Number(value.slice(0, 2));
  const month = Number(value.slice(2, 4));
  const day = Number(value.slice(4, 6));
  const currentYear = new Date().getUTCFullYear();
  const currentCentury = Math.floor(currentYear / 100) * 100;
  let year = currentCentury + yy;

  if (kind === 'birth' && year > currentYear) year -= 100;
  if (kind === 'expiry' && year < currentYear - 20) year += 100;

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;
  return `${year.toString().padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const decodeName = (value) => {
  const [surnamePart = '', givenPart = ''] = value.split('<<');
  const normalize = (part) => part.replace(/<+/g, ' ').trim();
  return {
    apellidos: normalize(surnamePart),
    nombres: normalize(givenPart),
  };
};

export const normalizeMrzInput = (value) => String(value || '')
  .split(/\r?\n/)
  .map(cleanMrzLine)
  .filter(Boolean)
  .slice(0, 2)
  .join('\n');

export const parsePassportTd3Mrz = (value) => {
  const lines = normalizeMrzInput(value).split('\n');
  if (lines.length !== 2 || lines.some((line) => line.length !== 44)) {
    return { valid: false, error: 'La MRZ debe contener exactamente dos líneas de 44 caracteres.' };
  }
  const [line1, line2] = lines;
  if (!line1.startsWith('P')) {
    return { valid: false, error: 'El texto no corresponde al formato TD3 de un pasaporte.' };
  }

  const passportRaw = line2.slice(0, 9);
  const nationality = line2.slice(10, 13);
  const birthRaw = line2.slice(13, 19);
  const expiryRaw = line2.slice(21, 27);
  const optionalRaw = line2.slice(28, 42);
  const checks = {
    numero_pasaporte: checkMrzField(passportRaw, line2[9]),
    fecha_nacimiento: checkMrzField(birthRaw, line2[19]),
    fecha_vencimiento: checkMrzField(expiryRaw, line2[27]),
    datos_opcionales: checkMrzField(optionalRaw, line2[42]),
    compuesto: checkMrzField(
      `${line2.slice(0, 10)}${line2.slice(13, 20)}${line2.slice(21, 43)}`,
      line2[43]
    ),
  };
  const dates = {
    fecha_nacimiento: parseMrzDate(birthRaw, 'birth'),
    fecha_vencimiento: parseMrzDate(expiryRaw, 'expiry'),
  };
  const valid = Object.values(checks).every(Boolean) && Object.values(dates).every(Boolean);
  if (!valid) {
    return {
      valid: false,
      error: 'La MRZ contiene dígitos verificadores o fechas que no coinciden.',
      checks,
    };
  }

  return {
    valid: true,
    formato: 'TD3',
    tipo_documento: line1.slice(0, 2).replace(/</g, ''),
    pais_emisor: line1.slice(2, 5).replace(/</g, ''),
    nacionalidad: nationality.replace(/</g, ''),
    numero_pasaporte: passportRaw.replace(/<+$/g, ''),
    sexo: line2[20] === '<' ? '' : line2[20],
    ...decodeName(line1.slice(5)),
    ...dates,
    checks,
    lines,
  };
};
