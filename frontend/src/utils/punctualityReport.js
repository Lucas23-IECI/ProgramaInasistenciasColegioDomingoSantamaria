const fullName = (row) => [row.paterno, row.materno, row.nombres].filter(Boolean).join(' ');

const justificationLabel = (row) => row.justificado ? 'Sí' : 'No';

export const buildDetailedRows = (records) => [
  ['N°', 'Fecha', 'Hora', 'Minutos de atraso', 'Severidad', 'Justificado', 'Tipo de respaldo', 'Documento', 'Apellidos y nombres', 'RUT', 'Curso', 'Observación'],
  ...records.map((row, index) => [
    index + 1,
    row.fecha,
    String(row.hora || '').slice(0, 5),
    Number(row.minutos_atraso || 0),
    row.severidad,
    justificationLabel(row),
    row.tipo_justificacion || '',
    row.documento_nombre || '',
    fullName(row),
    `${row.rut}-${row.dv}`,
    row.curso || 'Sin curso',
    row.comentario_justificacion || ''
  ])
];

export const buildSummaryRows = (records) => {
  const grouped = new Map();
  records.forEach((row) => {
    const key = String(row.id_alumno);
    if (!grouped.has(key)) {
      grouped.set(key, {
        nombre: fullName(row),
        rut: `${row.rut}-${row.dv}`,
        curso: row.curso || 'Sin curso',
        total: 0,
        leves: 0,
        graves: 0,
        justificados: 0,
        documentos: 0,
        minutos: 0,
        ultimo: ''
      });
    }
    const item = grouped.get(key);
    item.total += 1;
    item.leves += row.severidad === 'Leve' ? 1 : 0;
    item.graves += row.severidad === 'Grave' ? 1 : 0;
    item.justificados += row.justificado ? 1 : 0;
    item.documentos += row.documento_id ? 1 : 0;
    item.minutos += Number(row.minutos_atraso || 0);
    if (!item.ultimo || row.fecha > item.ultimo) item.ultimo = row.fecha;
  });

  const people = [...grouped.values()].sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre, 'es'));
  return [
    ['N°', 'Apellidos y nombres', 'RUT', 'Curso', 'Total atrasos', 'Leves', 'Graves', 'Justificados', 'Con documento', 'Promedio minutos', 'Último atraso'],
    ...people.map((item, index) => [
      index + 1,
      item.nombre,
      item.rut,
      item.curso,
      item.total,
      item.leves,
      item.graves,
      item.justificados,
      item.documentos,
      Number((item.minutos / item.total).toFixed(1)),
      item.ultimo
    ])
  ];
};

export const reportFileName = ({ scope, from, to }) => {
  const safeScope = String(scope || 'institucional').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '_');
  return `atrasos_${safeScope}_${from}_${to}.xlsx`;
};
