import { errorJson } from './http.js';
import { readCookie, verifyAdminSession } from './security.js';

export async function requireAdmin(context) {
  const secret = context.env.SESSION_SECRET;
  if (!secret || secret.length < 24) {
    return { ok: false, response: errorJson('La administración no está configurada.', 503, 'ADMIN_NOT_CONFIGURED') };
  }

  const token = readCookie(context.request, 'ldsm_admin_session');
  if (!(await verifyAdminSession(token, secret))) {
    return { ok: false, response: errorJson('Sesión administrativa no válida.', 401, 'UNAUTHORIZED') };
  }
  return { ok: true };
}
