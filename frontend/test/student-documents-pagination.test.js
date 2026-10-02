import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readFrontend = (relative) => fs.readFileSync(path.join(frontendRoot, relative), 'utf8');

test('la consulta documental conecta la paginación del servidor con la interfaz', () => {
  const frontend = readFrontend('src/StudentDocuments.jsx');

  assert.match(frontend, /DOCUMENTS_PER_PAGE\s*=\s*20/u);
  assert.match(frontend, /pagina:\s*page/u);
  assert.match(frontend, /limite:\s*DOCUMENTS_PER_PAGE/u);
  assert.match(frontend, /aria-label="Paginación de documentos"/u);
  assert.match(frontend, /setPage\(1\)/u);
});

test('un fallo documental se diferencia de una búsqueda sin resultados', () => {
  const source = readFrontend('src/StudentDocuments.jsx');
  const help = readFrontend('src/help/tours.js');

  assert.match(source, /const \[loadError, setLoadError\]/u);
  assert.match(source, /No pudimos cargar los documentos/u);
  assert.match(source, /role="alert"/u);
  assert.match(source, /> Reintentar</u);
  assert.match(source, /No hay documentos con estos filtros/u);
  assert.match(help, /una acción para reintentar en lugar de una lista vacía/u);
});

test('expediente y detalle conservan el contexto cuando la carga falla', () => {
  const source = readFrontend('src/StudentDocuments.jsx');

  assert.match(source, /No pudimos abrir el expediente/u);
  assert.match(source, /No pudimos abrir el documento/u);
  assert.match(source, /setLoadError\(message\)/u);
  assert.doesNotMatch(source, /No fue posible abrir el expediente[^\n]+navigate\('\/admin\/documentos'\)/u);
  assert.doesNotMatch(source, /No fue posible abrir el documento[^\n]+navigate\('\/admin\/documentos'\)/u);
  assert.match(source, /StatusBadge value=\{doc\.estado_efectivo \|\| doc\.estado\}/u);
});

test('los formularios documentales conservan campos ingresados consecutivamente', () => {
  const source = readFrontend('src/StudentDocuments.jsx');

  assert.match(source, /const updateField = \(setter, field\) => \(event\) =>/u);
  assert.match(source, /setter\(\(current\) => \(\{ \.\.\.current, \[field\]: value \}\)\)/u);
  assert.match(source, /setGenerate\(\(current\) => \(\{ \.\.\.current, valores:/u);
  assert.doesNotMatch(source, /set(?:Form|TemplateForm|Generate|Signature)\(\{ \.\.\.(?:form|templateForm|generate|signature),/u);
});

test('la tabla documental se transforma en tarjetas tocables sin ampliar el viewport móvil', () => {
  const source = readFrontend('src/StudentDocuments.jsx');
  const styles = readFrontend('src/styles/student-documents.css');
  const institutionalStyles = readFrontend('src/styles/institutional.css');

  for (const label of ['Estudiante', 'Documento', 'Vigencia', 'Responsable', 'Acción']) {
    assert.match(source, new RegExp(`data-label="${label}"`, 'u'));
  }
  assert.match(source, /students-table--cards/u);
  assert.equal((source.match(/className="students-cell-name"/gu) || []).length >= 2, true);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]+\.docs-table \{ min-width: 0;/u);
  assert.match(institutionalStyles, /body\s*\{[\s\S]*--primary:\s*var\(--navy\);[\s\S]*--text-dark:\s*var\(--ink\);/u);
});
