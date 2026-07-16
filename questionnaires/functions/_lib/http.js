export const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  }
});

export const errorJson = (message, status = 400, code = 'REQUEST_ERROR') =>
  json({ ok: false, error: message, code }, status);

export async function readJson(request, maxBytes = 64_000) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > maxBytes) throw new Error('PAYLOAD_TOO_LARGE');

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error('PAYLOAD_TOO_LARGE');
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    throw new Error('INVALID_JSON');
  }
}

export const normalizeText = (value, maxLength = 500) =>
  String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, maxLength);

export const getClientIp = (request) =>
  request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
