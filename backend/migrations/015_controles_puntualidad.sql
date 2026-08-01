-- Controles de puntualidad versionados para ingreso, recreos, almuerzo y otros hitos.
CREATE TABLE IF NOT EXISTS controles_puntualidad (
  id BIGSERIAL PRIMARY KEY,
  configuracion_id INT NOT NULL REFERENCES configuracion_asistencia(id) ON DELETE RESTRICT,
  codigo VARCHAR(60) NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  tipo VARCHAR(30) NOT NULL DEFAULT 'OTRO',
  hora_apertura TIME NOT NULL,
  hora_referencia TIME NOT NULL,
  hora_inicio_atraso TIME NOT NULL,
  hora_cierre TIME NOT NULL,
  minutos_atraso_grave INT NOT NULL DEFAULT 15,
  dias_semana SMALLINT[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]::SMALLINT[],
  cursos_ids INT[] NOT NULL DEFAULT ARRAY[]::INT[],
  cuenta_alertas BOOLEAN NOT NULL DEFAULT true,
  activo BOOLEAN NOT NULL DEFAULT true,
  orden INT NOT NULL DEFAULT 0,
  version INT NOT NULL DEFAULT 1,
  creado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  actualizado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_controles_puntualidad_codigo UNIQUE (configuracion_id, codigo),
  CONSTRAINT ck_control_tipo CHECK (tipo IN ('INGRESO', 'REGRESO_RECREO', 'REGRESO_ALMUERZO', 'TALLER', 'OTRO')),
  CONSTRAINT ck_control_nombre CHECK (char_length(trim(nombre)) BETWEEN 3 AND 100),
  CONSTRAINT ck_control_horas CHECK (
    hora_apertura <= hora_referencia
    AND hora_referencia < hora_inicio_atraso
    AND hora_inicio_atraso < hora_cierre
  ),
  CONSTRAINT ck_control_grave CHECK (minutos_atraso_grave BETWEEN 1 AND 180),
  CONSTRAINT ck_control_dias CHECK (
    cardinality(dias_semana) BETWEEN 1 AND 7
    AND dias_semana <@ ARRAY[1,2,3,4,5,6,7]::SMALLINT[]
  )
);

CREATE INDEX IF NOT EXISTS idx_controles_puntualidad_activos
  ON controles_puntualidad (configuracion_id, activo, orden, hora_referencia);

CREATE TABLE IF NOT EXISTS controles_puntualidad_versiones (
  id BIGSERIAL PRIMARY KEY,
  control_id BIGINT NOT NULL REFERENCES controles_puntualidad(id) ON DELETE RESTRICT,
  version INT NOT NULL,
  snapshot JSONB NOT NULL,
  motivo VARCHAR(500) NOT NULL,
  creado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (control_id, version)
);

INSERT INTO controles_puntualidad (
  configuracion_id, codigo, nombre, tipo, hora_apertura, hora_referencia,
  hora_inicio_atraso, hora_cierre, minutos_atraso_grave, dias_semana,
  cursos_ids, cuenta_alertas, activo, orden, creado_por, actualizado_por
)
SELECT id, 'ingreso-principal', 'Ingreso de la jornada', 'INGRESO',
       '00:00'::time, hora_entrada, hora_limite_atraso,
       LEAST('23:59'::time, GREATEST('10:00'::time, hora_limite_atraso + make_interval(mins => minutos_atraso_grave + 30))),
       minutos_atraso_grave, ARRAY[1,2,3,4,5]::SMALLINT[], ARRAY[]::INT[],
       true, true, 10, actualizado_por, actualizado_por
FROM configuracion_asistencia
ON CONFLICT (configuracion_id, codigo) DO NOTHING;

