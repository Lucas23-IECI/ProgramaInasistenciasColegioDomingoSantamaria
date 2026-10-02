-- Reversión compensatoria de importaciones ERP sin borrar fichas ni trazabilidad.

ALTER TABLE importaciones_estudiantes
  ADD COLUMN IF NOT EXISTS version_reversion SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS revertida_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revertida_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS motivo_reversion VARCHAR(500),
  ADD COLUMN IF NOT EXISTS resumen_reversion JSONB;

ALTER TABLE importaciones_estudiantes
  DROP CONSTRAINT IF EXISTS importaciones_estudiantes_estado_check;

ALTER TABLE importaciones_estudiantes
  ADD CONSTRAINT importaciones_estudiantes_estado_check
  CHECK (estado IN ('COMPLETADA', 'COMPLETADA_CON_ERRORES', 'RECHAZADA', 'REVERTIDA'));

CREATE TABLE IF NOT EXISTS importacion_estudiante_reversiones (
  id BIGSERIAL PRIMARY KEY,
  importacion_id BIGINT NOT NULL REFERENCES importaciones_estudiantes(id) ON DELETE RESTRICT,
  cambio_id BIGINT REFERENCES importacion_estudiante_cambios(id) ON DELETE SET NULL,
  id_alumno INT REFERENCES alumno(id_alumno) ON DELETE SET NULL,
  resultado VARCHAR(24) NOT NULL CHECK (resultado IN ('REVERTIDO', 'OMITIDO')),
  detalle VARCHAR(500),
  revertido_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  revertido_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_importacion_reversiones_importacion
  ON importacion_estudiante_reversiones (importacion_id, revertido_en DESC);
