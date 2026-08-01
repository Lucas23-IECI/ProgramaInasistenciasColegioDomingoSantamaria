export const cleanRutInput = (value) => String(value || '')
  .toUpperCase()
  .replace(/[^0-9K]/g, '')
  .slice(0, 9);

export const formatRutInput = (value) => {
  const clean = cleanRutInput(value);
  if (!clean) return '';
  if (clean.length === 1) return clean;

  const body = clean.slice(0, -1).replace(/^0+/, '') || '0';
  const dv = clean.slice(-1);
  const grouped = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${grouped}-${dv}`;
};

export const validateRutInput = (value) => {
  const clean = cleanRutInput(value);
  if (clean.length < 2) return false;
  const body = clean.slice(0, -1);
  const suppliedDv = clean.slice(-1);
  let sum = 0;
  let multiplier = 2;
  for (let index = body.length - 1; index >= 0; index -= 1) {
    sum += Number(body[index]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const result = 11 - (sum % 11);
  const expectedDv = result === 11 ? '0' : result === 10 ? 'K' : String(result);
  return suppliedDv === expectedDv;
};

export const formatChilePhoneInput = (value) => {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('56')) digits = digits.slice(2);
  digits = digits.slice(0, 9);
  if (!digits) return '';

  if (digits.startsWith('9')) {
    const first = digits.slice(0, 1);
    const middle = digits.slice(1, 5);
    const last = digits.slice(5, 9);
    return ['+56', first, middle, last].filter(Boolean).join(' ');
  }

  const area = digits.slice(0, 2);
  const middle = digits.slice(2, 5);
  const last = digits.slice(5, 9);
  return ['+56', area, middle, last].filter(Boolean).join(' ');
};

export const formatDocumentInput = (type, value) => (
  type === 'RUT'
    ? formatRutInput(value)
    : String(value || '').toUpperCase().slice(0, 40)
);
