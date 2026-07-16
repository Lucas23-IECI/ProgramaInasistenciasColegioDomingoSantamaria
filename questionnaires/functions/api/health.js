import { json } from '../_lib/http.js';

export async function onRequestGet(context) {
  try {
    await context.env.DB.prepare('SELECT 1 AS ok').first();
    return json({ ok: true, service: 'cuestionarios-ldsm', timestamp: new Date().toISOString() });
  } catch {
    return json({ ok: false, service: 'cuestionarios-ldsm' }, 503);
  }
}
