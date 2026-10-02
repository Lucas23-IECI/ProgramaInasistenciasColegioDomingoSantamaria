// Real school backend against the existing disposable QA database only.
// Never print credentials, cookies, user records or chat contents.
const https = require('node:https');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const [port, caPath] = process.argv.slice(2);
const origin = `https://127.0.0.1:${port}`;
const ca = fs.readFileSync(caPath);
const checks = [];
function request(path, { method = 'GET', cookie, body, requestOrigin = origin } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const headers = { Origin: requestOrigin };
    if (cookie) headers.Cookie = cookie;
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const req = https.request(`${origin}${path}`, { method, ca, headers, timeout: 15000 }, res => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; if (raw.length > 2_000_000) res.destroy(new Error('Unexpected response size')); });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, raw, authorized: res.socket?.authorized }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Timed out')));
    req.end(data);
  });
}
function check(value, name) { assert.ok(value, name); checks.push(name); }
(async () => {
  assert.ok(process.env.LDSM_HTTPS_QA_PASSWORD, 'QA credentials must be supplied without being printed');
  let response = await request('/api/auth/me');
  check(response.status === 401, 'Unauthenticated identity endpoint rejects access');
  response = await request('/api/chat/conversaciones');
  check(response.status === 401, 'Unauthenticated chat endpoint rejects access');
  response = await request('/api/auth/login', { method: 'POST', body: { correo: 'admin@ldsm.local', password: process.env.LDSM_HTTPS_QA_PASSWORD } });
  check(response.status === 200, 'Real QA login succeeds through verified HTTPS');
  const cookies = response.headers['set-cookie'] || [];
  const session = cookies.find(cookie => cookie.startsWith('token='));
  check(session && /;\s*Secure(?:;|$)/i.test(session) && /;\s*HttpOnly(?:;|$)/i.test(session) && /;\s*SameSite=Strict(?:;|$)/i.test(session), 'Real session cookie is Secure, HttpOnly and SameSite=Strict');
  check(response.headers['access-control-allow-origin'] === origin && response.headers['access-control-allow-credentials'] === 'true', 'Real CORS allows only the configured credentialed origin');
  const cookie = session.split(';')[0];
  response = await request('/api/auth/me', { cookie });
  check(response.status === 200 && /no-store/.test(response.headers['cache-control'] || ''), 'Authenticated session survives next page request and is not cacheable');
  response = await request('/api/chat/conversaciones', { cookie });
  check(response.status === 200, 'Authenticated chat listing works through verified HTTPS');
  response = await request('/api/auth/me', { cookie, requestOrigin: 'https://attacker.invalid' });
  check(response.status === 403 && !response.headers['access-control-allow-origin'], 'Unapproved browser origin is denied by the real backend');
  response = await request('/api/auth/logout', { method: 'POST', cookie, body: {} });
  check(response.status === 200 && (response.headers['set-cookie'] || []).some(value => /^token=;/.test(value) && /;\s*Secure(?:;|$)/i.test(value)), 'Logout clears the real Secure cookie');
  response = await request('/api/auth/me');
  check(response.status === 401, 'No-cookie request after logout remains unauthenticated');
  process.stdout.write(JSON.stringify({ passed: true, count: checks.length, checks }));
})().catch(error => {
  process.stdout.write(JSON.stringify({ passed: false, count: checks.length, checks, error: error.message }));
  process.exitCode = 1;
});
