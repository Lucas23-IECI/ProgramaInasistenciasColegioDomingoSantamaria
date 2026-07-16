import { sha256 } from './security.js';

export async function findInvitationByToken(db, rawToken) {
  if (!rawToken || rawToken.length < 32 || rawToken.length > 200) return null;
  const tokenHash = await sha256(rawToken);
  return db.prepare(`
    SELECT i.*, r.identity_json, r.answers_json, r.progress, r.consent_at
    FROM questionnaire_invitations i
    LEFT JOIN questionnaire_responses r ON r.invitation_id = i.id
    WHERE i.token_hash = ?
  `).bind(tokenHash).first();
}

export function invitationAvailability(invitation) {
  if (!invitation) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'El enlace no existe o fue reemplazado.' };
  if (invitation.status === 'revoked') return { ok: false, status: 410, code: 'REVOKED', message: 'Esta invitación fue cancelada.' };
  if (invitation.status === 'submitted') return { ok: false, status: 409, code: 'SUBMITTED', message: 'Este cuestionario ya fue enviado.', folio: invitation.folio };
  if (new Date(invitation.expires_at).getTime() <= Date.now()) return { ok: false, status: 410, code: 'EXPIRED', message: 'El plazo de esta invitación terminó.' };
  return { ok: true };
}

export async function recordAudit(db, invitationId, eventType, detail = {}, ipHash = null) {
  await db.prepare(`
    INSERT INTO questionnaire_audit (invitation_id, event_type, event_detail, ip_hash)
    VALUES (?, ?, ?, ?)
  `).bind(invitationId || null, eventType, JSON.stringify(detail), ipHash).run();
}

export async function hashClientIp(ip, secret) {
  return sha256(`${secret || 'local'}|${ip}`);
}

export function safeJsonParse(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}
