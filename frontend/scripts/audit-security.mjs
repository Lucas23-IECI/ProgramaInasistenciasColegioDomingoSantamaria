import { spawnSync } from 'node:child_process';
import { parseSecurityAuditReport } from './security-audit-report.mjs';

const auditCommand = process.platform === 'win32'
  ? [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm audit --offline=false --json --audit-level=high']]
  : ['npm', ['audit', '--offline=false', '--json', '--audit-level=high']];
const audit = spawnSync(auditCommand[0], auditCommand[1], {
  cwd: new URL('..', import.meta.url),
  encoding: 'utf8'
});
let report;
try {
  report = parseSecurityAuditReport(audit);
} catch (error) {
  console.error(audit.stderr || audit.error?.message || error.message);
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
