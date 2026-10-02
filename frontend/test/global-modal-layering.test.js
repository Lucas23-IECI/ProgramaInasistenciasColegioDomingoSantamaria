import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const designSystem = readFileSync(new URL('../src/styles/design-system.css', import.meta.url), 'utf8');
const institutional = readFileSync(new URL('../src/styles/institutional.css', import.meta.url), 'utf8');
const feedback = readFileSync(new URL('../src/context/FeedbackContext.jsx', import.meta.url), 'utf8');

test('las herramientas globales no cubren los modales operativos', () => {
  for (const backdrop of [
    'agenda-dialog-backdrop',
    'chat-dialog-backdrop',
    'coex-modal-backdrop',
    'docs-modal-backdrop',
    'follow-dialog-backdrop',
    'operations-modal-backdrop',
    'resources-dialog-backdrop',
    'visit-dialog-backdrop'
  ]) {
    assert.match(designSystem, new RegExp(`body:has\\(\\.${backdrop}\\) \\.global-tools`, 'u'));
  }

  assert.match(designSystem, /visibility:\s*hidden/u);
  assert.match(designSystem, /pointer-events:\s*none/u);
});

test('todos los overlays globales comparten una jerarquía única y comprobable', () => {
  for (const token of [
    '--layer-global-tools: 10000',
    '--layer-global-panel: 11000',
    '--layer-drawer: 18000',
    '--layer-modal: 20000',
    '--layer-modal-popover: 21000',
    '--layer-confirmation: 23000',
    '--layer-toast: 24000',
    '--layer-critical: 25000'
  ]) {
    assert.match(designSystem, new RegExp(token, 'u'));
  }

  assert.match(designSystem, /\[class\$="-backdrop"\]:not\(\.app-dialog-backdrop, \.record-drawer-backdrop\)/u);
  assert.match(designSystem, /\.student-manual-overlay/u);
  assert.match(designSystem, /z-index:\s*var\(--layer-modal\)\s*!important/u);
  assert.match(institutional, /\.app-toast[\s\S]*z-index:\s*var\(--layer-toast/u);
  assert.match(institutional, /\.app-dialog-backdrop[\s\S]*z-index:\s*var\(--layer-confirmation/u);
  assert.match(feedback, /createPortal\(feedbackLayer, document\.body\)/u);
});
