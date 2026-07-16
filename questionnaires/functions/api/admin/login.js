import { getClientIp, errorJson, json, normalizeText, readJson } from '../../_lib/http.js';
import { hashClientIp } from '../../_lib/data.js';
import { adminCookie, constantTimeEqual, createAdminSession } from '../../_lib/security.js';

const MAX_FAILURES = 5;
const BLOCK_MINUTES = 15;

export async function onRequestPost(context) {
  const { ADMIN_PASSWORD, SESSION_SECRET } = context.env;
  if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 16 || !SESSION_SECRET || SESSION_SECRET.length < 24) {
    return errorJson('La administración todavía no tiene sus secretos configurados.', 503, 'ADMIN_NOT_CONFIGURED');
  }

  const ipHash = await hashClientIp(getClientIp(context.request), SESSION_SECRET);
  const attempt = await context.env.DB.prepare('SELECT * FROM admin_login_attempts WHERE ip_hash = ?').bind(ipHash).first();
  if (attempt?.blocked_until && new Date(attempt.blocked_until).getTime() > Date.now()) {
    return errorJson('Acceso temporalmente bloqueado. Espere 15 minutos.', 429, 'LOGIN_BLOCKED');
  }

  let body;
  try {
    body = await readJson(context.request, 8_000);
  } catch {
    return errorJson('Solicitud inválida.', 400, 'INVALID_REQUEST');
  }
  const password = normalizeText(body.password, 300);

  if (!(await constantTimeEqual(password, ADMIN_PASSWORD))) {
    const failures = Number(attempt?.failed_count || 0) + 1;
    const blockedUntil = failures >= MAX_FAILURES
      ? new Date(Date.now() + BLOCK_MINUTES * 60_000).toISOString()
      : null;
    await context.env.DB.prepare(`
      INSERT INTO admin_login_attempts (ip_hash, failed_count, blocked_until, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(ip_hash) DO UPDATE SET
        failed_count = excluded.failed_count,
        blocked_until = excluded.blocked_until,
        updated_at = CURRENT_TIMESTAMP
    `).bind(ipHash, failures, blockedUntil).run();
    return errorJson('Clave incorrecta.', 401, 'INVALID_CREDENTIALS');
  }

  await context.env.DB.prepare('DELETE FROM admin_login_attempts WHERE ip_hash = ?').bind(ipHash).run();
  const session = await createAdminSession(SESSION_SECRET);
  return json({ ok: true }, 200, { 'Set-Cookie': adminCookie(session, context.request) });
}
