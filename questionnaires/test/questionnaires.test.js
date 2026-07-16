import test from 'node:test';
import assert from 'node:assert/strict';

import { getQuestionnaire, ROLE_OPTIONS } from '../functions/_lib/questionnaires.js';
import { calculateProgress, sanitizeAnswers, sanitizeIdentity, validateAnswers, validateIdentity } from '../functions/_lib/validation.js';

test('todos los cargos tienen un cuestionario breve y preguntas únicas', () => {
  assert.equal(ROLE_OPTIONS.length, 6);
  for (const role of ROLE_OPTIONS) {
    const questionnaire = getQuestionnaire(role.value);
    assert.ok(questionnaire.questions.length >= 5);
    assert.ok(questionnaire.questions.length <= 6);
    assert.equal(new Set(questionnaire.questions.map((question) => question.id)).size, questionnaire.questions.length);
  }
});

test('el saneamiento elimina opciones no autorizadas', () => {
  const answers = sanitizeAnswers('direccion', {
    responsable_operacion_diaria: 'Dirección',
    autoridad_correcciones: ['Dirección', 'Cargo inventado'],
    estados_oficiales: ['Pendiente', 'Presente'],
    modalidad_cierre: 'valor manipulado'
  });
  assert.deepEqual(answers.autoridad_correcciones, ['Dirección']);
  assert.equal(answers.responsable_operacion_diaria, 'Dirección');
  assert.equal(answers.modalidad_cierre, '');
});

test('el envío final exige identidad y respuestas obligatorias', () => {
  const identity = sanitizeIdentity({ fullName: 'Ana Pérez', position: 'Directora', email: 'ana@liceo.cl' });
  assert.deepEqual(validateIdentity(identity, { final: true }), {});
  const answers = sanitizeAnswers('direccion', {});
  assert.ok(Object.keys(validateAnswers('direccion', answers, { final: true })).length >= 5);
});

test('el progreso solo considera campos respondidos', () => {
  const identity = { fullName: 'Ana Pérez', position: 'Directora' };
  const answers = sanitizeAnswers('direccion', { responsable_operacion_diaria: 'Dirección' });
  const progress = calculateProgress('direccion', identity, answers);
  assert.ok(progress > 0);
  assert.ok(progress < 100);
});
