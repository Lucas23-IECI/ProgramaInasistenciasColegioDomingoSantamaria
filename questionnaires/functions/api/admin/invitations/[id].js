import { requireAdmin } from '../../../_lib/admin.js';
import { recordAudit } from '../../../_lib/data.js';
import { errorJson, json } from '../../../_lib/http.js';

export async function onRequestDelete(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;

  const id = Number(context.params.id);
  if (!Number.isInteger(id) || id < 1) return errorJson('Invitación inválida.', 400, 'INVALID_ID');
  const invitation = await context.env.DB.prepare('SELECT status FROM questionnaire_invitations WHERE id = ?').bind(id).first();
  if (!invitation) return errorJson('Invitación no encontrada.', 404, 'NOT_FOUND');
  if (invitation.status === 'submitted') return errorJson('Una respuesta enviada no puede revocarse.', 409, 'ALREADY_SUBMITTED');

  await context.env.DB.prepare(`
    UPDATE questionnaire_invitations SET status = 'revoked', updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).bind(id).run();
  await recordAudit(context.env.DB, id, 'invitation_revoked');
  return json({ ok: true });
}
