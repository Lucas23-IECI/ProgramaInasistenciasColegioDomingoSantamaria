import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';
import { writeFile } from 'node:fs/promises';

const templatePath = 'C:/Users/lucas/.codex/plugins/cache/openai-curated-remote/openai-templates/0.1.1/skills/artifact-template-project-tracker/assets/reference.xlsx';
const outputPath = 'C:/Users/lucas/Downloads/ProyectosInteresantes/ProgramaInasistenciasColegioDomingoSantamaria/outputs/seguimiento-chat-20260809/Tracker_Seguimiento_Chat_LDSM.xlsx';
const previewPath = 'C:/Users/lucas/Downloads/ProyectosInteresantes/ProgramaInasistenciasColegioDomingoSantamaria/outputs/seguimiento-chat-20260809/Tracker_Seguimiento_Chat_LDSM.png';
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(templatePath));
const sheet = workbook.worksheets.getItem('Project Plan');

const d = (day) => new Date(Date.UTC(2026, 7, day));
const columnName = (column) => {
  let value = column;
  let name = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
};
const tasks = [
  ['Seguimiento institucional', 'Definir alcance, seguridad y relación con Convivencia', 'Codex (local)', 'Complete', 'P0', d(9), d(9)],
  ['Seguimiento institucional', 'Crear modelo aditivo de casos, señales y reglas', 'Codex (local)', 'Complete', 'P0', d(9), d(9)],
  ['Seguimiento institucional', 'Implementar evaluador idempotente de señales', 'Codex (local)', 'Complete', 'P0', d(9), d(10)],
  ['Seguimiento institucional', 'Implementar API de resumen y bandeja de casos', 'Codex (local)', 'Complete', 'P0', d(9), d(10)],
  ['Seguimiento institucional', 'Implementar tareas, notas, contactos y acuerdos', 'Codex (local)', 'Complete', 'P0', d(10), d(11)],
  ['Seguimiento institucional', 'Adjuntar documentos con control de referencias', 'Codex (local)', 'Complete', 'P1', d(10), d(11)],
  ['Seguimiento institucional', 'Derivar casos a Convivencia sin duplicar historial', 'Codex (local)', 'Complete', 'P0', d(11), d(11)],
  ['Seguimiento institucional', 'Crear interfaz de bandeja y ficha de seguimiento', 'Codex (local)', 'Complete', 'P0', d(11), d(13)],
  ['Seguimiento institucional', 'Agregar filtros, estados vacíos y responsive', 'Codex (local)', 'Complete', 'P1', d(12), d(13)],
  ['Seguimiento institucional', 'Integrar permisos, panel, ayuda y changelog', 'Codex (local)', 'Complete', 'P0', d(13), d(13)],
  ['Seguimiento institucional', 'Automatizar ejecución periódica con activación segura y métricas explicables', 'Codex (local)', 'Complete', 'P0', d(13), d(14)],
  ['Seguimiento institucional', 'Pruebas unitarias, API, UI y regresión completa con límite por cuenta e IP', 'Codex (local)', 'Complete', 'P0', d(14), d(15)],
  ['Seguimiento institucional', 'Validar reglas automáticas y operación con datos del establecimiento', 'Equipo escolar', 'Not Started', 'P1', d(17), d(21)],
  ['Chat interno', 'Definir membresía, retención y límites de confidencialidad', 'Codex (local)', 'Complete', 'P0', d(9), d(9)],
  ['Chat interno', 'Crear modelo aditivo de conversaciones y mensajes', 'Codex (local)', 'Complete', 'P0', d(9), d(9)],
  ['Chat interno', 'Implementar API de conversaciones y directorio', 'Codex (local)', 'Complete', 'P0', d(10), d(11)],
  ['Chat interno', 'Implementar envío, menciones, lectura y fijados', 'Codex (local)', 'Complete', 'P0', d(11), d(12)],
  ['Chat interno', 'Implementar adjuntos y moderación auditable', 'Codex (local)', 'Complete', 'P0', d(12), d(12)],
  ['Chat interno', 'Vincular conversaciones con estudiante, retiro y caso', 'Codex (local)', 'Complete', 'P0', d(12), d(13)],
  ['Chat interno', 'Implementar silencios, urgencias y preferencias', 'Codex (local)', 'Complete', 'P1', d(13), d(13)],
  ['Chat interno', 'Actualizar mensajes en tiempo real con SSE y sondeo de respaldo', 'Codex (local)', 'Complete', 'P0', d(10), d(10)],
  ['Chat interno', 'Configurar retención global y por conversación con previsualización segura', 'Codex (local)', 'Complete', 'P0', d(10), d(10)],
  ['Chat interno', 'Crear interfaz de conversaciones y mensajes', 'Codex (local)', 'Complete', 'P0', d(13), d(15)],
  ['Chat interno', 'Agregar buscador, estados vacíos y responsive móvil', 'Codex (local)', 'Complete', 'P1', d(14), d(15)],
  ['Chat interno', 'Integrar indicador de no leídos, panel y ayuda', 'Codex (local)', 'Complete', 'P1', d(15), d(16)],
  ['Chat interno', 'Pruebas de aislamiento, permisos y regresión', 'Codex (local)', 'Complete', 'P0', d(16), d(17)],
  ['Chat interno', 'Aprobar política institucional de retención y uso', 'Equipo escolar', 'Not Started', 'P1', d(17), d(21)],
  ['Calidad transversal', 'Ejecutar lint, pruebas, build y migración aislada', 'Codex (local)', 'Complete', 'P0', d(17), d(18)],
  ['Calidad transversal', 'Auditar accesibilidad y experiencia móvil', 'Codex (local)', 'Complete', 'P0', d(18), d(19)],
  ['Calidad transversal', 'Preparar evidencia y guía de pruebas', 'Codex (local)', 'Complete', 'P1', d(19), d(20)],
];

