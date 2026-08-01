const PDFDocument = require('pdfkit');
const writeExcelFile = require('write-excel-file/node');

const reportDate = (value) => new Intl.DateTimeFormat('es-CL', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Santiago'
}).format(new Date(value));

const escapeMarkdown = (value) => String(value ?? '')
  .replace(/\|/g, '\\|')
  .replace(/\r?\n/g, ' ');

const excelHeaderCell = (value) => ({
  value,
  fontWeight: 'bold',
  textColor: '#ffffff',
  backgroundColor: '#17698f',
  borderColor: '#17698f',
  borderStyle: 'thin',
  alignVertical: 'center',
  height: 27,
  wrap: true
});

const excelDataCell = (value, rowIndex, options = {}) => ({
  value: value ?? '',
  backgroundColor: rowIndex % 2 === 0 ? '#f3f6f7' : '#ffffff',
  textColor: options.emphasis ? '#15384c' : '#405662',
  fontWeight: options.emphasis ? 'bold' : undefined,
  borderColor: '#d4dee3',
  bottomBorderStyle: 'thin',
  alignVertical: 'center',
  height: 24,
  wrap: true
});

const buildVisitsWorkbook = async (report) => {
  const title = (value, size) => ({
    value,
    columnSpan: 4,
    fontWeight: 'bold',
    fontSize: size,
    textColor: '#15384c',
    height: size === 18 ? 30 : 24
  });
  const metric = (label, value) => [
    {
      value: label,
      fontWeight: 'bold',
      textColor: '#5c6e79',
      backgroundColor: '#f3f6f7',
      borderColor: '#d4dee3',
      borderStyle: 'thin',
      height: 28
    },
    {
      value,
      type: Number,
      fontWeight: 'bold',
      fontSize: 16,
      textColor: '#15384c',
      backgroundColor: '#f3f6f7',
      borderColor: '#d4dee3',
      borderStyle: 'thin',
      align: 'right'
    }
  ];
  const summaryData = [
    [title('Liceo Domingo Santa María · Concepción', 11), null, null, null],
    [title('Reporte de visitas y retiros', 18), null, null, null],
    [{
      value: `Período: ${report.periodo.desde} al ${report.periodo.hasta}`,
      columnSpan: 4,
      textColor: '#5c6e79',
      height: 23
    }, null, null, null],
    [null, null, null, null],
    [...metric('Visitas', report.resumen.visitas), ...metric('Personas dentro', report.resumen.personas_dentro)],
    [...metric('Retiros', report.resumen.retiros), ...metric('Retiros pendientes', report.resumen.retiros_pendientes)],
    [...metric('Retiros entregados', report.resumen.retiros_entregados), null, null]
  ];
  const visitHeaders = ['Ingreso', 'Salida', 'Estado', 'Visitante', 'Documento', 'Motivo', 'Destino', 'Persona contactada'];
  const visitsData = [
    visitHeaders.map(excelHeaderCell),
    ...report.visitas.map((visit, rowIndex) => [
      reportDate(visit.ingreso_en),
      visit.salida_en ? reportDate(visit.salida_en) : '—',
      visit.estado,
      visit.visitante.nombre_completo,
      visit.visitante.documento_mostrado,
      visit.motivo_nombre,
      visit.destino_nombre,
      visit.persona_contactada || ''
    ].map((value, columnIndex) => excelDataCell(value, rowIndex, { emphasis: columnIndex === 3 })))
  ];
  const withdrawalHeaders = ['Solicitud', 'Estudiante', 'Curso', 'Persona que retira', 'Documento', 'Relación', 'Motivo', 'Detalle', 'Estado'];
  const withdrawalsData = [
    withdrawalHeaders.map(excelHeaderCell),
    ...report.retiros.map((withdrawal, rowIndex) => [
      reportDate(withdrawal.solicitado_en),
      [withdrawal.estudiante.nombres, withdrawal.estudiante.paterno, withdrawal.estudiante.materno].filter(Boolean).join(' '),
      withdrawal.estudiante.nombre_curso || '',
      withdrawal.visitante.nombre_completo,
      withdrawal.visitante.documento_mostrado,
      withdrawal.parentesco_declarado_nombre,
      withdrawal.motivo_nombre,
      withdrawal.motivo_detalle || '',
      withdrawal.estado
    ].map((value, columnIndex) => excelDataCell(value, rowIndex, { emphasis: columnIndex === 1 })))
  ];

  return writeExcelFile([
    {
      data: summaryData,
      sheet: 'Resumen',
      columns: [{ width: 24 }, { width: 15 }, { width: 24 }, { width: 15 }],
      showGridLines: false,
      zoomScale: 1.1
    },
    {
      data: visitsData,
      sheet: 'Visitas',
      columns: [20, 20, 15, 30, 18, 28, 28, 30].map((width) => ({ width })),
      stickyRowsCount: 1,
      showGridLines: false,
      orientation: 'landscape',
      zoomScale: 0.9
    },
    {
      data: withdrawalsData,
      sheet: 'Retiros',
      columns: [20, 32, 18, 30, 18, 24, 28, 40, 17].map((width) => ({ width })),
      stickyRowsCount: 1,
      showGridLines: false,
      orientation: 'landscape',
      zoomScale: 0.85
    }
  ], {
    fontFamily: 'Arial',
    fontSize: 10
  }).toBuffer();
};

