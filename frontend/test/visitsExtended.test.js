import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const source = fs.readFileSync(
  path.resolve(import.meta.dirname, '../src/features/visits/VisitsExtendedPanel.jsx'),
  'utf8'
);
const operationsSource = fs.readFileSync(
  path.resolve(import.meta.dirname, '../src/features/visits/useVisitsExtendedOperations.js'),
  'utf8'
);

test('la preinscripción captura ambas fechas visibles antes de enviar la credencial', () => {
  assert.match(operationsSource, /querySelectorAll\([\s\S]{0,80}\.extended-operations input\[type="datetime-local"\]/u);
  assert.match(operationsSource, /valida_desde: dateFields\[0\]\?\.value \|\| form\.valida_desde/u);
  assert.match(operationsSource, /valida_hasta: dateFields\[1\]\?\.value \|\| form\.valida_hasta/u);
  assert.match(operationsSource, /axios\.post\(`\$\{API_URL\}\/visitas\/preinscripciones`, payload\)/u);
});

test('la credencial temporal ofrece QR e impresión sin exponer el token en listados', () => {
  assert.match(source, /QRCodeWriter/u);
  assert.match(source, /Credencial temporal/u);
  assert.match(source, /window\.print\(\)/u);
  assert.doesNotMatch(source, /item\.token_hash/u);
});

test('el QR entrega a ZXing un mapa de opciones y no derriba la credencial', () => {
  assert.match(source, /encode\([\s\S]{0,100}BarcodeFormat\.QR_CODE[\s\S]{0,100}new Map\(\)/u);
});

test('la operación ampliada permite cancelar credenciales y vincular vehículos', () => {
  assert.match(operationsSource, /preinscripciones\/\$\{item\.id\}\/cancelar/u);
  assert.match(operationsSource, /Cancelar visita esperada/u);
  assert.match(source, /Vincular a una visita activa/u);
  assert.match(operationsSource, /visitas\/\$\{vehicleLink\.visita_id\}\/vehiculos\/\$\{vehicleLink\.vehiculo_id\}/u);
});
