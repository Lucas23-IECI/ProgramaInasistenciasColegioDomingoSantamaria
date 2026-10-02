// TLS/proxy integration fixture only: no database, credentials or user records.
'use strict';
const http = require('node:http');

http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://fixture.invalid').pathname;
  if (pathname === '/api/health/ready') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: true, fixture: true }));
    return;
  }
  if (pathname === '/api/auth/login' && request.method === 'POST') {
    request.resume();
    const secure = process.env.COOKIE_SECURE === 'true';
    response.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': `ldsm_https_fixture=not-a-real-session; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`,
    });
    response.end(JSON.stringify({ fixture: true, secure, forwardedProto: request.headers['x-forwarded-proto'], allowedOrigin: process.env.CORS_ORIGIN }));
    return;
  }
  if (pathname === '/api/chat/events') {
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    response.flushHeaders();
    response.write('event: fixture\ndata: first\n\n');
    const second = setTimeout(() => response.write('event: fixture\ndata: second\n\n'), 750);
    const finish = setTimeout(() => response.end('event: fixture\ndata: final\n\n'), 1500);
    response.on('close', () => { clearTimeout(second); clearTimeout(finish); });
    return;
  }
  response.writeHead(404, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ fixture: true, error: 'Unknown test route' }));
}).listen(5000, '0.0.0.0');
