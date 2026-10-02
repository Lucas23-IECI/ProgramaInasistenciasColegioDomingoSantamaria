// Native Windows HTTPS acceptance fixture. No database, credentials, or sessions.
'use strict';
const http = require('node:http');
const fs = require('node:fs');

http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://fixture.invalid').pathname;
  if (pathname === '/healthz') {
    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.end('ok');
    return;
  }
  if (pathname === '/api/health/ready') {
    const failed = fs.existsSync('/fixture/control/fail-ready');
    response.writeHead(failed ? 503 : 200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: !failed, fixture: true }));
    return;
  }
  response.writeHead(404, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ fixture: true }));
}).listen(5000, '0.0.0.0');
