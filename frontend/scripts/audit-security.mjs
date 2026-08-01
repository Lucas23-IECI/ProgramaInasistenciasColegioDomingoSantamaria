import { spawnSync } from 'node:child_process';

const auditCommand = process.platform === 'win32'
  ? [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm audit --json --audit-level=high']]
  : ['npm', ['audit', '--json', '--audit-level=high']];
const audit = spawnSync(auditCommand[0], auditCommand[1], {
  cwd: new URL('..', import.meta.url),
  encoding: 'utf8'
});
const report = JSON.parse(audit.stdout || '{}');
if (report.auditReportVersion !== 2 || !report.vulnerabilities) {
  console.error(audit.stderr || audit.error?.message || 'npm audit no entregó un informe válido.');
  process.exit(1);
}
const vulnerabilities = report.vulnerabilities || {};
const blockingSeverities = new Set(['high', 'critical']);
const blocking = Object.entries(vulnerabilities)
  .filter(([, detail]) => blockingSeverities.has(detail.severity));

if (blocking.length) {
  for (const [name, detail] of blocking) {
    console.error(`${name}: vulnerabilidad ${detail.severity} sin resolver.`);
  }
  process.exit(1);
}

console.log('Auditoría aprobada: no hay vulnerabilidades altas ni críticas.');
