import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const referencePath =
  "C:/Users/lucas/.codex/plugins/cache/openai-curated-remote/openai-templates/0.1.1/skills/artifact-template-project-tracker/assets/reference.xlsx";
const outputDir =
  "C:/Users/lucas/Downloads/ProyectosInteresantes/ProgramaInasistenciasColegioDomingoSantamaria/outputs/ldsm-tracker-20260801";
const outputPath = `${outputDir}/Tracker_Maestro_LDSM_Actualizado_2026-08-01.xlsx`;

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(referencePath));
const sheet = workbook.worksheets.getItem("Project Plan");
const d = (iso) => new Date(`${iso}T00:00:00.000Z`);

const tasks = [
  ["Gobernanza ERP", "Mantener inalterable el contrato del Excel ERP", "Codex", "Completada", "P0", d("2026-07-29"), d("2026-07-29")],
  ["Gobernanza ERP", "Regresión oficial: 392 preparadas y 0 rechazadas", "Codex", "Completada", "P0", d("2026-07-29"), d("2026-07-30")],
  ["Identidad", "Identificadores múltiples y búsqueda conciliada", "Codex", "Completada", "P0", d("2026-07-29"), d("2026-07-30")],
  ["Identidad", "Regularización IPE a RUN sin duplicar estudiante", "Codex", "Completada", "P0", d("2026-07-29"), d("2026-07-30")],
  ["Padrón", "Alta manual y vinculación posterior con ERP", "Codex", "Completada", "P0", d("2026-07-30"), d("2026-07-30")],
  ["Padrón", "Bandeja de revisión y panel de calidad", "Codex", "Completada", "P1", d("2026-07-30"), d("2026-07-30")],
  ["Exportaciones", "Exportaciones operativas y administrativas protegidas", "Codex", "Completada", "P1", d("2026-08-01"), d("2026-08-01")],
  ["Seguridad", "Enmascaramiento y auditoría de información sensible", "Codex", "Completada", "P0", d("2026-08-01"), d("2026-08-01")],
  ["Validadores", "RUN, IPE y documentos extranjeros extensibles", "Codex", "Completada", "P1", d("2026-07-30"), d("2026-08-01")],
  ["Registro móvil", "Cámara web, antiduplicado y fallback manual", "Codex", "Completada", "P0", d("2026-08-01"), d("2026-08-01")],
  ["MRZ", "Lectura restringida de pasaportes sin guardar imágenes", "Codex", "Completada", "P2", d("2026-08-01"), d("2026-08-01")],
  ["Permisos", "Permisos granulares de identidad y métodos de registro", "Codex", "Completada", "P0", d("2026-08-01"), d("2026-08-01")],
  ["Historial", "Congelar curso, jornada, regla y minutos por ingreso", "Codex", "Completada", "P0", d("2026-07-28"), d("2026-07-28")],
  ["Importación", "Previsualización, conflictos y cursos controlados", "Codex", "Completada", "P0", d("2026-07-28"), d("2026-07-28")],
  ["Operación", "Bandeja diaria y cierre de visitas y retiros", "Codex", "Completada", "P0", d("2026-07-28"), d("2026-07-28")],
  ["Familias", "Ficha familiar y catálogos institucionales", "Codex", "Completada", "P1", d("2026-07-28"), d("2026-07-28")],
  ["Recuperación", "Restauración aislada y configuración estricta", "Codex", "Completada", "P0", d("2026-07-28"), d("2026-07-28")],
  ["UI responsive", "Changelog adaptable a móvil y zoom de 125% a 200%", "Codex", "Completada", "P1", d("2026-08-01"), d("2026-08-01")],
  ["Resiliencia UI", "Recuperar automáticamente chunks obsoletos tras actualizar", "Codex", "Completada", "P0", d("2026-08-01"), d("2026-08-01")],
  ["UI operativa", "Rediseñar administración de catálogos de visitas", "Codex", "Completada", "P1", d("2026-08-01"), d("2026-08-01")],
  ["QA local", "Regresión automatizada en escritorio, móvil y accesibilidad", "Codex", "Completada", "P0", d("2026-08-01"), d("2026-08-01")],
  ["QA local", "Probar visitas y retiros sin dejar datos abiertos", "Codex", "Completada", "P0", d("2026-08-01"), d("2026-08-01")],
  ["QA local", "Comprobar respaldo, restauración y salud de contenedores", "Codex", "Completada", "P0", d("2026-08-01"), d("2026-08-01")],
  ["Publicación", "Commits en español y publicación controlada en test", "Codex", "Completada", "P0", d("2026-08-01"), d("2026-08-01")],
  ["Infraestructura", "Elegir y preparar el PC servidor definitivo", "LDSM", "No iniciada", "P0", null, null],
  ["Red escolar", "Reservar IP y definir DNS o nombre interno", "LDSM / encargado de red", "No iniciada", "P0", null, null],
  ["HTTPS interno", "Activar HTTPS y confiar la CA en cada dispositivo", "Lucas + LDSM", "No iniciada", "P0", null, null],
  ["Aceptación física", "Probar pistola, cámara y visitas/retiros reales", "Lucas + LDSM", "No iniciada", "P0", null, null],
  ["Continuidad", "Reinicio Windows, BitLocker y respaldo fuera del PC", "LDSM / soporte técnico", "No iniciada", "P0", null, null],
  ["Gobernanza", "Aprobar responsables, retención y evidencia de aceptación", "Dirección LDSM", "No iniciada", "P0", null, null],
];

