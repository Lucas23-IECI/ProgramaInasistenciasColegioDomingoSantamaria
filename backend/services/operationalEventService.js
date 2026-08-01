const EVENT_TYPES = new Set([
  'INGRESO_DUPLICADO',
  'CODIGO_NO_ENCONTRADO',
  'IMPORTACION_RECHAZADA',
  'VISITA_ABIERTA',
  'RETIRO_PENDIENTE',
  'OTRO'
]);

const recordOperationalEvent = async (queryable, event = {}) => {
  const type = EVENT_TYPES.has(event.type) ? event.type : 'OTRO';
  const entityId = Number.isInteger(Number(event.entityId)) ? Number(event.entityId) : null;
  const userId = Number.isInteger(Number(event.userId)) ? Number(event.userId) : null;

  const result = await queryable.query(
    `INSERT INTO eventos_operacionales (
       tipo, entidad, entidad_id, detalle, registrado_por
     ) VALUES ($1, $2, $3, $4::jsonb, $5)
     RETURNING id, tipo, estado, ocurrido_en`,
    [
      type,
      String(event.entity || '').trim().slice(0, 60) || null,
      entityId,
      JSON.stringify(event.detail || {}),
      userId
    ]
  );
  return result.rows[0];
};

module.exports = {
  EVENT_TYPES,
  recordOperationalEvent
};
