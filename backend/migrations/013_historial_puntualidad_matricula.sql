-- Conserva el contexto real de cada matrícula e ingreso sin reinterpretar el pasado.

ALTER TABLE matricula
  ADD COLUMN IF NOT EXISTS vigente_desde DATE,
  ADD COLUMN IF NOT EXISTS vigente_hasta DATE,
  ADD COLUMN IF NOT EXISTS motivo_cambio VARCHAR(500),
  ADD COLUMN IF NOT EXISTS creado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS actualizado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE matricula
SET vigente_desde = COALESCE(vigente_desde, fecha_registro::date, CURRENT_DATE)
WHERE vigente_desde IS NULL;

ALTER TABLE matricula
  ALTER COLUMN vigente_desde SET NOT NULL,
  DROP CONSTRAINT IF EXISTS uq_matricula_alumno,
  DROP CONSTRAINT IF EXISTS ck_matricula_vigencia;

DROP INDEX IF EXISTS uq_matricula_alumno;

ALTER TABLE matricula
  ADD CONSTRAINT ck_matricula_vigencia
  CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde);

CREATE UNIQUE INDEX IF NOT EXISTS uq_matricula_vigente_alumno
  ON matricula (id_alumno)
  WHERE vigente_hasta IS NULL;

CREATE INDEX IF NOT EXISTS idx_matricula_alumno_vigencia
  ON matricula (id_alumno, vigente_desde DESC, vigente_hasta);

CREATE OR REPLACE VIEW matricula_actual AS
SELECT *
FROM matricula
WHERE vigente_hasta IS NULL;

ALTER TABLE configuracion_asistencia
  ADD COLUMN IF NOT EXISTS version_regla INT NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS configuracion_puntualidad_versiones (
  version_regla INT PRIMARY KEY,
  configuracion_id INT NOT NULL REFERENCES configuracion_asistencia(id) ON DELETE RESTRICT,
  nombre_jornada VARCHAR(80) NOT NULL,
  hora_entrada TIME NOT NULL,
  hora_limite_atraso TIME NOT NULL,
  minutos_atraso_grave INT NOT NULL,
  umbral_alerta INT NOT NULL,
  umbral_critico INT NOT NULL,
  vigente_desde TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  motivo VARCHAR(500) NOT NULL DEFAULT 'Versión inicial migrada'
);

INSERT INTO configuracion_puntualidad_versiones (
  version_regla, configuracion_id, nombre_jornada, hora_entrada,
  hora_limite_atraso, minutos_atraso_grave, umbral_alerta, umbral_critico,
  vigente_desde, creado_por, motivo
)
SELECT version_regla, id, nombre_jornada, hora_entrada, hora_limite_atraso,
       minutos_atraso_grave, umbral_alerta, umbral_critico,
       COALESCE(actualizado_en, CURRENT_TIMESTAMP), actualizado_por,
       'Versión inicial migrada'
FROM configuracion_asistencia
ON CONFLICT (version_regla) DO NOTHING;

ALTER TABLE attendance_registrations
  ADD COLUMN IF NOT EXISTS id_matricula_registro INT REFERENCES matricula(id_matricula) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS id_curso_registro INT REFERENCES curso(id_curso) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS curso_registro VARCHAR(120),
  ADD COLUMN IF NOT EXISTS jornada_registro VARCHAR(80),
  ADD COLUMN IF NOT EXISTS hora_entrada_aplicada TIME,
  ADD COLUMN IF NOT EXISTS hora_limite_aplicada TIME,
  ADD COLUMN IF NOT EXISTS minutos_atraso_grave_aplicado INT,
  ADD COLUMN IF NOT EXISTS minutos_atraso INT,
  ADD COLUMN IF NOT EXISTS version_regla INT,
  ADD COLUMN IF NOT EXISTS snapshot_migrado BOOLEAN NOT NULL DEFAULT false;

WITH contexto AS (
  SELECT r0.id_registro,
         m0.id_matricula,
         m0.id_curso,
         c0.nombre_curso,
         cfg0.nombre_jornada,
         cfg0.hora_entrada,
         cfg0.hora_limite_atraso,
         cfg0.minutos_atraso_grave,
         cfg0.version_regla
  FROM attendance_registrations r0
  CROSS JOIN LATERAL (
    SELECT nombre_jornada, hora_entrada, hora_limite_atraso, minutos_atraso_grave, version_regla
    FROM configuracion_asistencia
    LIMIT 1
  ) cfg0
  LEFT JOIN LATERAL (
    SELECT mx.id_matricula, mx.id_curso
    FROM matricula mx
    WHERE mx.id_alumno = r0.id_alumno
      AND mx.vigente_desde <= r0.fecha
      AND (mx.vigente_hasta IS NULL OR mx.vigente_hasta >= r0.fecha)
    ORDER BY mx.vigente_desde DESC, mx.id_matricula DESC
    LIMIT 1
  ) m0 ON true
  LEFT JOIN curso c0 ON c0.id_curso = m0.id_curso
)
UPDATE attendance_registrations r
SET id_matricula_registro = COALESCE(r.id_matricula_registro, m.id_matricula),
    id_curso_registro = COALESCE(r.id_curso_registro, m.id_curso),
    curso_registro = COALESCE(r.curso_registro, m.nombre_curso, 'Sin curso informado'),
    jornada_registro = COALESCE(r.jornada_registro, m.nombre_jornada),
    hora_entrada_aplicada = COALESCE(r.hora_entrada_aplicada, m.hora_entrada),
    hora_limite_aplicada = COALESCE(r.hora_limite_aplicada, m.hora_limite_atraso),
    minutos_atraso_grave_aplicado = COALESCE(r.minutos_atraso_grave_aplicado, m.minutos_atraso_grave),
    minutos_atraso = COALESCE(
      r.minutos_atraso,
      CASE
        WHEN r.estado = 'Atrasado'
          THEN GREATEST(1, CEIL(EXTRACT(EPOCH FROM (r.hora - m.hora_limite_atraso)) / 60))::int
        ELSE 0
      END
    ),
    version_regla = COALESCE(r.version_regla, m.version_regla),
    snapshot_migrado = true
FROM contexto m
WHERE m.id_registro = r.id_registro
  AND (r.jornada_registro IS NULL
   OR r.hora_entrada_aplicada IS NULL
   OR r.hora_limite_aplicada IS NULL
   OR r.minutos_atraso_grave_aplicado IS NULL
   OR r.minutos_atraso IS NULL
   OR r.version_regla IS NULL);

ALTER TABLE attendance_registrations
  ALTER COLUMN jornada_registro SET NOT NULL,
  ALTER COLUMN hora_entrada_aplicada SET NOT NULL,
  ALTER COLUMN hora_limite_aplicada SET NOT NULL,
  ALTER COLUMN minutos_atraso_grave_aplicado SET NOT NULL,
  ALTER COLUMN minutos_atraso SET NOT NULL,
  ALTER COLUMN version_regla SET NOT NULL,
  DROP CONSTRAINT IF EXISTS ck_registro_minutos_atraso;

ALTER TABLE attendance_registrations
  ADD CONSTRAINT ck_registro_minutos_atraso CHECK (minutos_atraso >= 0);

CREATE INDEX IF NOT EXISTS idx_puntualidad_curso_historico
  ON attendance_registrations (id_curso_registro, fecha DESC)
  WHERE anulado = false AND tipo_registro = 'Entrada';
