const PDFDocument = require('pdfkit');

const COLORS = {
  navy: '#15384c',
  blue: '#17698f',
  muted: '#5c6e79',
  border: '#d4dee3',
  soft: '#f3f6f7',
  white: '#ffffff'
};

const cleanValue = (value, max = 3000) => String(value ?? '')
  .replace(/\r\n/g, '\n')
  .replace(/\r/g, '\n')
  .trim()
  .slice(0, max);

const renderTemplate = (template, values = {}) => {
  const allowed = new Set(Array.isArray(template.campos_permitidos) ? template.campos_permitidos : []);
  const supplied = Object.fromEntries(
    Object.entries(values || {})
      .filter(([key]) => allowed.has(key))
      .map(([key, value]) => [key, cleanValue(value)])
  );
  const unresolved = new Set();
  const content = String(template.contenido || '').replace(/\{\{([a-z0-9_]+)\}\}/gi, (_match, key) => {
    if (!allowed.has(key) || !supplied[key]) {
      unresolved.add(key);
      return `[${key.replace(/_/g, ' ')} pendiente]`;
    }
    return supplied[key];
  });
  return { content, unresolved: [...unresolved] };
};

const createInstitutionalPdf = ({ template, values, student, generatedBy }) => new Promise((resolve, reject) => {
  const doc = new PDFDocument({ size: 'A4', margin: 54, bufferPages: true, info: {
    Title: template.nombre,
    Author: 'Liceo Domingo Santa Maria',
    Subject: 'Documento institucional generado por el sistema escolar'
  } });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  doc.on('error', reject);
  doc.on('end', () => resolve(Buffer.concat(chunks)));

  const { content, unresolved } = renderTemplate(template, values);
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  doc.rect(0, 0, doc.page.width, 92).fill(COLORS.navy);
  doc.fillColor(COLORS.white).font('Helvetica-Bold').fontSize(15)
    .text('LICEO DOMINGO SANTA MARIA', 54, 30, { width: pageWidth });
  doc.font('Helvetica').fontSize(9).fillColor('#cfe4ee')
    .text('Concepcion · RBD 4565-9 · Documento institucional', 54, 54, { width: pageWidth });

  doc.y = 126;
  doc.fillColor(COLORS.blue).font('Helvetica-Bold').fontSize(9)
    .text(String(template.categoria || 'DOCUMENTO').replace(/_/g, ' '));
  doc.moveDown(0.45);
  doc.fillColor(COLORS.navy).font('Helvetica-Bold').fontSize(22)
    .text(template.nombre, { width: pageWidth });
  doc.moveDown(0.45);
  doc.strokeColor(COLORS.border).lineWidth(1)
    .moveTo(54, doc.y).lineTo(doc.page.width - 54, doc.y).stroke();
  doc.moveDown(1.5);

  content.split(/\n{2,}/).forEach((paragraph) => {
    doc.fillColor(COLORS.navy).font('Helvetica').fontSize(11.5)
      .text(paragraph.replace(/\n/g, ' '), { width: pageWidth, align: 'justify', lineGap: 5 });
    doc.moveDown(1.15);
  });

  if (unresolved.length) {
    doc.moveDown(0.5);
    const top = doc.y;
    doc.roundedRect(54, top, pageWidth, 54, 5).fill(COLORS.soft);
    doc.fillColor(COLORS.muted).font('Helvetica-Bold').fontSize(9)
      .text('CAMPOS QUE REQUIEREN REVISIÓN', 68, top + 12, { width: pageWidth - 28 });
    doc.font('Helvetica').fontSize(9)
      .text(unresolved.map((key) => key.replace(/_/g, ' ')).join(' · '), 68, top + 29, { width: pageWidth - 28 });
    doc.y = top + 70;
  }

  if (doc.y > doc.page.height - 155) doc.addPage();
  doc.moveDown(2);
  doc.strokeColor(COLORS.border).moveTo(54, doc.y).lineTo(260, doc.y).stroke();
  doc.moveDown(0.45);
  doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9)
    .text('Firma y timbre institucional', 54, doc.y, { width: 206, align: 'center' });

  const pageCount = doc.bufferedPageRange().count;
  for (let index = 0; index < pageCount; index += 1) {
    doc.switchToPage(index);
    const footerY = doc.page.height - 42;
    doc.strokeColor(COLORS.border).moveTo(54, footerY - 10).lineTo(doc.page.width - 54, footerY - 10).stroke();
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(7.5)
      .text(
        `Generado por ${cleanValue(generatedBy, 120) || 'cuenta autorizada'} · Estudiante: ${cleanValue(student?.nombre, 120) || 'sin identificar'}`,
        54,
        footerY,
        { width: pageWidth - 45 }
      );
    doc.text(`${index + 1}/${pageCount}`, doc.page.width - 90, footerY, { width: 36, align: 'right' });
  }

  doc.end();
});

module.exports = {
  createInstitutionalPdf,
  renderTemplate
};
