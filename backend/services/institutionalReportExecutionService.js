const { buildInstitutionalPdf, buildInstitutionalWorkbook } = require('./institutionalReportService');

const safeFilePart = (value) => String(value || 'reporte')
  .normalize('NFD').replace(/[\u0300-\u036f]/gu, '')
  .replace(/[^a-zA-Z0-9_-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 80) || 'reporte';

const buildReportArtifact = async (analytics, format, name = 'reporte-institucional') => {
  const normalized = String(format || 'PDF').toUpperCase();
  const base = `${safeFilePart(name)}-${analytics.periodo.from}-${analytics.periodo.to}`;
  if (normalized === 'XLSX') return {
    buffer: await buildInstitutionalWorkbook(analytics),
    fileName: `${base}.xlsx`,
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  };
  return {
    buffer: await buildInstitutionalPdf(analytics),
    fileName: `${base}.pdf`,
    mime: 'application/pdf'
  };
};

const publicReportError = (error) => {
  const message = String(error?.message || '');
  if (/período|fecha|curso|justificación|severidad/iu.test(message)) return 'El alcance configurado ya no es válido. Revisa la programación antes de reintentar.';
  if (/timeout|connect|ECONN|servicio|base de datos/iu.test(message)) return 'Los datos institucionales no estuvieron disponibles durante la ejecución. Puedes reintentar cuando el servicio esté saludable.';
  return 'No fue posible construir el archivo institucional. Revisa el estado del sistema y vuelve a intentarlo.';
};

module.exports = { buildReportArtifact, publicReportError, safeFilePart };
