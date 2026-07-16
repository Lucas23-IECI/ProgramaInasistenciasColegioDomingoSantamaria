import { findInvitationByToken, hashClientIp, invitationAvailability, recordAudit, safeJsonParse } from '../../_lib/data.js';
import { errorJson, getClientIp, json, readJson } from '../../_lib/http.js';
import { getQuestionnaire } from '../../_lib/questionnaires.js';
import { calculateProgress, sanitizeAnswers, sanitizeIdentity, validateAnswers, validateIdentity } from '../../_lib/validation.js';

export async function onRequestGet(context) {
  const invitation = await findInvitationByToken(context.env.DB, context.params.token);
  const availability = invitationAvailability(invitation);
  if (!availability.ok) {
    if (availability.code === 'SUBMITTED') {
      return json({ ok: false, error: availability.message, code: availability.code, folio: invitation.folio }, availability.status);
    }
    return errorJson(availability.message, availability.status, availability.code);
  }

  const questionnaire = getQuestionnaire(invitation.role);
  if (!questionnaire) return errorJson('El cuestionario asignado ya no está disponible.', 500, 'INVALID_ROLE');

  if (invitation.status === 'invited') {
    await context.env.DB.prepare(`
      UPDATE questionnaire_invitations
      SET status = 'opened', opened_at = COALESCE(opened_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'invited'
    `).bind(invitation.id).run();
    const ipHash = await hashClientIp(getClientIp(context.request), context.env.SESSION_SECRET);
    await recordAudit(context.env.DB, invitation.id, 'invitation_opened', {}, ipHash);
  }

  return json({
    ok: true,
    invitation: {
      respondentName: invitation.respondent_name,
      respondentEmail: invitation.respondent_email,
      status: invitation.status === 'invited' ? 'opened' : invitation.status,
      expiresAt: invitation.expires_at,
      role: invitation.role
    },
    questionnaire,
    draft: {
      identity: safeJsonParse(invitation.identity_json),
      answers: safeJsonParse(invitation.answers_json),
      progress: invitation.progress || 0
    }
  });
}

export async function onRequestPut(context) {
  const invitation = await findInvitationByToken(context.env.DB, context.params.token);
  const availability = invitationAvailability(invitation);
  if (!availability.ok) return errorJson(availability.message, availability.status, availability.code);

  let body;
  try {
    body = await readJson(context.request);
  } catch (error) {
    return errorJson(error.message === 'PAYLOAD_TOO_LARGE' ? 'La respuesta supera el tamaño permitido.' : 'Solicitud inválida.', 400, error.message);
  }

  const identity = sanitizeIdentity(body.identity, invitation);
  const answers = sanitizeAnswers(invitation.role, body.answers);
  const errors = { ...validateIdentity(identity), ...validateAnswers(invitation.role, answers) };
  if (Object.keys(errors).length) return json({ ok: false, errors }, 422);

  const progress = calculateProgress(invitation.role, identity, answers);
  await context.env.DB.prepare(`
    INSERT INTO questionnaire_responses (invitation_id, identity_json, answers_json, progress, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(invitation_id) DO UPDATE SET
      identity_json = excluded.identity_json,
      answers_json = excluded.answers_json,
      progress = excluded.progress,
      updated_at = CURRENT_TIMESTAMP
  `).bind(invitation.id, JSON.stringify(identity), JSON.stringify(answers), progress).run();
  await context.env.DB.prepare(`
    UPDATE questionnaire_invitations SET status = 'draft', updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status IN ('invited', 'opened', 'draft')
  `).bind(invitation.id).run();

  return json({ ok: true, savedAt: new Date().toISOString(), progress });
}
