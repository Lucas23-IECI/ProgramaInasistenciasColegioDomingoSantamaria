import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { PROFILE_IMAGE_OUTPUTS, rotatedBoundingBox } from '../src/utils/profileImageEditor.js';

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

test('define salidas estables y sin deformación para avatar y portada', () => {
  assert.deepEqual(PROFILE_IMAGE_OUTPUTS.avatar, { width: 640, height: 640, aspect: 1 });
  assert.deepEqual(PROFILE_IMAGE_OUTPUTS.cover, { width: 1800, height: 600, aspect: 3 });
  assert.equal(PROFILE_IMAGE_OUTPUTS.avatar.width / PROFILE_IMAGE_OUTPUTS.avatar.height, PROFILE_IMAGE_OUTPUTS.avatar.aspect);
  assert.equal(PROFILE_IMAGE_OUTPUTS.cover.width / PROFILE_IMAGE_OUTPUTS.cover.height, PROFILE_IMAGE_OUTPUTS.cover.aspect);
});

test('calcula correctamente el lienzo rotado en incrementos de 90 grados', () => {
  assert.deepEqual(rotatedBoundingBox(1200, 800, 0), { width: 1200, height: 800 });
  const rotated = rotatedBoundingBox(1200, 800, 90);
  assert.ok(Math.abs(rotated.width - 800) < 0.0001);
  assert.ok(Math.abs(rotated.height - 1200) < 0.0001);
});

test('el editor ofrece recorte visual, zoom, giro, restauración y estados de guardado', () => {
  const editor = fs.readFileSync(path.join(src, 'components', 'ProfileImageEditor.jsx'), 'utf8');
  const profile = fs.readFileSync(path.join(src, 'StaffProfile.jsx'), 'utf8');
  const css = fs.readFileSync(path.join(src, 'styles', 'staff-profiles.css'), 'utf8');

  assert.match(editor, /react-easy-crop/);
  assert.match(editor, /cropShape=\{category === 'avatar' \? 'round' : 'rect'\}/);
  assert.match(editor, /zoomWithScroll/);
  assert.match(editor, /setRotation\(\(current\) => normalizeRotation\(current \+ step\)\)/);
  assert.match(editor, /Restablecer/);
  assert.match(editor, /Guardar cambios/);
  assert.match(editor, /Tus ajustes se conservaron/);
  assert.match(profile, /validateProfileImageFile/);
  assert.match(profile, /setImageEditor\(\{ category, file \}\)/);
  assert.match(css, /cursor:\s*grab/);
  assert.match(css, /cursor:\s*grabbing/);
  assert.match(css, /@media \(max-width: 680px\)/);
  assert.match(css, /prefers-reduced-motion/);
});

test('la ficha permite reabrir avatar y portada existentes desde su fuente guardada', () => {
  const profileSource = fs.readFileSync(path.join(src, 'StaffProfile.jsx'), 'utf8');
  assert.match(profileSource, /avatar_source_url \|\| profile\.avatar_full_url/);
  assert.match(profileSource, /portada_source_url \|\| profile\.portada_url/);
  assert.match(profileSource, /Editar encuadre/);
  assert.match(profileSource, /Reencuadrar/);
  assert.match(profileSource, /source_data_url/);
});
