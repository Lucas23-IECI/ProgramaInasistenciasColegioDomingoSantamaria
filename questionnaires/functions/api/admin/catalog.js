import { requireAdmin } from '../../_lib/admin.js';
import { json } from '../../_lib/http.js';
import { QUESTIONNAIRES, ROLE_OPTIONS } from '../../_lib/questionnaires.js';

export async function onRequestGet(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;
  return json({
    ok: true,
    roles: ROLE_OPTIONS.map((role) => ({
      ...role,
      questions: QUESTIONNAIRES[role.value].questions.map(({ id, label }) => ({ id, label }))
    }))
  });
}
