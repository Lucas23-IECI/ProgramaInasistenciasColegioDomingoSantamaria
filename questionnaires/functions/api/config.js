import { json } from '../_lib/http.js';

export function onRequestGet(context) {
  return json({
    ok: true,
    turnstileSiteKey: context.env.TURNSTILE_SITE_KEY || '',
    institution: 'Liceo Domingo Santa María',
    surveyTitle: 'Levantamiento institucional de asistencia'
  });
}
