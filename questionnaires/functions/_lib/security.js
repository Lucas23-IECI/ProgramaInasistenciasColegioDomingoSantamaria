const encoder = new TextEncoder();

const toHex = (buffer) => [...new Uint8Array(buffer)]
  .map((byte) => byte.toString(16).padStart(2, '0'))
  .join('');

const toBase64Url = (bytes) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

export async function sha256(value) {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(String(value))));
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))));
}

export function randomToken(bytes = 32) {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return toBase64Url(buffer);
}

export function createFolio() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const suffix = [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('');
  return `LDSM-${new Date().getUTCFullYear()}-${suffix}`;
}

export async function constantTimeEqual(left, right) {
  const leftHash = await sha256(left);
  const rightHash = await sha256(right);
  let difference = 0;
  for (let index = 0; index < leftHash.length; index += 1) {
    difference |= leftHash.charCodeAt(index) ^ rightHash.charCodeAt(index);
  }
  return difference === 0;
}

export async function createAdminSession(secret, maxAgeSeconds = 8 * 60 * 60) {
  const now = Math.floor(Date.now() / 1000);
  const payload = toBase64Url(encoder.encode(JSON.stringify({ iat: now, exp: now + maxAgeSeconds })));
  return `${payload}.${await hmac(payload, secret)}`;
}

export async function verifyAdminSession(token, secret) {
  if (!token || !secret || !token.includes('.')) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature || !(await constantTimeEqual(signature, await hmac(payload, secret)))) return false;

  try {
    const rawBase64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const base64 = rawBase64.padEnd(Math.ceil(rawBase64.length / 4) * 4, '=');
    const decoded = JSON.parse(atob(base64));
    return Number(decoded.exp) > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export function readCookie(request, name) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : '';
}

export function adminCookie(value, request, maxAge = 8 * 60 * 60) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `ldsm_admin_session=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

export async function verifyTurnstile(token, secret, remoteIp) {
  if (!secret) return true;
  if (!token) return false;

  const body = new URLSearchParams({ secret, response: token, remoteip: remoteIp });
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body
  });
  if (!response.ok) return false;
  return Boolean((await response.json()).success);
}
