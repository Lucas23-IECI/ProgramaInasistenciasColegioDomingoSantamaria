const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

test('los adjuntos confirmados no se eliminan si falla la respuesta HTTP', () => {
  const chat = read('routes/internalChat.js');
  const followUp = read('routes/followUp.js');
  const coexistence = read('routes/coexistence.js');
  const documents = read('routes/studentDocuments.js');
  const management = read('routes/students/management.js');
  const punctuality = read('routes/punctuality.js');

  assert.equal((chat.match(/await client\.query\('COMMIT'\);\s*storedName = null/gu) || []).length, 2);
  assert.match(followUp, /await client\.query\('COMMIT'\); storedName = null/gu);
  assert.match(coexistence, /await client\.query\('COMMIT'\);\s*storedName = null/gu);
  assert.equal((documents.match(/await client\.query\('COMMIT'\);\s*storedName = null/gu) || []).length, 3);
  assert.match(management, /await client\.query\('COMMIT'\);\s*committed = true/gu);
  assert.match(management, /if \(!committed && createdDocument\?\.nombre_almacenado\)/gu);
  assert.match(punctuality, /await client\.query\('COMMIT'\);\s*committed = true/gu);
  assert.match(punctuality, /if \(!committed && createdDocument\?\.nombre_almacenado\)/gu);
});