INSERT INTO controles_puntualidad_versiones (control_id, version, snapshot, motivo, creado_por)
SELECT c.id, c.version, jsonb_build_object(
  'codigo', c.codigo,
  'nombre', c.nombre,
  'tipo', c.tipo,
  'hora_apertura', c.hora_apertura,
  'hora_referencia', c.hora_referencia,
  'hora_inicio_atraso', c.hora_inicio_atraso,
  'hora_cierre', c.hora_cierre,
  'minutos_atraso_grave', c.minutos_atraso_grave,
  'dias_semana', c.dias_semana,
  'cursos_ids', c.cursos_ids,
  'cuenta_alertas', c.cuenta_alertas,
  'activo', c.activo
), 'Control inicial migrado desde la jornada institucional', c.creado_por
FROM controles_puntualidad c
ON CONFLICT (control_id, version) DO NOTHING;

ALTER TABLE attendance_registrations
  ADD COLUMN IF NOT EXISTS control_puntualidad_id BIGINT REFERENCES controles_puntualidad(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS control_codigo VARCHAR(60),
  ADD COLUMN IF NOT EXISTS control_nombre VARCHAR(100),
  ADD COLUMN IF NOT EXISTS control_tipo VARCHAR(30),
  ADD COLUMN IF NOT EXISTS hora_apertura_aplicada TIME,
  ADD COLUMN IF NOT EXISTS hora_cierre_aplicada TIME,
  ADD COLUMN IF NOT EXISTS control_version INT,
  ADD COLUMN IF NOT EXISTS cuenta_alertas_aplicado BOOLEAN;

UPDATE attendance_registrations r
SET control_puntualidad_id = c.id,
    control_codigo = c.codigo,
    control_nombre = c.nombre,
    control_tipo = c.tipo,
    hora_apertura_aplicada = c.hora_apertura,
    hora_cierre_aplicada = c.hora_cierre,
    control_version = c.version,
    cuenta_alertas_aplicado = c.cuenta_alertas
FROM controles_puntualidad c
WHERE c.codigo = 'ingreso-principal'
  AND r.control_puntualidad_id IS NULL;

ALTER TABLE attendance_registrations
  ALTER COLUMN control_puntualidad_id SET NOT NULL,
  ALTER COLUMN control_codigo SET NOT NULL,
  ALTER COLUMN control_nombre SET NOT NULL,
  ALTER COLUMN control_tipo SET NOT NULL,
  ALTER COLUMN hora_apertura_aplicada SET NOT NULL,
  ALTER COLUMN hora_cierre_aplicada SET NOT NULL,
  ALTER COLUMN control_version SET NOT NULL,
  ALTER COLUMN cuenta_alertas_aplicado SET NOT NULL;

DROP INDEX IF EXISTS uq_puntualidad_registro_activo;
CREATE UNIQUE INDEX IF NOT EXISTS uq_puntualidad_registro_control_activo
  ON attendance_registrations (id_alumno, fecha, control_puntualidad_id)
  WHERE anulado = false AND tipo_registro = 'Entrada';

CREATE INDEX IF NOT EXISTS idx_puntualidad_control_fecha
  ON attendance_registrations (control_puntualidad_id, fecha DESC, estado)
  WHERE anulado = false AND tipo_registro = 'Entrada';

INSERT INTO permisos_sistema (codigo, grupo, etiqueta, descripcion, orden, critico) VALUES
  ('punctuality.controls.override', 'Control de atrasos', 'Cambiar control horario', 'Permite escoger manualmente otro control de puntualidad y exige registrar el motivo.', 55, true),
  ('punctuality.controls.manage', 'Administración', 'Configurar controles horarios', 'Crea, modifica y desactiva los controles de ingreso, recreos, almuerzo y otros hitos.', 125, true)
ON CONFLICT (codigo) DO UPDATE SET
  grupo = EXCLUDED.grupo,
  etiqueta = EXCLUDED.etiqueta,
  descripcion = EXCLUDED.descripcion,
  orden = EXCLUDED.orden,
  critico = EXCLUDED.critico;

INSERT INTO permisos_rol (rol, permiso_codigo) VALUES
  ('admin', 'punctuality.controls.override'),
  ('admin', 'punctuality.controls.manage'),
  ('inspector', 'punctuality.controls.override')
ON CONFLICT DO NOTHING;
