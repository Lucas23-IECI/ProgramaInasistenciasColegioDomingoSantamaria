import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const templatePath = 'C:/Users/lucas/.codex/plugins/cache/openai-curated-remote/openai-templates/0.1.1/skills/artifact-template-project-tracker/assets/reference.xlsx';
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(templatePath));

console.log((await workbook.inspect({
  kind: 'workbook,sheet,table,definedName',
  maxChars: 12000,
  tableMaxRows: 8,
  tableMaxCols: 12,
  tableMaxCellChars: 100,
})).ndjson);

for (const sheet of workbook.worksheets.items) {
  const used = sheet.getUsedRange();
  if (!used) continue;
  console.log(`SHEET=${sheet.name}`);
  console.log((await workbook.inspect({
    kind: 'region',
    sheetId: sheet.name,
    range: used.address,
    maxChars: 14000,
    tableMaxRows: 20,
    tableMaxCols: 20,
    tableMaxCellChars: 120,
  })).ndjson);
}

console.log((await workbook.inspect({
  kind: 'formula',
  sheetId: 'Project Plan',
  range: 'B4:AD42',
  maxChars: 16000,
  options: { maxResults: 240 },
})).ndjson);

const preview = await workbook.render({ sheetName: workbook.worksheets.getItemAt(0).name, autoCrop: 'all', scale: 1, format: 'png' });
const previewBytes = new Uint8Array(await preview.arrayBuffer());
await (await import('node:fs/promises')).writeFile(
  'C:/Users/lucas/Downloads/ProyectosInteresantes/ProgramaInasistenciasColegioDomingoSantamaria/outputs/seguimiento-chat-20260809/template-preview.png',
  previewBytes,
);
