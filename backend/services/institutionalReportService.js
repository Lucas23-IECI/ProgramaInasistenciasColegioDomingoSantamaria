const PDFDocument = require('pdfkit');
const writeExcelFile = require('write-excel-file/node');

const COLORS = {
  navy: '#15384C', blue: '#2678A5', ink: '#213B4B', muted: '#5C6E79',
  line: '#D5E0E6', pale: '#EEF4F7', white: '#FFFFFF'
};
const PAGE = { left: 46, right: 46, top: 46, bottom: 50 };

const titleCell = (value) => ({ value, fontWeight: 'bold', backgroundColor: '#15384C', color: '#FFFFFF' });
const valueCell = (value) => ({ value: value ?? '' });
const label = (value) => String(value || '').replaceAll('_', ' ').replace(/\b\w/gu, (character) => character.toUpperCase());
const number = (value) => value === null || value === undefined || value === '' ? 'Sin datos' : new Intl.NumberFormat('es-CL').format(Number(value));
const percent = (value) => value === null || value === undefined || value === '' ? 'Sin datos' : `${Number(value).toLocaleString('es-CL', { maximumFractionDigits: 1 })}%`;
const shortDate = (value) => {
  const parsed = /^\d{4}-\d{2}-\d{2}$/u.test(String(value || '')) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value || '') : new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(parsed).replace('.', '');
};
const chartDate = (value) => {
  const parsed = /^\d{4}-\d{2}-\d{2}$/u.test(String(value || '')) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value || '') : new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(parsed).replace('.', '');
};
const dateTime = (value) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Sin fecha' : new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Santiago' }).format(parsed);
};

const punctualityScope = (analytics) => {
  const filters = analytics.filtros || {};
  return [
    filters.curso || 'Toda la institución',
    filters.justificado === true ? 'Solo atrasos justificados' : filters.justificado === false ? 'Solo atrasos sin justificar' : 'Cualquier justificación',
    filters.severidad ? `Severidad ${String(filters.severidad).toLowerCase()}` : 'Cualquier severidad'
  ].join(' | ');
};

const operationScope = (analytics) => analytics.filtros?.operacion_institucional
  || 'Visitas, retiros y Convivencia se agregan para toda la institución dentro del período seleccionado.';

const buildInstitutionalWorkbook = async (analytics) => {
  const scopeRows = [
    [valueCell('Período analizado'), valueCell(`${shortDate(analytics.periodo.from)} al ${shortDate(analytics.periodo.to)}`)],
    [valueCell('Alcance de puntualidad'), valueCell(punctualityScope(analytics))],
    [valueCell('Alcance de operación'), valueCell(operationScope(analytics))]
  ];
  const summaryRows = Object.entries(analytics.resumen || {}).map(([key, value]) => [valueCell(label(key)), valueCell(value)]);
  const alerts = (analytics.alertas || []).map((alert) => [valueCell(alert.level), valueCell(alert.title), valueCell(alert.explanation), valueCell(alert.rule)]);
  const courses = (analytics.comparacion_cursos || []).map((row) => [valueCell(row.curso), valueCell(row.ingresos), valueCell(row.atrasos), valueCell(row.porcentaje_atrasos)]);
  const workload = (analytics.carga_trabajo || []).map((row) => [valueCell(row.area), valueCell(row.casos), valueCell(row.abiertos), valueCell(row.resueltos)]);
  return writeExcelFile([
    { sheet: 'Resumen', data: [[titleCell('Métrica'), titleCell('Resultado')], ...scopeRows, ...summaryRows], columns: [{ width: 34 }, { width: 68 }] },
    { sheet: 'Alertas explicadas', data: [[titleCell('Nivel'), titleCell('Alerta'), titleCell('Explicación'), titleCell('Regla')], ...alerts], columns: [{ width: 15 }, { width: 34 }, { width: 70 }, { width: 42 }] },
    { sheet: 'Cursos', data: [[titleCell('Curso'), titleCell('Ingresos'), titleCell('Atrasos'), titleCell('% atrasos')], ...courses], columns: [{ width: 28 }, { width: 15 }, { width: 15 }, { width: 18 }] },
    { sheet: 'Carga por área', data: [[titleCell('Área'), titleCell('Casos'), titleCell('Abiertos'), titleCell('Resueltos')], ...workload], columns: [{ width: 32 }, { width: 14 }, { width: 14 }, { width: 14 }] }
  ], { fontFamily: 'Arial', fontSize: 10 }).toBuffer();
};

