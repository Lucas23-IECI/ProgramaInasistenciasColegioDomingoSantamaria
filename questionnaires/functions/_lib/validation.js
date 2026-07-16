import { getQuestionnaire } from './questionnaires.js';
import { normalizeText } from './http.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function sanitizeIdentity(raw = {}, invitation = {}) {
  const fullName = normalizeText(raw.fullName || invitation.respondent_name, 140);
  const position = normalizeText(raw.position, 140);
  const email = normalizeText(raw.email || invitation.respondent_email, 180).toLowerCase();
  const unit = normalizeText(raw.unit, 140);

  return { fullName, position, email, unit };
}

export function validateIdentity(identity, { final = false } = {}) {
  const errors = {};
  if (final && identity.fullName.length < 5) errors.fullName = 'Ingrese el nombre completo.';
  if (final && identity.position.length < 3) errors.position = 'Ingrese el cargo o función.';
  if (identity.email && !EMAIL_PATTERN.test(identity.email)) errors.email = 'Ingrese un correo válido.';
  return errors;
}

export function sanitizeAnswers(role, rawAnswers = {}) {
  const questionnaire = getQuestionnaire(role);
  if (!questionnaire) return {};

  return Object.fromEntries(questionnaire.questions.map((question) => {
    const raw = rawAnswers[question.id];
    if (question.type === 'checkbox') {
      const allowed = new Set(question.options || []);
      const values = Array.isArray(raw) ? raw : [];
      return [question.id, [...new Set(values.map((item) => normalizeText(item, 160)).filter((item) => allowed.has(item)))]];
    }
    if (question.type === 'radio') {
      const value = normalizeText(raw, 200);
      return [question.id, (question.options || []).includes(value) ? value : ''];
    }
    if (question.type === 'time') {
      const value = normalizeText(raw, 5);
      return [question.id, TIME_PATTERN.test(value) ? value : ''];
    }
    if (question.type === 'number') {
      const value = Number(raw);
      return [question.id, Number.isFinite(value) ? value : ''];
    }
    return [question.id, normalizeText(raw, question.maxLength || 700)];
  }));
}

export function validateAnswers(role, answers, { final = false } = {}) {
  const questionnaire = getQuestionnaire(role);
  if (!questionnaire) return { _form: 'Cuestionario no reconocido.' };
  if (!final) return {};

  const errors = {};
  for (const question of questionnaire.questions) {
    if (!question.required) continue;
    const value = answers[question.id];
    const empty = Array.isArray(value) ? value.length === 0 : String(value ?? '').trim() === '';
    if (empty) errors[question.id] = 'Esta respuesta es necesaria para continuar.';
  }
  return errors;
}

export function calculateProgress(role, identity, answers) {
  const questionnaire = getQuestionnaire(role);
  if (!questionnaire) return 0;
  const identityFields = [identity.fullName, identity.position];
  const answerValues = questionnaire.questions.map((question) => answers[question.id]);
  const completed = [...identityFields, ...answerValues].filter((value) =>
    Array.isArray(value) ? value.length > 0 : String(value ?? '').trim() !== ''
  ).length;
  return Math.round((completed / (identityFields.length + answerValues.length)) * 100);
}
