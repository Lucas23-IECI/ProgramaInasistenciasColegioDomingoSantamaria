import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const referencePath =
  "C:/Users/lucas/.codex/plugins/cache/openai-curated-remote/openai-templates/0.1.1/skills/artifact-template-project-tracker/assets/reference.xlsx";
const outputDir =
  "C:/Users/lucas/Downloads/ProyectosInteresantes/ProgramaInasistenciasColegioDomingoSantamaria/outputs/ldsm-identidad-20260729";
const outputPath = `${outputDir}/Tracker_Implementacion_Identidad_y_Registro_Movil_LDSM.xlsx`;

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(referencePath));
const sheet = workbook.worksheets.getItem("Project Plan");

const d = (iso) => new Date(`${iso}T00:00:00.000Z`);
const tasks = [
  ["Gobernanza ERP", "Mantener contrato inalterable del Excel ERP", "Codex", "Completada", "P0", d("2026-07-29"), d("2026-07-29")],
  ["Gobernanza ERP", "Regresión oficial: 392 preparadas y 0 rechazadas", "Codex", "Completada", "P0", d("2026-07-29"), d("2026-07-30")],
  ["Identidad", "Diseñar modelo de identificadores múltiples", "Codex", "Completada", "P0", d("2026-07-29"), d("2026-07-29")],
  ["Identidad", "Crear tabla y restricciones de identificadores", "Codex", "Completada", "P0", d("2026-07-29"), d("2026-07-29")],
  ["Identidad", "Migrar RUN, IPE, ERP y códigos actuales", "Codex", "Completada", "P0", d("2026-07-29"), d("2026-07-29")],
  ["Identidad", "Buscar y conciliar por cualquier identificador", "Codex", "Completada", "P0", d("2026-07-29"), d("2026-07-29")],
  ["Regularización", "Implementar transición controlada IPE a RUN", "Codex", "Completada", "P0", d("2026-07-29"), d("2026-07-30")],
  ["Regularización", "Crear interfaz, respaldo y auditoría IPE–RUN", "Codex", "Completada", "P0", d("2026-07-29"), d("2026-07-30")],
  ["Ingreso manual", "Formulario dinámico RUN, IPE y extranjeros", "Codex", "Completada", "P0", d("2026-07-30"), d("2026-07-30")],
  ["Ingreso manual", "Vincular ficha manual con ERP sin duplicar", "Codex", "Completada", "P0", d("2026-07-30"), d("2026-07-30")],
  ["Revisión", "Bandeja de casos de identidad pendientes", "Codex", "Completada", "P1", d("2026-07-30"), d("2026-07-30")],
  ["Calidad", "Panel navegable de calidad del padrón", "Codex", "Completada", "P1", d("2026-07-30"), d("2026-07-30")],
  ["Exportaciones", "Exportación operativa con documentos ocultos", "Codex", "Completada", "P1", d("2026-08-01"), d("2026-08-01")],
  ["Exportaciones", "Exportación administrativa restringida", "Codex", "Completada", "P1", d("2026-08-01"), d("2026-08-01")],
  ["Exportaciones", "Exportación de casos y calidad del padrón", "Codex", "Completada", "P1", d("2026-08-01"), d("2026-08-01")],
  ["Seguridad", "Enmascarar identificadores por defecto", "Codex", "No iniciada", "P0", d("2026-09-10"), d("2026-09-18")],
  ["Seguridad", "Auditar revelación y exportación sensible", "Codex", "Completada", "P0", d("2026-08-01"), d("2026-08-01")],
  ["Validadores", "Arquitectura extensible de validadores por país", "Codex", "No iniciada", "P1", d("2026-09-18"), d("2026-09-30")],
  ["Validadores", "RUN, IPE, documentos y validación estructural", "Codex", "Completada", "P1", d("2026-07-30"), d("2026-07-30")],
  ["Escáner móvil", "Integrar cámara trasera al terminal existente", "Codex", "No iniciada", "P0", d("2026-09-28"), d("2026-10-09")],
  ["Escáner móvil", "Antiduplicado, vibración, sonido y fallback", "Codex", "No iniciada", "P0", d("2026-10-05"), d("2026-10-13")],
  ["HTTPS interno", "Preparar incorporación segura de dispositivos", "Codex + Lucas", "No iniciada", "P0", d("2026-10-07"), d("2026-10-16")],
  ["HTTPS interno", "Probar cámara en Android y escritorios", "Lucas", "No iniciada", "P0", d("2026-10-12"), d("2026-10-22")],
  ["MRZ", "Prototipo de lectura MRZ sin guardar imágenes", "Codex", "No iniciada", "P2", d("2026-10-19"), d("2026-10-30")],
  ["MRZ", "Flujo restringido y revisión física del pasaporte", "Codex", "No iniciada", "P2", d("2026-10-26"), d("2026-11-06")],
  ["Permisos", "Permisos granulares de identidad y cámara", "Codex", "No iniciada", "P0", d("2026-11-02"), d("2026-11-10")],
  ["QA", "E2E de identidad, manuales e importación ERP", "Codex", "No iniciada", "P0", d("2026-11-05"), d("2026-11-18")],
  ["QA", "E2E móvil, permisos y datos sensibles", "Codex + Lucas", "No iniciada", "P0", d("2026-11-12"), d("2026-11-25")],
  ["QA", "Recuperación, rendimiento y accesibilidad", "Codex", "No iniciada", "P1", d("2026-11-20"), d("2026-12-04")],
  ["Aceptación", "Auditoría final, manuales y aprobación escolar", "Lucas + LDSM", "No iniciada", "P0", d("2026-12-01"), d("2026-12-15")],
];