const pageWidth = (doc) => doc.page.width - PAGE.left - PAGE.right;
const pageBottom = (doc) => doc.page.height - PAGE.bottom - 24;

const drawRunningHeader = (doc, analytics) => {
  doc.save();
  doc.fillColor(COLORS.navy).font('Helvetica-Bold').fontSize(8).text('LICEO DOMINGO SANTA MARÍA', PAGE.left, 26, { continued: true });
  doc.fillColor(COLORS.muted).font('Helvetica').text(`  |  Analítica institucional  |  ${shortDate(analytics.periodo.from)} al ${shortDate(analytics.periodo.to)}`);
  doc.moveTo(PAGE.left, 40).lineTo(doc.page.width - PAGE.right, 40).strokeColor(COLORS.line).lineWidth(0.8).stroke();
  doc.restore();
  doc.y = PAGE.top;
};

const addContentPage = (doc, analytics) => {
  doc.addPage();
  drawRunningHeader(doc, analytics);
};

const ensureSpace = (doc, analytics, required) => {
  if (doc.y + required <= pageBottom(doc)) return;
  addContentPage(doc, analytics);
};

const sectionTitle = (doc, analytics, kicker, title, description = '') => {
  // Reserve enough room for the title and the beginning of the content that
  // follows it. This avoids orphaned headings at the bottom of a page.
  ensureSpace(doc, analytics, description ? 170 : 86);
  const width = pageWidth(doc);
  doc.x = PAGE.left;
  doc.fillColor(COLORS.blue).font('Helvetica-Bold').fontSize(7.5).text(String(kicker).toUpperCase(), PAGE.left, doc.y, { width, characterSpacing: 0.8 });
  doc.moveDown(0.22).fillColor(COLORS.navy).fontSize(15).text(title, PAGE.left, doc.y, { width });
  if (description) doc.moveDown(0.18).fillColor(COLORS.muted).font('Helvetica').fontSize(8.5).text(description, PAGE.left, doc.y, { width, lineGap: 1.5 });
  doc.moveDown(0.7);
};

const drawKpis = (doc, analytics) => {
  const summary = analytics.resumen || {};
  const cases = analytics.convivencia || {};
  const items = [
    ['Ingresos registrados', number(summary.ingresos)],
    ['Atrasos registrados', number(summary.atrasos)],
    ['Tasa de atrasos', percent(summary.tasa_atrasos)],
    ['Casos de convivencia activos', number(cases.abiertos)]
  ];
  const gap = 10;
  const cardWidth = (pageWidth(doc) - gap) / 2;
  const cardHeight = 64;
  const startY = doc.y;
  items.forEach(([title, value], index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = PAGE.left + column * (cardWidth + gap);
    const y = startY + row * (cardHeight + gap);
    doc.roundedRect(x, y, cardWidth, cardHeight, 6).fillAndStroke(COLORS.pale, COLORS.line);
    doc.fillColor(COLORS.muted).font('Helvetica-Bold').fontSize(7.5).text(title.toUpperCase(), x + 12, y + 11, { width: cardWidth - 24, characterSpacing: 0.35 });
    doc.fillColor(COLORS.navy).fontSize(21).text(String(value), x + 12, y + 29, { width: cardWidth - 24 });
  });
  doc.y = startY + cardHeight * 2 + gap + 13;
};