sheet.getRange('C5:E6').clear({ contentsOnly: true });
sheet.getRange('H5:I6').clear({ contentsOnly: true });
sheet.getRange('C5:E5').merge();
sheet.getRange('C6:E6').merge();
sheet.getRange('H5:I5').merge();
sheet.getRange('H6:I6').merge();
sheet.getRange('C5').values = [['Seguimiento institucional y Chat interno']];
sheet.getRange('C6').values = [['Liceo Domingo Santa María']];
sheet.getRange('H5').values = [['Codex / validación escolar']];
sheet.getRange('H6').values = [[d(10)]];
sheet.getRange('H6').format.numberFormat = 'dd-mmm-yyyy';

sheet.getRange('B9:H9').values = [[
  'Frente', 'Tarea', 'Responsable', 'Estado', 'Prioridad', 'Inicio', 'Término'
]];
sheet.getRange('B10:H39').clear({ contentsOnly: true });
sheet.getRange('B10:H39').values = tasks;
sheet.getRange('G10:H39').format.numberFormat = 'dd-mmm-yyyy';

for (let row = 10; row <= 39; row += 1) {
  sheet.getRange(`I${row}`).formulas = [[`=IF(OR(G${row}="",H${row}="",H${row}<G${row}),"",H${row}-G${row}+1)`]];
  for (let col = 11; col <= 30; col += 1) {
    const letter = columnName(col);
    sheet.getRange(`${letter}${row}`).formulas = [[`=IF(OR($G${row}="",$H${row}="",$H${row}<$G${row}),"",IF(AND(${letter}$9<=$H${row},${letter}$9+6>=$G${row}),1,""))`]];
  }
}

sheet.getRange('K6').formulas = [['=COUNTA($C$10:$C$39)']];
sheet.getRange('O6').formulas = [['=COUNTIF($E$10:$E$39,"Complete")']];
sheet.getRange('S6').formulas = [['=COUNTIF($E$10:$E$39,"In Progress")']];
sheet.getRange('W6').formulas = [['=COUNTIF($E$10:$E$39,"At Risk")']];
sheet.getRange('AA6').formulas = [['=COUNTIF($F$10:$F$39,"P0")']];
sheet.getRange('B41:AD42').values = [[
  'Estado local al 10-08-2026: implementación y QA automatizada completas. Seguimiento incorpora asignación, escalamiento y avisos; Chat incorpora tiempo real, silencios y retención configurable. La regresión final aprobó 143 pruebas backend, 47 frontend y 32 recorridos E2E; 2 casos se omitieron intencionalmente. Quedan la validación escolar de reglas y la aprobación institucional de retención. Ambas automatizaciones permanecen desactivadas por defecto.',
  ...Array(28).fill('')
], Array(29).fill('')];

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
const preview = await workbook.render({ sheetName: 'Project Plan', autoCrop: 'all', scale: 1, format: 'png' });
await writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));
console.log((await workbook.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A', options: { useRegex: true, maxResults: 50 }, summary: 'final formula error scan' })).ndjson);
console.log(outputPath);
