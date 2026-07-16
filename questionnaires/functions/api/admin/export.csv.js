import { requireAdmin } from '../../_lib/admin.js';
import { safeJsonParse } from '../../_lib/data.js';
import { getQuestionnaire } from '../../_lib/questionnaires.js';

const csvValue = (value) => {
  const text = Array.isArray(value) ? value.join(' | ') : String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
};

export async function onRequestGet(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;

  const result = await context.env.DB.prepare(`
    SELECT i.*, r.identity_json, r.answers_json
    FROM questionnaire_invitations i
    LEFT JOIN questionnaire_responses r ON r.invitation_id = i.id
    ORDER BY i.created_at ASC
  `).all();

  const header = ['Folio', 'Estado', 'Cargo asignado', 'Nombre invitado', 'Correo invitado', 'Nombre declarado', 'Cargo declarado', 'Unidad', 'Fecha de envío', 'Pregunta', 'Respuesta'];
  const rows = [header.map(csvValue).join(',')];
  for (const item of result.results || []) {
    const identity = safeJsonParse(item.identity_json);
    const answers = safeJsonParse(item.answers_json);
    const questionnaire = getQuestionnaire(item.role);
    const questions = questionnaire?.questions || [];
    if (!questions.length) questions.push({ id: '', label: '' });
    for (const question of questions) {
      rows.push([
        item.folio, item.status, questionnaire?.label || item.role, item.respondent_name, item.respondent_email,
        identity.fullName, identity.position, identity.unit, item.submitted_at, question.label, answers[question.id]
      ].map(csvValue).join(','));
    }
  }

  const date = new Date().toISOString().slice(0, 10);
  return new Response(`\uFEFF${rows.join('\r\n')}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="respuestas-institucionales-${date}.csv"`,
      'Cache-Control': 'no-store'
    }
  });
}
