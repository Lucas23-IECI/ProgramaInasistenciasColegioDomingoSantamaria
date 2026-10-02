import assert from 'node:assert/strict';
import test from 'node:test';

import { hasAnyPermission, hasPermission, roleLabel } from '../src/permissions.js';
import { contextMeta, contextQueryFromConversation, safeInternalPath } from '../src/utils/chatContext.js';
import {
  cleanRutInput,
  formatChilePhoneInput,
  formatDocumentInput,
  formatRutInput,
  validateRutInput,
} from '../src/utils/personFormat.js';
import {
  getStudentDisplayName,
  getStudentIdentifier,
  getStudentIdentifierLabel,
  getStudentMaskedRut,
  getStudentRut,
} from '../src/utils/studentFormat.js';

test('los permisos y cargos conservan compatibilidad con perfiles configurables', () => {
  const user = { permissions: ['chat.access', 'notifications.view'] };
  assert.equal(hasPermission(user, 'chat.access'), true);
  assert.equal(hasPermission(user, 'chat.send'), false);
  assert.equal(hasPermission(null, 'chat.access'), false);
  assert.equal(hasAnyPermission(user, ['documents.view', 'notifications.view']), true);
  assert.equal(hasAnyPermission(user, ['documents.view']), false);
  assert.equal(roleLabel('admin'), 'Administrador');
  assert.equal(roleLabel('convivencia'), 'Convivencia Escolar');
  assert.equal(roleLabel('perfil_creado'), 'perfil_creado');
  assert.equal(roleLabel(''), 'Usuario');
});

test('el formato de personas cubre entradas incompletas, móviles y documentos generales', () => {
  assert.equal(cleanRutInput(null), '');
  assert.equal(cleanRutInput('12.345.678-k extra'), '12345678K');
  assert.equal(formatRutInput(''), '');
  assert.equal(formatRutInput('5'), '5');
  assert.equal(formatRutInput('000000005'), '0-5');
  assert.equal(validateRutInput('5'), false);
  assert.equal(validateRutInput('12.345.678-5'), true);
  assert.equal(validateRutInput('12.345.678-6'), false);
  assert.equal(formatChilePhoneInput(''), '');
  assert.equal(formatChilePhoneInput('0056987654321'), '+56 9 8765 4321');
  assert.equal(formatChilePhoneInput('412345678'), '+56 41 234 5678');
  assert.equal(formatDocumentInput('RUT', '123456785'), '12.345.678-5');
  assert.equal(formatDocumentInput('PASAPORTE', ' ab 12 '), ' AB 12 ');
});

test('la presentación estudiantil prioriza identidades sin ocultar sus alternativas', () => {
  assert.equal(getStudentDisplayName(null), 'Persona sin nombre');
  assert.equal(getStudentDisplayName({ name: '  Ana Soto  ' }), 'Ana Soto');
  assert.equal(getStudentDisplayName({ nombres: 'Ana', paterno: 'Soto', materno: '' }), 'Ana Soto');
  assert.equal(getStudentDisplayName({}), 'Persona sin nombre');
  assert.equal(getStudentRut({}), 'RUT no informado');
  assert.equal(getStudentRut({ rut: '12345678' }), '12345678');
  assert.equal(getStudentRut({ rut: '12345678', dv: '5' }), '12345678-5');

  assert.equal(getStudentIdentifier({ documento_mostrado: 'IPE 1000000001' }), 'IPE 1000000001');
  assert.equal(getStudentIdentifier({ rut: '12345678', dv: '5' }), '12345678-5');
  assert.equal(getStudentIdentifier({ documento_erp: 'ERP-1' }), 'ERP-1');
  assert.equal(getStudentIdentifier({ uuid_erp: 'UUID-1' }), 'UUID-1');
  assert.equal(getStudentIdentifier({ codigo_barra: 'BAR-1' }), 'BAR-1');
  assert.equal(getStudentIdentifier({}), 'Identificador no informado');
  assert.equal(getStudentMaskedRut({ uuid_erp: 'UUID-2' }), 'UUID-2');

  const labels = [
    [{ tipo_identificador: 'RUN_CHILE' }, 'RUN chileno'],
    [{ tipo_identificador: 'IPE_MINEDUC' }, 'IPE Mineduc'],
    [{ tipo_identificador: 'DOCUMENTO_EXTRANJERO', tipo_documento_extranjero: 'PASAPORTE' }, 'Pasaporte'],
    [{ tipo_identificador: 'DOCUMENTO_EXTRANJERO', tipo_documento_extranjero: 'DNI' }, 'DNI extranjero'],
    [{ tipo_identificador: 'DOCUMENTO_EXTRANJERO', tipo_documento_extranjero: 'CEDULA' }, 'Cédula extranjera'],
    [{ tipo_identificador: 'DOCUMENTO_EXTRANJERO' }, 'Documento extranjero'],
    [{ tipo_identificador: 'SIN_IDENTIFICADOR_MANUAL' }, 'Código institucional'],
    [{ rut: '1' }, 'RUN chileno'],
    [{ documento_erp: 'ERP' }, 'Documento ERP'],
    [{ uuid_erp: 'UUID' }, 'ID ERP'],
    [{ codigo_barra: 'BAR' }, 'Código institucional'],
    [{}, 'Identificador'],
  ];
  for (const [student, expected] of labels) assert.equal(getStudentIdentifierLabel(student), expected);
  assert.equal(getStudentIdentifierLabel({ identity: { identityType: 'DOCUMENTO_EXTRANJERO', foreignDocumentType: 'DNI' } }), 'DNI extranjero');
});

test('el contexto del chat resuelve todos los módulos y rechaza retornos externos', () => {
  assert.equal(safeInternalPath('/admin/seguimiento/2'), '/admin/seguimiento/2');
  assert.equal(safeInternalPath('admin/sin-barra', '/seguro'), '/seguro');
  assert.equal(safeInternalPath('/admin\\engaño', '/seguro'), '/seguro');
  assert.equal(contextQueryFromConversation(null), '');
  assert.equal(contextQueryFromConversation({ contexto_tipo: 'OTRO', contexto_id: 1 }), '');
  assert.equal(contextQueryFromConversation({ contexto_tipo: 'VISITA', contexto_id: '' }), '');

  const types = ['SEGUIMIENTO', 'CONVIVENCIA', 'DOCUMENTO_ESTUDIANTE', 'DOCUMENTO', 'ESTUDIANTE', 'VISITA', 'RETIRO'];
  for (const type of types) {
    const query = contextQueryFromConversation({ contexto_tipo: type, contexto_id: '7', conversacion_nombre: 'Coordinación QA' });
    assert.match(query, new RegExp(`contexto_tipo=${type}`));
    assert.ok(contextMeta(type).label);
    assert.ok(contextMeta(type).prefix);
  }
  assert.deepEqual(contextMeta('DESCONOCIDO'), { label: 'registro institucional', prefix: 'Coordinación' });
});
