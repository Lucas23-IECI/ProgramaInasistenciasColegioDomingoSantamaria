const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildQualityRows,
  buildStudentWorkbook,
  getPrimaryIdentifier,
  maskIdentifier
} = require('../services/studentExportService');

const students = [
  {
    id_alumno: 10,
    nombre: 'Estudiante de Prueba',
    curso: '2° Medio',
    telefono: '+56 9 5555 5555',
    origen_alta: 'ERP',
    erp_vinculado_en: '2026-07-01T10:00:00.000Z',
    activo: true,
    fecha_actualizacion: '2026-07-29T10:00:00.000Z',
    estado_matricula: 'VIGENTE',
    tiene_apoderado: true,
    identifiers: [
      {
        tipo: 'RUN_CHILE',
        valor_original: '12.345.678-5',
        pais_emisor: 'CHL',
        fuente: 'ERP',
        estado: 'PRINCIPAL',
        es_principal: true,
        nivel_validacion: 'DV_VERIFICADO',
        vigente_desde: '2026-03-01',
        actualizado_en: '2026-07-29T10:00:00.000Z'
      },
      {
        tipo: 'ID_ERP',
        valor_original: 'erp-test-10',
        fuente: 'ERP',
        estado: 'VIGENTE',
        es_principal: false,
        nivel_validacion: 'ID_ERP',
        vigente_desde: '2026-03-01',
        actualizado_en: '2026-07-29T10:00:00.000Z'
      }
    ]
  },
  {
    id_alumno: 11,
    nombre: 'Ficha Pendiente',
    curso: null,
    telefono: '',
    origen_alta: 'MANUAL',
    erp_vinculado_en: null,
    activo: true,
    fecha_actualizacion: '2026-07-29T10:00:00.000Z',
    estado_matricula: 'SIN_MATRICULA',
    tiene_apoderado: false,
    identifiers: [{
      tipo: 'IPE_MINEDUC',
      valor_original: '100123456',
      pais_emisor: 'CHL',
      fuente: 'MANUAL',
      estado: 'PRINCIPAL',
      es_principal: true,
      nivel_validacion: 'FUENTE_MINEDUC_ERP',
      vigente_desde: '2026-07-29',
      actualizado_en: '2026-07-29T10:00:00.000Z'
    }]
  }
];

test('protege RUN, IPE y documentos generales sin devolver el valor completo', () => {
  assert.equal(maskIdentifier('RUN_CHILE', '12.345.678-5').includes('12.345.678-5'), false);
  assert.equal(maskIdentifier('IPE_MINEDUC', '100123456').includes('100123456'), false);
  assert.equal(maskIdentifier('PASAPORTE', 'AB123456').includes('AB123456'), false);
  assert.match(maskIdentifier('RUN_CHILE', '12.345.678-5'), /\*/);
});

test('elige el identificador principal y calcula incidencias operativas', () => {
  assert.equal(getPrimaryIdentifier(students[0]).tipo, 'RUN_CHILE');
  const rows = buildQualityRows(students);
  assert.equal(rows.some((row) => row.id_alumno === 10), false);
  assert.equal(rows.some((row) => row.id_alumno === 11 && row.incidencia === 'Sin curso vigente'), true);
  assert.equal(rows.some((row) => row.id_alumno === 11 && row.incidencia === 'IPE pendiente de regularización'), true);
});

test('genera los tres libros XLSX y mantiene separada la salida restringida', async () => {
  for (const scope of ['operational', 'administrative', 'quality']) {
    const buffer = await buildStudentWorkbook({ scope, students });
    assert.ok(Buffer.isBuffer(buffer));
    assert.ok(buffer.length > 5000);
    assert.equal(buffer.subarray(0, 2).toString(), 'PK');
  }
});
