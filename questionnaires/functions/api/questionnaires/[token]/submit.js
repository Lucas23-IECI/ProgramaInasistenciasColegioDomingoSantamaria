import { findInvitationByToken, hashClientIp, invitationAvailability, recordAudit } from '../../../_lib/data.js';
import { errorJson, getClientIp, json, readJson } from '../../../_lib/http.js';
import { createFolio, verifyTurnstile } from '../../../_lib/security.js';
import { sanitizeAnswers, sanitizeIdentity, validateAnswers, validateIdentity } from '../../../_lib/validation.js';

export async function onRequestPost(context) {
  const invitation = await findInvitationByToken(context.env.DB, context.params.token);
  const availability = invitationAvailability(invitation);
  if (!availability.ok) {
    if (availability.code === 'SUBMITTED') return json({ ok: true, alreadySubmitted: true, folio: invitation.folio });
    return errorJson(availability.message, availability.status, availability.code);
  }

  let body;
  try {
    body = await readJson(context.request);
  } catch (error) {
    return errorJson(error.message === 'PAYLOAD_TOO_LARGE' ? 'La respuesta supera el tamaño permitido.' : 'Solicitud inválida.', 400, error.message);
  }

  if (body.consent !== true) return errorJson('Debe confirmar la revisión antes de enviar.', 422, 'CONSENT_REQUIRED');

  const ip = getClientIp(context.request);
  const turnstileValid = await verifyTurnstile(body.turnstileToken, context.env.TURNSTILE_SECRET, ip);
  if (!turnstileValid) return errorJson('No fue posible validar el envío. Intente nuevamente.', 422, 'TURNSTILE_FAILED');

  const identity = sanitizeIdentity(body.identity, invitation);
  const answers = sanitizeAnswers(invitation.role, body.answers);
  const errors = {
    ...validateIdentity(identity, { final: true }),
    ...validateAnswers(invitation.role, answers, { final: true })
  };
  if (Object.keys(errors).length) return json({ ok: false, errors }, 422);

  const folio = createFolio();
  const submittedAt = new Date().toISOString();
  const statements = [
    context.env.DB.prepare(`
      INSERT INTO questionnaire_responses (invitation_id, identity_json, answers_json, progress, consent_at, submitted_at, updated_at)
      VALUES (?, ?, ?, 100, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(invitation_id) DO UPDATE SET
        identity_json = excluded.identity_json,
        answers_json = excluded.answers_json,
        progress = 100,
        consent_at = excluded.consent_at,
        submitted_at = excluded.submitted_at,
        updated_at = CURRENT_TIMESTAMP
    `).bind(invitation.id, JSON.stringify(identity), JSON.stringify(answers), submittedAt, submittedAt),
    context.env.DB.prepare(`
      UPDATE questionnaire_invitations
      SET status = 'submitted', submitted_at = ?, folio = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status IN ('invited', 'opened', 'draft')
    `).bind(submittedAt, folio, invitation.id)
  ];

  await context.env.DB.batch(statements);
  const ipHash = await hashClientIp(ip, context.env.SESSION_SECRET);
  await recordAudit(context.env.DB, invitation.id, 'questionnaire_submitted', { folio }, ipHash);

  return json({ ok: true, folio, submittedAt });
}
