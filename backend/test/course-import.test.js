const test = require('node:test');
const assert = require('node:assert/strict');

const { findCourseMatch, normalizeCourseKey, similarity } = require('../utils/courseImport');

const courses = [
  { id_curso: 1, nombre_curso: '1° Básico' },
  { id_curso: 2, nombre_curso: '2° Medio' },
  { id_curso: 3, nombre_curso: 'Pre-Kínder' }
];

test('normaliza diferencias de mayúsculas, acentos y espaciado', () => {
  assert.equal(normalizeCourseKey('  PRE - KÍNDER '), normalizeCourseKey('pre-kinder'));
  assert.equal(normalizeCourseKey('1º Básico'), normalizeCourseKey('1° basico'));
});

test('reconoce un curso existente sin crear otro', () => {
  const match = findCourseMatch('1º basico', courses);
  assert.equal(match.kind, 'exact');
  assert.equal(match.course.id_curso, 1);
});

test('sugiere una equivalencia cercana pero no la confirma automáticamente', () => {
  const match = findCourseMatch('2° Medo', courses);
  assert.equal(match.kind, 'suggested');
  assert.equal(match.course.id_curso, 2);
});

test('marca un curso desconocido sin inventar una equivalencia', () => {
  const match = findCourseMatch('Taller externo experimental', courses);
  assert.equal(match.kind, 'unknown');
  assert.equal(match.course, null);
});

test('la similitud se mantiene acotada entre cero y uno', () => {
  assert.equal(similarity('abc', 'abc'), 1);
  assert.ok(similarity('abc', 'xyz') >= 0);
  assert.ok(similarity('abc', 'xyz') <= 1);
});