sheet.getRange("B2:AD2").values = [["Tracker maestro · Sistema institucional LDSM · implementación y aceptación"]];
sheet.getRange("B4:I4").values = [["PERFIL DEL PROYECTO"]];
sheet.getRange("K4:AD4").values = [["PULSO DE IMPLEMENTACIÓN"]];
sheet.getRange("B5").values = [["Proyecto"]];
sheet.getRange("C5:E5").values = [["Puntualidad, identidad, visitas y retiros LDSM"]];
sheet.getRange("F5:G5").values = [["Responsables"]];
sheet.getRange("H5:I5").values = [["Lucas / Codex / LDSM"]];
sheet.getRange("B6").values = [["Institución"]];
sheet.getRange("C6:E6").values = [["Liceo Domingo Santa María"]];
sheet.getRange("F6:G6").values = [["Actualizado"]];
sheet.getRange("H6:I6").values = [[d("2026-08-01")]];

sheet.getRange("K5:N5").values = [["TAREAS TOTALES"]];
sheet.getRange("O5:R5").values = [["COMPLETADAS"]];
sheet.getRange("S5:V5").values = [["EN CURSO"]];
sheet.getRange("W5:Z5").values = [["EN RIESGO"]];
sheet.getRange("AA5:AD5").values = [["TAREAS P0"]];
sheet.getRange("K6").formulas = [["=COUNTA($C$10:$C$39)"]];
sheet.getRange("O6").formulas = [["=COUNTIF($E$10:$E$39,\"Completada\")"]];
sheet.getRange("S6").formulas = [["=COUNTIF($E$10:$E$39,\"En curso\")"]];
sheet.getRange("W6").formulas = [["=COUNTIF($E$10:$E$39,\"En riesgo\")"]];
sheet.getRange("AA6").formulas = [["=COUNTIF($F$10:$F$39,\"P0\")"]];

