import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('el compositor permite combinar personas, perfiles y equipos institucionales', () => {
  const source = read('src/components/NotificationComposer.jsx');
  assert.match(source, /Personas/u);
  assert.match(source, /Perfiles/u);
  assert.match(source, /Equipos/u);
  assert.match(source, /\/api\/notificaciones\/audiencias/u);
  assert.match(source, /perfiles: selectedProfiles/u);
  assert.match(source, /grupos: selectedGroups/u);
  assert.match(source, /reciben un solo aviso/u);
});

test('la selección de audiencias mantiene una presentación adaptable', () => {
  const styles = read('src/styles/design-system.css');
  assert.match(styles, /\.notification-audience-tabs/u);
  assert.match(styles, /grid-template-columns: repeat\(3/u);
  assert.match(styles, /\.notification-audience-note/u);
});
