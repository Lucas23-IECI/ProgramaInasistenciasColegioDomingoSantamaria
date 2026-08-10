const PDFDocument = require('pdfkit');
const writeExcelFile = require('write-excel-file/node');

const titleCell = (value) => ({ value, fontWeight: 'bold', backgroundColor: '#15384C', color: '#FFFFFF' });
const valueCell = (value) => ({ value: value ?? '' });

const buildInstitutionalWorkbook = async (analytics) => {
  const summaryRows = Object.entries(analytics.resumen || {}).map(([key, value]) => [valueCell(key.replaceAll('_', ' ')), valueCell(value)]);
  const alerts = (analytics.alertas || []).map((alert) => [valueCell(alert.level), valueCell(alert.title), valueCell(alert.explanation), valueCell(alert.rule)]);
  const courses = (analytics.comparacion_cursos || []).map((row) => [valueCell(row.curso), valueCell(row.ingresos), valueCell(row.atrasos), valueCell(row.porcentaje_atrasos)]);
  const workload = (analytics.carga_trabajo || []).map((row) => [valueCell(row.area), valueCell(row.casos), valueCell(row.abiertos), valueCell(row.resueltos)]);
  return writeExcelFile([
    { sheet: 'Resumen', data: [[titleCell('Métrica'), titleCell('Resultado')], ...summaryRows], columns: [{ width: 34 }, { width: 22 }] },
    { sheet: 'Alertas explicadas', data: [[titleCell('Nivel'), titleCell('Alerta'), titleCell('Explicación'), titleCell('Regla')], ...alerts], columns: [{ width: 15 }, { width: 34 }, { width: 70 }, { width: 42 }] },
    { sheet: 'Cursos', data: [[titleCell('Curso'), titleCell('Ingresos'), titleCell('Atrasos'), titleCell('% atrasos')], ...courses], columns: [{ width: 28 }, { width: 15 }, { width: 15 }, { width: 18 }] },
    { sheet: 'Carga por área', data: [[titleCell('Área'), titleCell('Casos'), titleCell('Abiertos'), titleCell('Resueltos')], ...workload], columns: [{ width: 32 }, { width: 14 }, { width: 14 }, { width: 14 }] }
  ], { fontFamily: 'Arial', fontSize: 10 }).toBuffer();
};

const streamInstitutionalPdf = (res, analytics) => {
  const doc = new PDFDocument({ size: 'A4', margin: 46, bufferPages: true });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="analitica-institucional-${analytics.periodo.from}-${analytics.periodo.to}.pdf"`);
  doc.pipe(res);
  doc.fillColor('#15384c').fontSize(10).text('Liceo Domingo Santa María · Concepción');
  doc.moveDown(0.4).fontSize(21).text('Analítica institucional');
  doc.fillColor('#5c6e79').fontSize(10).text(`Período: ${analytics.periodo.from} al ${analytics.periodo.to}`);
  doc.moveDown().fillColor('#15384c').fontSize(13).text('Resumen verificable');
  Object.entries(analytics.resumen || {}).forEach(([key, value]) => {
    doc.fillColor('#334e60').fontSize(9).text(`${key.replaceAll('_', ' ')}: ${value ?? 'Sin datos'}`);
  });
  doc.moveDown().fillColor('#15384c').fontSize(13).text('Alertas y explicación');
  if (!(analytics.alertas || []).length) doc.fillColor('#334e60').fontSize(9).text('No se activaron alertas para el período.');
  (analytics.alertas || []).forEach((alert) => {
    doc.moveDown(0.5).fillColor('#15384c').fontSize(10).text(alert.title);
    doc.fillColor('#334e60').fontSize(9).text(alert.explanation);
    doc.fillColor('#6b7f8c').fontSize(8).text(`Regla: ${alert.rule}`);
  });
  doc.addPage().fillColor('#15384c').fontSize(13).text('Comparación entre cursos');
  (analytics.comparacion_cursos || []).forEach((row) => doc.fillColor('#334e60').fontSize(9).text(`${row.curso}: ${row.atrasos} atrasos de ${row.ingresos} ingresos (${row.porcentaje_atrasos || 0}%)`));
  doc.moveDown().fillColor('#15384c').fontSize(13).text('Metodología');
  Object.values(analytics.metodologia || {}).forEach((line) => doc.fillColor('#334e60').fontSize(8).text(`• ${line}`));
  doc.end();
};

module.exports = { buildInstitutionalWorkbook, streamInstitutionalPdf };
