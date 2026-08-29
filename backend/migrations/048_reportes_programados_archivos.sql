ALTER TABLE reportes_institucionales_ejecuciones
  ADD COLUMN IF NOT EXISTS archivo_nombre VARCHAR(220),
  ADD COLUMN IF NOT EXISTS archivo_mime VARCHAR(120),
  ADD COLUMN IF NOT EXISTS archivo_bytes BYTEA,
  ADD COLUMN IF NOT EXISTS error_publico VARCHAR(500),
  ADD COLUMN IF NOT EXISTS reintento_de BIGINT REFERENCES reportes_institucionales_ejecuciones(id_ejecucion) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_reportes_ejecuciones_programacion_fecha
  ON reportes_institucionales_ejecuciones (id_reporte, generado_en DESC);

CREATE INDEX IF NOT EXISTS idx_reportes_ejecuciones_reintento
  ON reportes_institucionales_ejecuciones (reintento_de)
  WHERE reintento_de IS NOT NULL;
