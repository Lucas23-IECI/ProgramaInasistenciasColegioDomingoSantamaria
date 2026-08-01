import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDuplicateReadGuard,
  getCameraAvailability,
  getCameraErrorMessage,
  normalizeScannedValue,
  vibrateForRegistration,
} from '../src/utils/cameraScanner.js';

test('normaliza la lectura sin modificar ceros ni el contenido del código', () => {
  assert.equal(normalizeScannedValue('\t0012345678\r\n'), '0012345678');
});

test('bloquea una segunda lectura inmediata y permite una posterior', () => {
  let currentTime = 1000;
  const guard = createDuplicateReadGuard({ windowMs: 3000, now: () => currentTime });
  assert.equal(guard.accept('ABC123'), true);
  currentTime = 2500;
  assert.equal(guard.accept('ABC123'), false);
  assert.equal(guard.accept('OTRO'), true);
  currentTime = 6000;
  assert.equal(guard.accept('ABC123'), true);
});

test('explica cuando la cámara no puede utilizarse por HTTP o por navegador', () => {
  assert.equal(getCameraAvailability({ secureContext: false }).code, 'INSECURE_CONTEXT');
  assert.equal(getCameraAvailability({ secureContext: true, mediaDevices: {} }).code, 'CAMERA_UNAVAILABLE');
  assert.equal(getCameraAvailability({
    secureContext: true,
    mediaDevices: { getUserMedia() {} },
  }).available, true);
  assert.match(getCameraErrorMessage({ name: 'NotAllowedError' }), /permiso de cámara/i);
});

test('la vibración es progresiva y opcional según el dispositivo', () => {
  let received = null;
  assert.equal(vibrateForRegistration('success', { vibrate: (pattern) => { received = pattern; return true; } }), true);
  assert.deepEqual(received, [80, 45, 80]);
  assert.equal(vibrateForRegistration('error', {}), false);
});