const drawTrendChart = (doc, analytics) => {
  const rows = analytics.tendencia_diaria || [];
  if (!rows.length) {
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9).text('No existen ingresos registrados para construir la evolución diaria.');
    doc.moveDown();
    return;
  }
  ensureSpace(doc, analytics, 205);
  const x = PAGE.left + 28;
  const y = doc.y + 8;
  const width = pageWidth(doc) - 42;
  const height = 145;
  const max = Math.max(1, ...rows.map((item) => Number(item.atrasos)));
  [0, 0.25, 0.5, 0.75, 1].forEach((ratio) => {
    const lineY = y + height * ratio;
    doc.moveTo(x, lineY).lineTo(x + width, lineY).strokeColor(COLORS.line).lineWidth(0.6).stroke();
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(7).text(String(Math.round(max * (1 - ratio))), PAGE.left, lineY - 4, { width: 22, align: 'right' });
  });
  const points = rows.map((item, index) => ({
    x: x + (rows.length === 1 ? width / 2 : index * width / (rows.length - 1)),
    y: y + height - (Number(item.atrasos) / max) * height,
    item
  }));
  doc.save().lineJoin('round').lineCap('round').strokeColor(COLORS.blue).lineWidth(2.2);
  points.forEach((point, index) => index ? doc.lineTo(point.x, point.y) : doc.moveTo(point.x, point.y));
  doc.stroke().restore();
  const labelStep = Math.max(1, Math.ceil(rows.length / 7));
  points.forEach((point, index) => {
    doc.circle(point.x, point.y, 3.2).fillAndStroke(COLORS.white, COLORS.blue);
    if (Number(point.item.atrasos) > 0) doc.fillColor(COLORS.navy).font('Helvetica-Bold').fontSize(7).text(String(point.item.atrasos), point.x - 10, Math.max(y - 2, point.y - 15), { width: 20, align: 'center' });
    const distanceToEnd = points.length - 1 - index;
    const showDate = index === 0 || index === points.length - 1 || (index % labelStep === 0 && distanceToEnd >= labelStep);
    if (showDate) doc.fillColor(COLORS.muted).font('Helvetica').fontSize(6.8).text(chartDate(point.item.fecha), point.x - 24, y + height + 8, { width: 48, align: 'center' });
  });
  doc.x = PAGE.left;
  doc.y = y + height + 34;
};

const rowHeight = (doc, row, columns) => Math.max(24, ...row.map((cell, index) => doc.font('Helvetica').fontSize(7.6).heightOfString(String(cell ?? 'Sin datos'), { width: columns[index].width - 12, lineGap: 1 }) + 12));

const drawTable = (doc, analytics, columns, rows, emptyMessage = 'No hay información para este período.') => {
  if (!rows.length) {
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8.5).text(emptyMessage);
    doc.moveDown();
    return;
  }
  const drawHeader = () => {
    const y = doc.y;
    let x = PAGE.left;
    columns.forEach((column) => {
      doc.rect(x, y, column.width, 24).fill(COLORS.navy);
      doc.fillColor(COLORS.white).font('Helvetica-Bold').fontSize(7.2).text(column.label, x + 6, y + 8, { width: column.width - 12 });
      x += column.width;
    });
    doc.y = y + 24;
  };
  ensureSpace(doc, analytics, 54);
  drawHeader();
  rows.forEach((row, rowIndex) => {
    const height = rowHeight(doc, row, columns);
    if (doc.y + height > pageBottom(doc)) {
      addContentPage(doc, analytics);
      drawHeader();
    }
    const y = doc.y;
    let x = PAGE.left;
    columns.forEach((column, index) => {
      doc.rect(x, y, column.width, height).fillAndStroke(rowIndex % 2 ? COLORS.white : '#F8FAFB', COLORS.line);
      doc.fillColor(index === 0 ? COLORS.ink : COLORS.muted).font(index === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.6).text(String(row[index] ?? 'Sin datos'), x + 6, y + 7, { width: column.width - 12, lineGap: 1, align: column.align || 'left' });
      x += column.width;
    });
    doc.y = y + height;
  });
  doc.x = PAGE.left;
  doc.moveDown(0.9);
};

