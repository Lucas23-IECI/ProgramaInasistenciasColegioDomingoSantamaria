import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EMPTY_SELECT_VALUE, fromSelectValue, toSelectValue } from '../src/utils/selectValue.js';

test('un selector obligatorio vacío muestra el placeholder y no un valor inexistente', () => {
  const options = [{ value: 'MATRICULA_RECIENTE', label: 'Matrícula reciente' }];
  for (const empty of ['', null, undefined]) assert.equal(toSelectValue(empty, options), '');
  assert.equal(toSelectValue('', []), '');
});

test('los filtros conservan su opción vacía explícita y devuelven una cadena vacía', () => {
  const options = [{ value: '', label: 'Todos los cursos' }, { value: 1, label: '1° Medio' }];
  assert.equal(toSelectValue('', options), EMPTY_SELECT_VALUE);
  assert.equal(fromSelectValue(EMPTY_SELECT_VALUE), '');
});

test('valores numéricos, cero y códigos institucionales no se pierden', () => {
  for (const value of [0, 1, '1° Medio', 'MATRICULA_RECIENTE']) {
    assert.equal(toSelectValue(value), String(value));
    assert.equal(fromSelectValue(toSelectValue(value)), String(value));
  }
});

test('los desplegables usan la capa sobre modales y Escape no cierra el formulario padre', () => {
  const css = readFileSync(new URL('../src/styles/design-system.css', import.meta.url), 'utf8');
  const component = readFileSync(new URL('../src/components/AppSelect.jsx', import.meta.url), 'utf8');
  assert.match(css, /\.app-select-content\s*\{[^}]*z-index:\s*var\(--layer-modal-popover,\s*21000\)/u);
  assert.match(component, /onEscapeKeyDown=\{\(event\) => event\.stopPropagation\(\)\}/u);
  assert.match(component, /if \(nextValue !== ''\) onChange\(fromSelectValue\(nextValue\)\)/u);
});

test('el alta conserva el curso real de origen y nunca usa las agrupaciones como curso', () => {
  const controller = readFileSync(new URL('../src/features/students/useStudentsController.js', import.meta.url), 'utf8');
  const modal = readFileSync(new URL('../src/components/StudentManualModal.jsx', import.meta.url), 'utf8');
  assert.match(controller, /courses\.some\(\(course\) => course\.nombre_curso === selectedCourse\)/u);
  assert.match(modal, /grade: student\?\.grade \|\| state\.initialCourse \|\| ''/u);
});

test('los seis motivos ofrecidos siguen siendo aceptados por servidor y esquema existentes', () => {
  const modal = readFileSync(new URL('../src/components/StudentManualModal.jsx', import.meta.url), 'utf8');
  const route = readFileSync(new URL('../../backend/routes/students/management.js', import.meta.url), 'utf8');
  const migration = readFileSync(new URL('../../backend/migrations/017_gobernanza_padron_estudiantil.sql', import.meta.url), 'utf8');
  const reasons = [...modal.matchAll(/value: '([A-Z_]+)', label:/gu)].map((match) => match[1]);
  assert.equal(reasons.length, 6);
  for (const reason of reasons) {
    assert.ok(route.includes(`'${reason}'`), reason);
    assert.ok(migration.includes(`'${reason}'`), reason);
  }
});
