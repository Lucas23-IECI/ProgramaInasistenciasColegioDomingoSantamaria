const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Cross-component checks need the whole checkout, not the frontend-only Docker
// build context. CI runs this explicitly; frontend unit tests remain standalone.
const root = path.resolve(__dirname, '../..');
test('los motivos del alta manual coinciden con el servidor y el esquema', () => {
  const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
  const modal = read('frontend/src/components/StudentManualModal.jsx');
  const route = read('backend/routes/students/management.js');
  const migration = read('backend/migrations/017_gobernanza_padron_estudiantil.sql');
  const reasons = [...modal.matchAll(/value: '([A-Z_]+)', label:/gu)].map((match) => match[1]);
  assert.equal(reasons.length, 6);
  for (const reason of reasons) {
    assert.ok(route.includes(`'${reason}'`), `Servidor: ${reason}`);
    assert.ok(migration.includes(`'${reason}'`), `Esquema: ${reason}`);
  }
});