sheet.getRange("B8:I8").values = [["PLAN DE TRABAJO"]];
sheet.getRange("K8:AD8").values = [["GANTT · IMPLEMENTACIÓN LOCAL Y ACEPTACIÓN ESCOLAR"]];
sheet.getRange("B9:I9").values = [["Bloque", "Tarea", "Responsable", "Estado", "Prioridad", "Inicio", "Fin", "Días"]];
sheet.getRange("B10:H39").values = tasks;
sheet.getRange("I10").formulas = [["=IF(OR(G10=\"\",H10=\"\",H10<G10),\"\",H10-G10+1)"]];
sheet.getRange("I10:I39").fillDown();
sheet.getRange("K9").values = [[d("2026-07-28")]];
sheet.getRange("L9").formulas = [["=K9+7"]];
sheet.getRange("L9:AD9").fillRight();
sheet.getRange("K10").formulas = [["=IF(OR($G10=\"\",$H10=\"\",$H10<$G10),\"\",IF(AND(K$9<=$H10,K$9+6>=$G10),1,\"\"))"]];
sheet.getRange("K10:AD10").fillRight();
sheet.getRange("K10:AD39").fillDown();

sheet.getRange("E10:E39").dataValidation = { rule: { type: "list", values: ["No iniciada", "En curso", "Completada", "En riesgo"] } };
sheet.getRange("F10:F39").dataValidation = { rule: { type: "list", values: ["P0", "P1", "P2"] } };
sheet.getRange("E10:E39").conditionalFormats.deleteAll();
for (const [text, fill, color] of [
  ["Completada", "#DDF7EC", "#087F5B"],
  ["En curso", "#E7EEFF", "#315FD5"],
  ["En riesgo", "#FFE3E8", "#D6334C"],
  ["No iniciada", "#F0E7FF", "#7048C8"],
]) {
  sheet.getRange("E10:E39").conditionalFormats.add("containsText", { text, format: { fill, font: { color } } });
}

sheet.getRange("K10:AD39").conditionalFormats.deleteAll();
for (const [status, fill] of [
  ["Completada", "#10BFA4"],
  ["En curso", "#4C78F5"],
  ["En riesgo", "#FF5D73"],
  ["No iniciada", "#9B6BE8"],
]) {
  sheet.getRange("K10:AD39").conditionalFormats.addCustom(`=AND(K10=1,$E10="${status}")`, { fill });
}

sheet.getRange("G10:H39").format.numberFormat = "mmm d";
sheet.getRange("H6:I6").format.numberFormat = "mmm d, yyyy";
sheet.getRange("K9:AD9").format.numberFormat = "mmm d";
sheet.getRange("B10:B39").format.font = { bold: true, color: "#3E3297" };
sheet.getRange("C10:D39").format.wrapText = true;
sheet.getRange("B10:I39").format.rowHeight = 24;
sheet.getRange("B10:B39").format.columnWidth = 18;
sheet.getRange("C10:C39").format.columnWidth = 44;
sheet.getRange("D10:D39").format.columnWidth = 22;

sheet.getRange("B41:AD42").values = [[
  "Estado al 1 ago 2026: 24 de 30 tareas completadas y publicación controlada en la rama test. La regresión automatizada, UI, flujos web, ERP oficial y restauración aislada están aprobados localmente. Las 6 tareas restantes requieren intervención física o institucional en el colegio: PC servidor, red, HTTPS confiable, dispositivos, continuidad, responsables y aceptación.",
]];
sheet.getRange("B41:AD42").format.wrapText = true;
sheet.getRange("B41:AD42").format.rowHeight = 28;

await fs.mkdir(outputDir, { recursive: true });
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);

const preview = await workbook.render({ sheetName: "Project Plan", autoCrop: "all", scale: 1, format: "png" });
await fs.writeFile(`${outputDir}/tracker-preview.png`, new Uint8Array(await preview.arrayBuffer()));

const inspect = await workbook.inspect({
  kind: "table",
  range: "Project Plan!B4:AD42",
  include: "values,formulas",
  tableMaxRows: 42,
  tableMaxCols: 30,
  maxChars: 12000,
});
await fs.writeFile(`${outputDir}/tracker-inspect.ndjson`, inspect.ndjson, "utf8");

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "final formula error scan",
});
await fs.writeFile(`${outputDir}/tracker-formula-errors.ndjson`, errors.ndjson, "utf8");
console.log(outputPath);