const addFooters = (doc) => {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    // PDFKit treats footer text as flowing content when it falls below the
    // configured bottom margin. Temporarily remove that margin so writing the
    // footer cannot create an extra page for every page already buffered.
    const previousBottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - 34;
    doc.moveTo(PAGE.left, y - 7).lineTo(doc.page.width - PAGE.right, y - 7).strokeColor(COLORS.line).lineWidth(0.6).stroke();
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(7).text('Uso institucional. Indicadores construidos únicamente desde registros existentes.', PAGE.left, y, { width: pageWidth(doc) - 80, lineBreak: false });
    doc.text(`${index + 1} / ${range.count}`, doc.page.width - PAGE.right - 62, y, { width: 62, align: 'right', lineBreak: false });
    doc.page.margins.bottom = previousBottomMargin;
  }
  if (doc.bufferedPageRange().count !== range.count) throw new Error('El pie del informe generó páginas adicionales');
  doc.switchToPage(range.start + range.count - 1);
};

const buildInstitutionalPdf = (analytics) => new Promise((resolve, reject) => {
  const doc = new PDFDocument({ size: 'A4', margins: PAGE, bufferPages: true, info: {
    Title: `Analítica institucional ${analytics.periodo.from} a ${analytics.periodo.to}`,
    Author: 'Liceo Domingo Santa María',
    Subject: 'Informe institucional de puntualidad y operación'
  } });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  doc.on('error', reject);
  doc.on('end', () => resolve(Buffer.concat(chunks)));

  doc.rect(0, 0, doc.page.width, 112).fill(COLORS.navy);
  doc.fillColor(COLORS.white).font('Helvetica-Bold').fontSize(9).text('LICEO DOMINGO SANTA MARÍA', PAGE.left, 34, { characterSpacing: 1 });
  doc.fontSize(24).text('Analítica institucional', PAGE.left, 56);
  doc.fillColor('#DCEAF0').font('Helvetica').fontSize(10).text(`Período analizado: ${shortDate(analytics.periodo.from)} al ${shortDate(analytics.periodo.to)}`, PAGE.left, 88);
  doc.y = 138;
  doc.fillColor(COLORS.muted).fontSize(8).text(`Generado: ${dateTime(analytics.generado_en || new Date().toISOString())}`);
  doc.moveDown(0.8);
  const scopeY = doc.y;
  doc.roundedRect(PAGE.left, scopeY, pageWidth(doc), 58, 6).fillAndStroke(COLORS.pale, COLORS.line);
  doc.fillColor(COLORS.navy).font('Helvetica-Bold').fontSize(8).text('ALCANCE APLICADO', PAGE.left + 12, scopeY + 10, { width: pageWidth(doc) - 24, characterSpacing: 0.35 });
  doc.fillColor(COLORS.ink).font('Helvetica').fontSize(8).text(`Puntualidad: ${punctualityScope(analytics)}`, PAGE.left + 12, scopeY + 24, { width: pageWidth(doc) - 24 });
  doc.fillColor(COLORS.muted).fontSize(7.3).text(`Operación: ${operationScope(analytics)}`, PAGE.left + 12, scopeY + 38, { width: pageWidth(doc) - 24 });
  doc.y = scopeY + 72;
  sectionTitle(doc, analytics, 'Resumen verificable', 'Indicadores principales', 'Las cifras corresponden a registros existentes. La falta de escaneo no se interpreta como presencia ni ausencia.');
  drawKpis(doc, analytics);
  sectionTitle(doc, analytics, 'Comportamiento diario', 'Evolución de atrasos', 'Cada punto muestra la cantidad de atrasos registrados durante el día.');
  drawTrendChart(doc, analytics);

  sectionTitle(doc, analytics, 'Criterios transparentes', 'Alertas y explicación', 'Cada alerta incluye el dato observado y la regla que la activó.');
  drawTable(doc, analytics, [
    { label: 'Nivel', width: 68 }, { label: 'Alerta', width: 132 }, { label: 'Explicación y regla', width: pageWidth(doc) - 200 }
  ], (analytics.alertas || []).map((item) => [String(item.level || '').toUpperCase(), item.title, `${item.explanation}\nRegla: ${item.rule}`]), 'No se activaron alertas para el período.');

  sectionTitle(doc, analytics, 'Comparación', 'Resultados por curso', 'Ordenados según la cantidad de atrasos informada por la analítica.');
  drawTable(doc, analytics, [
    { label: 'Curso', width: 240 }, { label: 'Ingresos', width: 82, align: 'right' }, { label: 'Atrasos', width: 82, align: 'right' }, { label: '% atrasos', width: pageWidth(doc) - 404, align: 'right' }
  ], (analytics.comparacion_cursos || []).map((item) => [item.curso, number(item.ingresos), number(item.atrasos), percent(item.porcentaje_atrasos)]));

  sectionTitle(doc, analytics, 'Puntualidad', 'Bloques horarios', 'Distribución por control horario aplicado al momento del registro.');
  drawTable(doc, analytics, [
    { label: 'Bloque', width: 210 }, { label: 'Límite', width: 74 }, { label: 'Ingresos', width: 74, align: 'right' }, { label: 'Atrasos', width: 70, align: 'right' }, { label: 'Promedio', width: pageWidth(doc) - 428, align: 'right' }
  ], (analytics.bloques_horarios || []).map((item) => [item.bloque, item.hora_limite, number(item.ingresos), number(item.atrasos), item.promedio_minutos === null ? 'Sin datos' : `${number(item.promedio_minutos)} min`]));

  sectionTitle(doc, analytics, 'Operación', 'Visitas y retiros', 'Totales agregados por motivo durante el período seleccionado.');
  drawTable(doc, analytics, [
    { label: 'Tipo', width: 78 }, { label: 'Motivo', width: 340 }, { label: 'Total', width: pageWidth(doc) - 418, align: 'right' }
  ], [
    ...(analytics.motivos_visita || []).map((item) => ['Visita', item.motivo, number(item.total)]),
    ...(analytics.retiros_anticipados || []).map((item) => ['Retiro', item.motivo, number(item.total)])
  ]);

  sectionTitle(doc, analytics, 'Equipos', 'Carga de trabajo por área', 'Casos creados en el período, separados por estado.');
  drawTable(doc, analytics, [
    { label: 'Área', width: 260 }, { label: 'Casos', width: 78, align: 'right' }, { label: 'Abiertos', width: 78, align: 'right' }, { label: 'Resueltos', width: pageWidth(doc) - 416, align: 'right' }
  ], (analytics.carga_trabajo || []).map((item) => [item.area, number(item.casos), number(item.abiertos), number(item.resueltos)]));

  sectionTitle(doc, analytics, 'Trazabilidad', 'Metodología y límites');
  Object.entries(analytics.metodologia || {}).forEach(([key, text]) => {
    ensureSpace(doc, analytics, 42);
    doc.fillColor(COLORS.navy).font('Helvetica-Bold').fontSize(8.5).text(label(key));
    doc.moveDown(0.15).fillColor(COLORS.muted).font('Helvetica').fontSize(8).text(text, { lineGap: 1.5 });
    // Mantiene el bloque metodológico compacto para que la nota de cierre no
    // quede aislada en una página casi vacía cuando el informe tiene pocas filas.
    doc.moveDown(0.25);
  });
  ensureSpace(doc, analytics, 44);
  const noteY = doc.y;
  doc.roundedRect(PAGE.left, noteY, pageWidth(doc), 44, 5).fillAndStroke(COLORS.pale, COLORS.line);
  doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(8).text('Lectura responsable', PAGE.left + 12, noteY + 10, { width: pageWidth(doc) - 24 });
  doc.fillColor(COLORS.muted).font('Helvetica').fontSize(7.5).text('Este informe describe registros institucionales y asociaciones observadas. No establece causalidad ni reemplaza la revisión profesional de cada caso.', PAGE.left + 12, noteY + 23, { width: pageWidth(doc) - 24 });

  addFooters(doc);
  doc.end();
});

const streamInstitutionalPdf = async (res, analytics) => {
  const buffer = await buildInstitutionalPdf(analytics);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', String(buffer.length));
  res.setHeader('Content-Disposition', `attachment; filename="analitica-institucional-${analytics.periodo.from}-${analytics.periodo.to}.pdf"`);
  res.end(buffer);
};

module.exports = { buildInstitutionalWorkbook, buildInstitutionalPdf, streamInstitutionalPdf };
