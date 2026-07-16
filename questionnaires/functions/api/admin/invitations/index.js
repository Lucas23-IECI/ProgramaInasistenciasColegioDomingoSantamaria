import { requireAdmin } from '../../../_lib/admin.js';
import { recordAudit, safeJsonParse } from '../../../_lib/data.js';
import { errorJson, json, normalizeText, readJson } from '../../../_lib/http.js';
import { getQuestionnaire } from '../../../_lib/questionnaires.js';
import { randomToken, sha256 } from '../../../_lib/security.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function onRequestGet(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;

  await context.env.DB.prepare(`
    UPDATE questionnaire_invitations SET status = 'expired', updated_at = CURRENT_TIMESTAMP
    WHERE status IN ('invited', 'opened', 'draft') AND datetime(expires_at) <= datetime('now')
  `).run();

  const result = await context.env.DB.prepare(`
    SELECT i.*, r.identity_json, r.answers_json, r.progress, r.consent_at, r.updated_at AS response_updated_at
    FROM questionnaire_invitations i
    LEFT JOIN questionnaire_responses r ON r.invitation_id = i.id
    ORDER BY i.created_at DESC, i.id DESC
  `).all();

  const invitations = (result.results || []).map((item) => ({
    id: item.id,
    role: item.role,
    roleLabel: getQuestionnaire(item.role)?.label || item.role,
    respondentName: item.respondent_name,
    respondentEmail: item.respondent_email,
    status: item.status,
    expiresAt: item.expires_at,
    openedAt: item.opened_at,
    submittedAt: item.submitted_at,
    folio: item.folio,
    createdAt: item.created_at,
    progress: item.progress || 0,
    identity: safeJsonParse(item.identity_json),
    answers: safeJsonParse(item.answers_json)
  }));
  return json({ ok: true, invitations });
}

export async function onRequestPost(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;

  let body;
  try {
    body = await readJson(context.request, 12_000);
  } catch {
    return errorJson('Solicitud inválida.', 400, 'INVALID_REQUEST');
  }

  const role = normalizeText(body.role, 80);
  const respondentName = normalizeText(body.respondentName, 140);
  const respondentEmail = normalizeText(body.respondentEmail, 180).toLowerCase();
  const expiresInDays = Math.min(60, Math.max(1, Number(body.expiresInDays) || 14));

  if (!getQuestionnaire(role)) return errorJson('Seleccione un cargo válido.', 422, 'INVALID_ROLE');
  if (respondentName.length < 5) return errorJson('Ingrese el nombre completo.', 422, 'INVALID_NAME');
  if (respondentEmail && !EMAIL_PATTERN.test(respondentEmail)) return errorJson('Ingrese un correo válido.', 422, 'INVALID_EMAIL');

  const token = randomToken();
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
  const result = await context.env.DB.prepare(`
    INSERT INTO questionnaire_invitations (role, respondent_name, respondent_email, token_hash, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(role, respondentName, respondentEmail, tokenHash, expiresAt).run();

  const invitationId = result.meta.last_row_id;
  await recordAudit(context.env.DB, invitationId, 'invitation_created', { role, respondentName, expiresAt });
  const origin = (context.env.PUBLIC_BASE_URL || new URL(context.request.url).origin).replace(/\/$/, '');
  return json({
    ok: true,
    invitation: {
      id: invitationId,
      role,
      respondentName,
      respondentEmail,
      expiresAt,
      url: `${origin}/responder/${token}`
    }
  }, 201);
}
