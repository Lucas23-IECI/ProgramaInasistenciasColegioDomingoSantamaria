export const parseSecurityAuditReport = (audit) => {
  const report = JSON.parse(audit.stdout || '{}');
  if (audit.error || audit.signal || report.error || report.auditReportVersion !== 2
    || !report.vulnerabilities || !report.metadata?.vulnerabilities
    || ![0, 1].includes(audit.status)) {
    throw new Error('npm audit no entregó un informe válido.');
  }
  return report;
};
