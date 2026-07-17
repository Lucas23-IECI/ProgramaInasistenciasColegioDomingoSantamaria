-- Modelo operacional exclusivo para ingresos y atrasos trazables.
ALTER TABLE configuracion_asistencia
  ADD COLUMN IF NOT EXISTS nombre_jornada VARCHAR(80) NOT NULL DEFAULT 'Jornada principal',
  ADD COLUMN IF NOT EXISTS minutos_atraso_grave INT NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS umbral_alerta INT NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS umbral_critico INT NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS actualizado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE configuracion_asistencia
  DROP CONSTRAINT IF EXISTS ck_config_minutos_grave,
  DROP CONSTRAINT IF EXISTS ck_config_umbral_alerta,
  DROP CONSTRAINT IF EXISTS ck_config_umbral_critico;

ALTER TABLE configuracion_asistencia
  ADD CONSTRAINT ck_config_minutos_grave CHECK (minutos_atraso_grave BETWEEN 1 AND 180),
  ADD CONSTRAINT ck_config_umbral_alerta CHECK (umbral_alerta BETWEEN 1 AND 50),
  ADD CONSTRAINT ck_config_umbral_critico CHECK (umbral_critico BETWEEN 2 AND 100 AND umbral_critico > umbral_alerta);

CREATE UNIQUE INDEX IF NOT EXISTS uq_configuracion_asistencia_singleton
  ON configuracion_asistencia ((true));

ALTER TABLE attendance_registrations
  ADD COLUMN IF NOT EXISTS origen VARCHAR(20) NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS registrado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS corregido_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS corregido_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS motivo_correccion VARCHAR(500),
  ADD COLUMN IF NOT EXISTS anulado BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS anulado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS anulado_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS motivo_anulacion VARCHAR(500),
  ADD COLUMN IF NOT EXISTS regularizado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS regularizado_en TIMESTAMPTZ;

UPDATE attendance_registrations
SET origen = COALESCE(NULLIF(origen, ''), 'legacy'),
    creado_en = COALESCE(creado_en, "timestamp"::timestamptz, fecha::timestamp + hora),
    version = GREATEST(COALESCE(version, 1), 1);

ALTER TABLE attendance_registrations
  DROP CONSTRAINT IF EXISTS uq_asistencia_alumno_fecha_tipo;

DROP INDEX IF EXISTS uq_asistencia_alumno_fecha_tipo;

CREATE UNIQUE INDEX IF NOT EXISTS uq_puntualidad_registro_activo
  ON attendance_registrations (id_alumno, fecha, tipo_registro)
  WHERE anulado = false;

CREATE INDEX IF NOT EXISTS idx_puntualidad_fecha_estado_activo
  ON attendance_registrations (fecha DESC, estado, hora)
  WHERE anulado = false AND tipo_registro = 'Entrada';

CREATE INDEX IF NOT EXISTS idx_puntualidad_registrado_por
  ON attendance_registrations (registrado_por, creado_en DESC);

CREATE TABLE IF NOT EXISTS puntualidad_correcciones (
  id BIGSERIAL PRIMARY KEY,
  id_registro INT NOT NULL REFERENCES attendance_registrations(id_registro) ON DELETE RESTRICT,
  accion VARCHAR(30) NOT NULL CHECK (accion IN ('CORREGIR', 'ANULAR', 'JUSTIFICAR', 'REVOCAR_JUSTIFICACION')),
  motivo VARCHAR(500) NOT NULL,
  antes JSONB NOT NULL,
  despues JSONB NOT NULL,
  realizado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  realizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_puntualidad_correcciones_registro
  ON puntualidad_correcciones (id_registro, realizado_en DESC);

