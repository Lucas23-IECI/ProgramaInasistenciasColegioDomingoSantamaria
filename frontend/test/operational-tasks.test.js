import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('las tareas internas respetan permisos y exponen creación, asignación, estado e historial', () => {
  const source = read('src/OperationalInbox.jsx');
  const permissions = read('src/permissions.js');

  assert.match(permissions, /OPERATIONS_TASKS_MANAGE: 'operations\.tasks\.manage'/u);
  assert.match(source, /hasPermission\(user, PERMISSIONS\.OPERATIONS_TASKS_MANAGE\)/u);
  assert.match(source, /\/operaciones\/tareas\/responsables/u);
  assert.match(source, /axios\.post\(`\$\{API_URL\}\/operaciones\/tareas`/u);
  assert.match(source, /\/operaciones\/tareas\/\$\{taskId\}/u);
  assert.match(source, /\/operaciones\/tareas\/\$\{resolution\.id\}\/estado/u);
  assert.match(source, /Historial trazable/u);
  assert.match(source, /Motivo de resolución/u);
  assert.match(source, /createPortal\(/u);
  assert.match(source, /operations-modal-backdrop/u);
  assert.match(source, /id="resolution-reason"/u);
  assert.match(source, /aria-invalid=\{Boolean\(resolution\.error\)\}/u);
  assert.match(source, /id="resolution-reason-error"/u);
  assert.doesNotMatch(source, /notify\('Indica un motivo de al menos 5 caracteres\.'/u);
});

test('el formulario es explícito, accesible y conserva la observación real del cierre', () => {
  const source = read('src/OperationalInbox.jsx');

  for (const label of ['Título de la tarea', 'Prioridad', 'Responsable', 'Fecha límite', 'Detalle opcional']) {
    assert.match(source, new RegExp(label, 'u'));
  }
  assert.match(source, /\{ observaciones: observations \}/u);
  assert.match(source, /Crea un compromiso sin modificar visitas, retiros, atrasos/u);
  assert.match(source, /No fue posible cargar las personas responsables/u);
  assert.doesNotMatch(source, /setTaskForm\(\{ \.\.\.taskForm/u, 'las ediciones rápidas no deben sobrescribir campos hermanos con un estado obsoleto');
  assert.match(source, /const \{ value \} = event\.currentTarget/u, 'el valor debe capturarse antes de programar la actualización de React');
  assert.match(source, /setTaskForm\(\(current\) => \(\{ \.\.\.current, \[field\]: value \}\)\)/u);
  assert.match(source, /onChange=\{updateTaskFormField\('fecha_limite'\)\}/u);
});

test('la interfaz de tareas tiene jerarquía, foco y adaptación móvil', () => {
  const css = read('src/styles/operations.css');
  assert.match(css, /\.operations-task-item/u);
  assert.match(css, /\.operations-task-create/u);
  assert.match(css, /\.operations-task-timeline/u);
  assert.match(css, /\.operations-health span \{ color: var\(--muted, #536a77\)/u);
  assert.match(css, /background: var\(--surface-raised, #fff\)/u);
  assert.match(css, /:focus-visible/u);
  assert.match(css, /@media \(max-width: 800px\)[\s\S]*operations-task-create form/u);
  assert.match(css, /@media \(max-width: 430px\)[\s\S]*operations-task-detail__summary/u);
});

test('la ayuda vigente explica creación, permisos e historial de las tareas internas', () => {
  const help = read('src/help/tours.js');
  assert.match(help, /operations-internal-tasks/u);
  assert.match(help, /crear una tarea, asignarla y fijar un plazo/u);
  assert.match(help, /quién lo realizó, cuándo ocurrió y el motivo de cierre/u);
});