sheet.getRange("B2:AD2").values = [["Tracker maestro · Identidad estudiantil y registro móvil LDSM"]];
sheet.getRange("B4:I4").values = [["PERFIL DEL PROYECTO"]];
sheet.getRange("K4:AD4").values = [["PULSO DE IMPLEMENTACIÓN"]];
sheet.getRange("B5").values = [["Proyecto"]];
sheet.getRange("C5:E5").values = [["Identidad y registro móvil LDSM"]];
sheet.getRange("F5:G5").values = [["Responsables"]];
sheet.getRange("H5:I5").values = [["Lucas / Codex"]];
sheet.getRange("B6").values = [["Institución"]];
sheet.getRange("C6:E6").values = [["Liceo Domingo Santa María"]];
sheet.getRange("F6:G6").values = [["Inicio del plan"]];
sheet.getRange("H6:I6").values = [[d("2026-07-29")]];

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
sheet.getRange("K8:AD8").values = [["GANTT · VISTA DE 20 SEMANAS"]];
sheet.getRange("B9:I9").values = [[
  "Bloque",
  "Tarea",
  "Responsable",
  "Estado",
  "Prioridad",
  "Inicio",
  "Fin",
  "Días",
]];

sheet.getRange("B10:H39").values = tasks;
sheet.getRange("I10").formulas = [["=IF(OR(G10=\"\",H10=\"\",H10<G10),\"\",H10-G10+1)"]];
sheet.getRange("I10:I39").fillDown();
sheet.getRange("K9").formulas = [["=$H$6"]];
sheet.getRange("L9").formulas = [["=K9+7"]];
sheet.getRange("L9:AD9").fillRight();
sheet.getRange("K10").formulas = [[
  "=IF(OR($G10=\"\",$H10=\"\",$H10<$G10),\"\",IF(AND(K$9<=$H10,K$9+6>=$G10),1,\"\"))",
]];
sheet.getRange("K10:AD10").fillRight();
sheet.getRange("K10:AD39").fillDown();

sheet.getRange("E10:E39").dataValidation = {
  rule: { type: "list", values: ["No iniciada", "En curso", "Completada", "En riesgo"] },
};
sheet.getRange("F10:F39").dataValidation = {
  rule: { type: "list", values: ["P0", "P1", "P2"] },
};

sheet.getRange("E10:E39").conditionalFormats.deleteAll();
sheet.getRange("E10:E39").conditionalFormats.add("containsText", {
  text: "Completada",
  format: { fill: "#DDF7EC", font: { color: "#087F5B" } },
});
sheet.getRange("E10:E39").conditionalFormats.add("containsText", {
  text: "En curso",
  format: { fill: "#E7EEFF", font: { color: "#315FD5" } },
});
sheet.getRange("E10:E39").conditionalFormats.add("containsText", {
  text: "En riesgo",
  format: { fill: "#FFE3E8", font: { color: "#D6334C" } },
});
sheet.getRange("E10:E39").conditionalFormats.add("containsText", {
  text: "No iniciada",
  format: { fill: "#F0E7FF", font: { color: "#7048C8" } },
});

sheet.getRange("K10:AD39").conditionalFormats.deleteAll();
sheet.getRange("K10:AD39").conditionalFormats.addCustom(
  '=AND(K10=1,$E10="Completada")',
  { fill: "#10BFA4" },
);
sheet.getRange("K10:AD39").conditionalFormats.addCustom(
  '=AND(K10=1,$E10="En curso")',
  { fill: "#4C78F5" },
);
sheet.getRange("K10:AD39").conditionalFormats.addCustom(
  '=AND(K10=1,$E10="En riesgo")',
  { fill: "#FF5D73" },
);
sheet.getRange("K10:AD39").conditionalFormats.addCustom(
  '=AND(K10=1,$E10="No iniciada")',
  { fill: "#9B6BE8" },
);

sheet.getRange("G10:H39").format.numberFormat = "mmm d";
sheet.getRange("H6:I6").format.numberFormat = "mmm d, yyyy";
sheet.getRange("K9:AD9").format.numberFormat = "mmm d";
sheet.getRange("B10:B39").format.font = { bold: true, color: "#3E3297" };
sheet.getRange("C10:C39").format.wrapText = true;
sheet.getRange("D10:D39").format.wrapText = true;
sheet.getRange("B10:I39").format.rowHeight = 22;
sheet.getRange("C10:C39").format.columnWidth = 42;
sheet.getRange("D10:D39").format.columnWidth = 19;
sheet.getRange("B10:B39").format.columnWidth = 18;

sheet.getRange("B41:AD42").values = [[
  "Reglas del plan: el Excel ERP no se modifica; las exportaciones enriquecidas son propias; cada cambio sensible debe auditarse; la cámara móvil requiere HTTPS interno; ninguna regularización puede duplicar estudiantes ni perder historial.",
]];
sheet.getRange("B41:AD42").format.wrapText = true;

await fs.mkdir(outputDir, { recursive: true });
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);

const preview = await workbook.render({
  sheetName: "Project Plan",
  autoCrop: "all",
  scale: 1,
  format: "png",
});
await fs.writeFile(
  `${outputDir}/tracker-preview.png`,
  new Uint8Array(await preview.arrayBuffer()),
);

const inspect = await workbook.inspect({
  kind: "table",
  range: "Project Plan!B4:AD39",
  include: "values,formulas",
  tableMaxRows: 40,
  tableMaxCols: 30,
  maxChars: 10000,
});
console.log(inspect.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "final formula error scan",
});
console.log(errors.ndjson);
