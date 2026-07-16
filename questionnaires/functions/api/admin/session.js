import { requireAdmin } from '../../_lib/admin.js';
import { json } from '../../_lib/http.js';

export async function onRequestGet(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;
  return json({ ok: true, authenticated: true });
}
