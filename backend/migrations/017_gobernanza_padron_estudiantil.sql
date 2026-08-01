-- Trazabilidad institucional de altas manuales, importaciones ERP y fusiones.

ALTER TABLE alumno
  ADD COLUMN IF NOT EXISTS motivo_alta_manual VARCHAR(50),
  ADD COLUMN IF NOT EXISTS detalle_alta_manual VARCHAR(500),
  ADD COLUMN IF NOT EXISTS creado_manualmente_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fusionado_en_id INT REFERENCES alumno(id_alumno) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS fusionado_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fusionado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS motivo_fusion VARCHAR(500);

UPDATE alumno
SET motivo_alta_manual = COALESCE(motivo_alta_manual, 'REGULARIZACION_INSTITUCIONAL'),
    creado_manualmente_en = COALESCE(creado_manualmente_en, fecha_actualizacion, CURRENT_TIMESTAMP)
WHERE origen_alta = 'MANUAL';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_alumno_motivo_alta_manual'
  ) THEN
    ALTER TABLE alumno
      ADD CONSTRAINT ck_alumno_motivo_alta_manual
      CHECK (
        motivo_alta_manual IS NULL OR motivo_alta_manual IN (
          'MATRICULA_RECIENTE',
          'TRASLADO_ESTABLECIMIENTO',
          'PENDIENTE_ERP',
          'ERROR_TEMPORAL_ERP',
          'REGULARIZACION_INSTITUCIONAL',
          'OTRO'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_alumno_fusion_consistente'
  ) THEN
    ALTER TABLE alumno
      ADD CONSTRAINT ck_alumno_fusion_consistente
      CHECK (
        (fusionado_en_id IS NULL AND fusionado_en IS NULL AND fusionado_por IS NULL)
        OR
        (fusionado_en_id IS NOT NULL AND fusionado_en IS NOT NULL AND activo = false)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_alumno_manual_pendiente
  ON alumno (creado_manualmente_en DESC)
  WHERE origen_alta = 'MANUAL' AND erp_vinculado_en IS NULL AND fusionado_en_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_alumno_fusionado_en
  ON alumno (fusionado_en_id)
  WHERE fusionado_en_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS importaciones_estudiantes (
  id BIGSERIAL PRIMARY KEY,
  nombre_archivo VARCHAR(255) NOT NULL,
  hash_archivo VARCHAR(128) NOT NULL,
  modo VARCHAR(20) NOT NULL CHECK (modo IN ('PARCIAL', 'COMPLETA')),
  estado VARCHAR(32) NOT NULL DEFAULT 'COMPLETADA'
    CHECK (estado IN ('COMPLETADA', 'COMPLETADA_CON_ERRORES', 'RECHAZADA')),
  total_filas INT NOT NULL DEFAULT 0,
  filas_creadas INT NOT NULL DEFAULT 0,
  filas_actualizadas INT NOT NULL DEFAULT 0,
  filas_sin_cambios INT NOT NULL DEFAULT 0,
  filas_vinculadas INT NOT NULL DEFAULT 0,
  filas_retiradas INT NOT NULL DEFAULT 0,
  filas_rechazadas INT NOT NULL DEFAULT 0,
  resumen JSONB NOT NULL DEFAULT '{}'::jsonb,
  importado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  importado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_importaciones_estudiantes_fecha
  ON importaciones_estudiantes (importado_en DESC);

CREATE INDEX IF NOT EXISTS idx_importaciones_estudiantes_hash
  ON importaciones_estudiantes (hash_archivo, importado_en DESC);

CREATE TABLE IF NOT EXISTS importacion_estudiante_cambios (
  id BIGSERIAL PRIMARY KEY,
  importacion_id BIGINT NOT NULL REFERENCES importaciones_estudiantes(id) ON DELETE CASCADE,
  numero_fila INT,
  id_alumno INT REFERENCES alumno(id_alumno) ON DELETE SET NULL,
  accion VARCHAR(40) NOT NULL CHECK (accion IN (
    'CREADO',
    'ACTUALIZADO',
    'SIN_CAMBIOS',
    'VINCULADO_MANUAL',
    'REACTIVADO_DESDE_ERP',
    'RETIRADO_POR_NOMINA',
    'RECHAZADO',
    'CONFLICTO'
  )),
  rut_referencia VARCHAR(16),
  comparacion JSONB NOT NULL DEFAULT '[]'::jsonb,
  anterior JSONB,
  posterior JSONB,
  mensaje VARCHAR(1000),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_importacion_cambios_importacion
  ON importacion_estudiante_cambios (importacion_id, numero_fila, id);

CREATE INDEX IF NOT EXISTS idx_importacion_cambios_alumno
  ON importacion_estudiante_cambios (id_alumno, creado_en DESC);

CREATE TABLE IF NOT EXISTS fusiones_alumnos (
  id BIGSERIAL PRIMARY KEY,
  alumno_principal_id INT NOT NULL REFERENCES alumno(id_alumno) ON DELETE RESTRICT,
  alumno_duplicado_id INT NOT NULL REFERENCES alumno(id_alumno) ON DELETE RESTRICT,
  motivo VARCHAR(500) NOT NULL,
  resumen JSONB NOT NULL DEFAULT '{}'::jsonb,
  fusionado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  fusionado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_fusion_alumnos_distintos CHECK (alumno_principal_id <> alumno_duplicado_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fusion_alumno_duplicado
  ON fusiones_alumnos (alumno_duplicado_id);
