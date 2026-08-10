import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

test('el perfil personal mantiene cuenta, cargo y permisos como conceptos separados', () => {
  const source = fs.readFileSync(path.join(root, 'StaffProfile.jsx'), 'utf8');
  assert.match(source, /Tu presentación dentro del equipo institucional/);
  assert.match(source, /no reemplazan el cargo ni los permisos de acceso/);
  assert.doesNotMatch(source, /students|alumnos|matricula/i);
});

test('el menu global ofrece perfil propio y directorio segun permiso', () => {
  const source = fs.readFileSync(path.join(root, 'components', 'GlobalTools.jsx'), 'utf8');
  assert.match(source, /navigate\('\/mi-perfil'\)/);
  assert.match(source, /PROFILES_DIRECTORY_VIEW/);
  assert.match(source, /navigate\('\/directorio'\)/);
});

test('la ficha usa silueta humana y escudo para cuentas compartidas', () => {
  const source = fs.readFileSync(path.join(root, 'components', 'StaffAvatar.jsx'), 'utf8');
  assert.match(source, /UserRound/);
  assert.match(source, /escudo-ldsm-concepcion\.jpg/);
  assert.match(source, /cuenta_compartida/);
});

test('la interfaz contempla edicion responsive, directorio y administracion separada', () => {
  const profile = fs.readFileSync(path.join(root, 'StaffProfile.jsx'), 'utf8');
  const directory = fs.readFileSync(path.join(root, 'StaffDirectory.jsx'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'styles', 'staff-profiles.css'), 'utf8');
  assert.match(profile, /PROFILES_OWN_EDIT/);
  assert.match(profile, /PROFILES_MANAGE/);
  assert.match(directory, /Buscar por nombre, cargo, área, perfil o ubicación/i);
  assert.match(directory, /Todas las áreas/);
  assert.match(directory, /Todos los cargos/);
  assert.match(directory, /Todos los estados/);
  assert.match(directory, /Puestos compartidos/);
  assert.match(directory, /controller\.abort\(\)/);
  assert.match(profile, /Tienes cambios sin guardar/);
  assert.match(profile, /beforeunload/);
  assert.match(css, /@media \(max-width: 680px\)/);
});

test('el menú del usuario centra el avatar sin aplicar estilos de texto sobre su contenedor', () => {
  const css = fs.readFileSync(path.join(root, 'styles', 'design-system.css'), 'utf8');
  assert.match(css, /grid-template-columns:\s*46px minmax\(0, 1fr\)/);
  assert.match(css, /\.global-user-menu__identity\s*>\s*div\s*>\s*span/);
  assert.doesNotMatch(css, /\.global-user-menu__identity span\s*\{/);
});
