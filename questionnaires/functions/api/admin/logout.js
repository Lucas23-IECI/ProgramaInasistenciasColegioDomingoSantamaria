import { json } from '../../_lib/http.js';
import { adminCookie } from '../../_lib/security.js';

export function onRequestPost(context) {
  return json({ ok: true }, 200, { 'Set-Cookie': adminCookie('', context.request, 0) });
}
