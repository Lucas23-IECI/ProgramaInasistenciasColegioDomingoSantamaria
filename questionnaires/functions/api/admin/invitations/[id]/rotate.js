import { requireAdmin } from '../../../../_lib/admin.js';
import { recordAudit } from '../../../../_lib/data.js';
import { errorJson, json } from '../../../../_lib/http.js';
import { randomToken, sha256 } from '../../../../_lib/security.js';

export async function onRequestPost(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;

  const id = Number(context.params.id);
  const invitation = await context.env.DB.prepare('SELECT * FROM questionnaire_invitations WHERE id = ?').bind(id).first();
  if (!invitation) return errorJson('Invitación no encontrada.', 404, 'NOT_FOUND');
  if (invitation.status === 'submitted') return errorJson('La respuesta ya fue enviada.', 409, 'ALREADY_SUBMITTED');

  const token = randomToken();
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  await context.env.DB.batch([
    context.env.DB.prepare(`
      UPDATE questionnaire_invitations
      SET token_hash = ?, status = 'invited', expires_at = ?, opened_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(tokenHash, expiresAt, id),
    context.env.DB.prepare('DELETE FROM questionnaire_responses WHERE invitation_id = ?').bind(id)
  ]);
  await recordAudit(context.env.DB, id, 'invitation_rotated', { expiresAt });

  const origin = (context.env.PUBLIC_BASE_URL || new URL(context.request.url).origin).replace(/\/$/, '');
  return json({ ok: true, url: `${origin}/responder/${token}`, expiresAt });
}
