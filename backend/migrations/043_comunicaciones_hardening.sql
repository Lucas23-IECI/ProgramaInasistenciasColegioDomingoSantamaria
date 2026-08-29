-- Ajustes de compatibilidad detectados durante la revisión integral de comunicaciones.
-- Es una migración aditiva para cubrir instalaciones que ya aplicaron la migración 042.

ALTER TABLE notificaciones_internas
  ALTER COLUMN detalle TYPE VARCHAR(1000);

CREATE INDEX IF NOT EXISTS idx_notificaciones_internas_usuario_fecha
  ON notificaciones_internas (usuario_id, creada_en DESC, id_notificacion DESC);