const streamVisitsPdf = (res, report) => {
  const doc = new PDFDocument({ size: 'A4', margin: 46, bufferPages: true });
  const fileName = `reporte-visitas-retiros-${report.periodo.desde}-${report.periodo.hasta}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  doc.pipe(res);

  const colors = {
    navy: '#15384c',
    blue: '#17698f',
    muted: '#5c6e79',
    border: '#d4dee3',
    light: '#f3f6f7'
  };
  const ensureSpace = (height = 64) => {
    if (doc.y + height > doc.page.height - 50) doc.addPage();
  };
  const sectionTitle = (title, subtitle) => {
    ensureSpace(54);
    doc.moveDown(0.5)
      .font('Helvetica-Bold').fontSize(13).fillColor(colors.navy).text(title);
    if (subtitle) {
      doc.font('Helvetica').fontSize(8.5).fillColor(colors.muted).text(subtitle);
    }
    doc.moveDown(0.5);
  };
  const row = (columns) => {
    ensureSpace(42);
    const y = doc.y;
    doc.roundedRect(46, y, 503, 34, 3).fill(colors.light);
    const widths = [112, 138, 112, 141];
    let x = 54;
    columns.slice(0, 4).forEach((value, index) => {
      doc.font(index === 0 ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(7.4)
        .fillColor(index === 0 ? colors.navy : colors.muted)
        .text(String(value || '—'), x, y + 8, { width: widths[index] - 8, height: 20, ellipsis: true });
      x += widths[index];
    });
    doc.y = y + 40;
  };

  doc.font('Helvetica-Bold').fontSize(10).fillColor(colors.blue)
    .text('LICEO DOMINGO SANTA MARÍA · CONCEPCIÓN');
  doc.moveDown(0.35).fontSize(22).fillColor(colors.navy)
    .text('Reporte de visitas y retiros');
  doc.font('Helvetica').fontSize(9).fillColor(colors.muted)
    .text(`Período: ${report.periodo.desde} al ${report.periodo.hasta} · Generado: ${reportDate(report.generado_en)}`);
  doc.moveDown(1);

  const metrics = [
    ['Visitas', report.resumen.visitas],
    ['Dentro', report.resumen.personas_dentro],
    ['Retiros', report.resumen.retiros],
    ['Entregados', report.resumen.retiros_entregados]
  ];
  const startY = doc.y;
  metrics.forEach(([label, value], index) => {
    const x = 46 + index * 126;
    doc.roundedRect(x, startY, 116, 56, 4).strokeColor(colors.border).stroke();
    doc.font('Helvetica-Bold').fontSize(18).fillColor(colors.navy).text(String(value), x + 10, startY + 10);
    doc.font('Helvetica').fontSize(7.5).fillColor(colors.muted).text(label.toUpperCase(), x + 10, startY + 35);
  });
  doc.y = startY + 68;

  if (report.visitas.length) {
    sectionTitle('Visitas', `${report.visitas.length} movimientos en el período`);
    report.visitas.forEach((visit) => row([
      visit.visitante.nombre_completo,
      `${visit.destino_nombre} · ${visit.motivo_nombre}`,
      reportDate(visit.ingreso_en),
      visit.estado
    ]));
  }

  if (report.retiros.length) {
    ensureSpace(54 + Math.min(report.retiros.length, 7) * 40);
    sectionTitle('Retiros de estudiantes', `${report.retiros.length} solicitudes en el período`);
    report.retiros.forEach((withdrawal) => row([
      [withdrawal.estudiante.nombres, withdrawal.estudiante.paterno].filter(Boolean).join(' '),
      withdrawal.visitante.nombre_completo,
      withdrawal.motivo_nombre,
      withdrawal.estado
    ]));
  }

  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    doc.font('Helvetica').fontSize(7).fillColor(colors.muted)
      .text(
        `Documento institucional · Página ${index + 1} de ${range.count}`,
        46,
        doc.page.height - 35,
        { width: 503, height: 10, align: 'right', lineBreak: false }
      );
  }
  doc.end();
};

const buildVisitsMarkdown = (report) => [
  '# Reporte de visitas y retiros',
  '',
  `Período: ${report.periodo.desde} al ${report.periodo.hasta}`,
  '',
  `Visitas: ${report.resumen.visitas}`,
  `Personas dentro: ${report.resumen.personas_dentro}`,
  `Retiros: ${report.resumen.retiros}`,
  `Retiros pendientes: ${report.resumen.retiros_pendientes}`,
  `Retiros entregados: ${report.resumen.retiros_entregados}`,
  '',
  '## Visitas',
  '',
  '| Ingreso | Visitante | Documento | Motivo | Destino | Estado |',
  '| --- | --- | --- | --- | --- | --- |',
  ...report.visitas.map((visit) => `| ${escapeMarkdown(reportDate(visit.ingreso_en))} | ${escapeMarkdown(visit.visitante.nombre_completo)} | ${escapeMarkdown(visit.visitante.documento_mostrado)} | ${escapeMarkdown(visit.motivo_nombre)} | ${escapeMarkdown(visit.destino_nombre)} | ${escapeMarkdown(visit.estado)} |`),
  '',
  '## Retiros',
  '',
  '| Solicitud | Estudiante | Persona que retira | Relación | Motivo | Estado |',
  '| --- | --- | --- | --- | --- | --- |',
  ...report.retiros.map((withdrawal) => `| ${escapeMarkdown(reportDate(withdrawal.solicitado_en))} | ${escapeMarkdown([withdrawal.estudiante.nombres, withdrawal.estudiante.paterno, withdrawal.estudiante.materno].filter(Boolean).join(' '))} | ${escapeMarkdown(withdrawal.visitante.nombre_completo)} | ${escapeMarkdown(withdrawal.parentesco_declarado_nombre)} | ${escapeMarkdown(withdrawal.motivo_nombre)} | ${escapeMarkdown(withdrawal.estado)} |`)
].join('\n');

module.exports = {
  buildVisitsMarkdown,
  buildVisitsWorkbook,
  reportDate,
  streamVisitsPdf
};
