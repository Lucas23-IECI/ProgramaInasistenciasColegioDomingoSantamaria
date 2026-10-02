import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('el historial conserva el envío objetivo y permite reintentar un detalle fallido', () => {
  const source = read('src/components/NotificationHistoryDialog.jsx');
  assert.match(source, /const \[detailTarget, setDetailTarget\] = useState\(null\)/u);
  assert.match(source, /setDetailTarget\(shipment\)/u);
  assert.match(source, /openDetail\(detailTarget\)/u);
  assert.match(source, /disabled=!\{detailTarget\?\.id_envio\}|disabled=\{!detailTarget\?\.id_envio\}/u);
  assert.match(source, /detailSequenceRef/u);
});

test('el historial muestra trazabilidad, origen y resumen adaptable', () => {
  const source = read('src/components/NotificationHistoryDialog.jsx');
  const styles = read('src/styles/design-system.css');
  assert.match(source, /Resumen de envíos/u);
  assert.match(source, /Reintento #/u);
  assert.match(source, /Abrir destino del aviso/u);
  assert.match(styles, /\.notification-history__summary/u);
  assert.match(styles, /grid-template-columns: repeat\(2/u);
  assert.match(styles, /\.notification-history__origin/u);
  assert.match(styles, /\.notification-history__list p \{[^}]*color: var\(--text-muted, #526777\)/u);
  assert.match(styles, /\.notification-history time \{[^}]*color: var\(--text-muted, #526777\)/u);
});
