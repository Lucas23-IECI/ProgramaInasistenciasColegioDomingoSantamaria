'use strict';
const fs = require('node:fs');
const https = require('node:https');

const started = Date.now();
const chunks = [];
const request = https.get({
  hostname: '127.0.0.1',
  port: Number(process.argv[2]),
  path: '/api/chat/events',
  ca: fs.readFileSync(process.argv[3]),
  rejectUnauthorized: true,
  agent: false,
}, (response) => {
  const tls = { authorized: response.socket.authorized, protocol: response.socket.getProtocol(), cipher: response.socket.getCipher().name };
  response.setEncoding('utf8');
  response.on('data', (text) => chunks.push({ afterMs: Date.now() - started, text }));
  response.on('end', () => {
    const combined = chunks.map(chunk => chunk.text).join('');
    if (response.statusCode !== 200 || !tls.authorized || !combined.includes('data: first') || !combined.includes('data: final') || chunks.length < 2) {
      process.stderr.write('SSE/verified TLS integration failed.\n');
      process.exitCode = 1;
      return;
    }
    const first = chunks.find(chunk => chunk.text.includes('data: first'));
    const last = chunks.find(chunk => chunk.text.includes('data: final'));
    if (last.afterMs - first.afterMs < 700) {
      process.stderr.write('SSE was buffered until the response ended.\n');
      process.exitCode = 2;
      return;
    }
    process.stdout.write(JSON.stringify({ ...tls, chunks, durationMs: Date.now() - started }));
  });
});
request.setTimeout(10000, () => request.destroy(new Error('TLS/SSE request timeout.')));
request.on('error', (error) => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
