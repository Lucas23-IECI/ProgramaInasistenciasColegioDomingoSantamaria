import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

XLSX.set_fs(fs);

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, '../..');
const workbookPath = path.resolve(process.argv[2] || '');
const baseUrl = process.env.TEST_API_URL || 'http://127.0.0.1/api';

if (!process.argv[2] || !fs.existsSync(workbookPath)) {
  throw new Error('Indique la ruta de la planilla oficial que desea previsualizar.');
}

const parseEnv = (content) => Object.fromEntries(
  content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1)];
    })
);

const localEnv = parseEnv(fs.readFileSync(path.join(projectRoot, '.env'), 'utf8'));
const password = process.env.DEFAULT_USER_PASSWORD || localEnv.DEFAULT_USER_PASSWORD;
const email = process.env.TEST_ADMIN_EMAIL || 'admin@ldsm.local';

if (!password) throw new Error('No existe una contraseña local de prueba configurada.');

const requestJson = (route, { method = 'GET', body, cookie } = {}) => new Promise((resolve, reject) => {
  const payload = body ? JSON.stringify(body) : null;
  const request = http.request(`${baseUrl}${route}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      ...(cookie ? { Cookie: cookie } : {})
    }
  }, (response) => {
    let raw = '';
    response.setEncoding('utf8');
    response.on('data', (chunk) => { raw += chunk; });
    response.on('end', () => {
      const data = raw ? JSON.parse(raw) : {};
      if (response.statusCode < 200 || response.statusCode >= 300) {
        reject(new Error(`${method} ${route}: HTTP ${response.statusCode} (${data.message || 'sin detalle'}).`));
        return;
      }
      resolve({
        data,
        cookie: response.headers['set-cookie']?.map((value) => value.split(';')[0]).join('; ')
      });
    });
  });
  request.on('error', reject);
  if (payload) request.write(payload);
  request.end();
});

const workbook = XLSX.readFile(workbookPath, { cellDates: false });
const sheetName = workbook.SheetNames.find((name) => name.trim().toLowerCase() === 'usuarios');
if (!sheetName) throw new Error('La planilla no contiene la hoja oficial `Usuarios`.');

const students = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
  defval: '',
  raw: false
});
if (students.length !== 392) {
  throw new Error(`La hoja oficial contiene ${students.length} filas; se esperaban 392.`);
}

const login = await requestJson('/auth/login', {
  method: 'POST',
  body: { correo: email, password }
});
if (!login.cookie) throw new Error('El acceso de prueba no entregó una sesión.');

const preview = await requestJson('/students/import-preview', {
  method: 'POST',
  cookie: login.cookie,
  body: {
    import_mode: 'PARCIAL',
    students
  }
});
const summary = preview.data.summary || {};

if (
  Number(summary.total) !== 392
  || Number(summary.valid) !== 392
  || Number(summary.rejected) !== 0
  || Number(summary.unknown) !== 0
  || Number(summary.suggested) !== 0
) {
  throw new Error(
    `Regresión ERP: total=${summary.total}, preparadas=${summary.valid}, rechazadas=${summary.rejected}, `
    + `cursos desconocidos=${summary.unknown}, equivalencias=${summary.suggested}.`
  );
}

console.log(
  `Previsualización oficial verificada: ${summary.valid} preparadas, ${summary.rejected} rechazadas, `
  + `${summary.without_course || 0} sin curso y ninguna importación confirmada.`
);
