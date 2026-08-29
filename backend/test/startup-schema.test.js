const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('los usuarios iniciales usan el índice parcial vigente de correos activos', () => {
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  assert.doesNotMatch(serverSource, /ON CONFLICT \(correo\) DO NOTHING/u);
  assert.equal(
    (serverSource.match(/ON CONFLICT \(LOWER\(correo\)\) WHERE eliminado_en IS NULL DO NOTHING/gu) || []).length,
    2
  );
});

test('el contenedor backend incluye un catálogo de fuentes estable para PDF y OCR', () => {
  const dockerfile = fs.readFileSync(path.join(__dirname, '..', 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /apk add --no-cache fontconfig ttf-dejavu/u);
});
