-- Politicas ampliadas de puntualidad sobre el modelo historico existente.
-- Todos los cambios son aditivos y las reglas sensibles quedan configurables.

CREATE TABLE IF NOT EXISTS puntualidad_turnos (
  id BIGSERIAL PRIMARY KEY,
  codigo VARCHAR(50) NOT NULL UNIQUE,
  nombre VARCHAR(100) NOT NULL,
  tipo VARCHAR(20) NOT NULL DEFAULT 'OTRO' CHECK (tipo IN ('MANANA', 'TARDE', 'COMPLETA', 'OTRO')),
  hora_inicio TIME NOT NULL,
  hora_fin TIME NOT NULL,
  dias_semana SMALLINT[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]::SMALLINT[],
  cursos_ids INT[] NOT NULL DEFAULT ARRAY[]::INT[],
  activo BOOLEAN NOT NULL DEFAULT true,
  orden INT NOT NULL DEFAULT 0,
  creado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  actualizado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_puntualidad_turno_horas CHECK (hora_inicio < hora_fin),
  CONSTRAINT ck_puntualidad_turno_dias CHECK (cardinality(dias_semana) BETWEEN 1 AND 7)
);

ALTER TABLE controles_puntualidad
  ADD COLUMN IF NOT EXISTS turno_id BIGINT REFERENCES puntualidad_turnos(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS puntualidad_calendario_excepciones (
  id BIGSERIAL PRIMARY KEY,
  fecha DATE NOT NULL,
  nombre VARCHAR(160) NOT NULL,
  tipo VARCHAR(30) NOT NULL CHECK (tipo IN ('SUSPENSION', 'HORARIO_ESPECIAL', 'ACTIVIDAD', 'CONTINGENCIA')),
  reemplaza_controles BOOLEAN NOT NULL DEFAULT true,
  cursos_ids INT[] NOT NULL DEFAULT ARRAY[]::INT[],
  turnos_ids BIGINT[] NOT NULL DEFAULT ARRAY[]::BIGINT[],
  descripcion VARCHAR(1000),
  activo BOOLEAN NOT NULL DEFAULT true,
  version INT NOT NULL DEFAULT 1,
  creado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  actualizado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_puntualidad_calendario_fecha
  ON puntualidad_calendario_excepciones (fecha, activo, tipo);

CREATE TABLE IF NOT EXISTS puntualidad_controles_excepcionales (
  id BIGSERIAL PRIMARY KEY,
  excepcion_id BIGINT NOT NULL REFERENCES puntualidad_calendario_excepciones(id) ON DELETE RESTRICT,
  control_base_id BIGINT NOT NULL REFERENCES controles_puntualidad(id) ON DELETE RESTRICT,
  codigo VARCHAR(60) NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  tipo VARCHAR(30) NOT NULL CHECK (tipo IN ('INGRESO', 'REGRESO_RECREO', 'REGRESO_ALMUERZO', 'TALLER', 'OTRO')),
  hora_apertura TIME NOT NULL,
  hora_referencia TIME NOT NULL,
  hora_inicio_atraso TIME NOT NULL,
  hora_cierre TIME NOT NULL,
  minutos_atraso_grave INT NOT NULL DEFAULT 15 CHECK (minutos_atraso_grave BETWEEN 1 AND 180),
  cursos_ids INT[] NOT NULL DEFAULT ARRAY[]::INT[],
  cuenta_alertas BOOLEAN NOT NULL DEFAULT true,
  orden INT NOT NULL DEFAULT 0,
  activo BOOLEAN NOT NULL DEFAULT true,
  version INT NOT NULL DEFAULT 1,
  creado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (excepcion_id, codigo),
  CONSTRAINT ck_puntualidad_control_excepcional_horas CHECK (
    hora_apertura <= hora_referencia AND hora_referencia < hora_inicio_atraso AND hora_inicio_atraso < hora_cierre
  )
);

CREATE TABLE IF NOT EXISTS puntualidad_motivos_institucionales (
  codigo VARCHAR(50) PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL,
  categoria VARCHAR(30) NOT NULL CHECK (categoria IN ('TRANSPORTE', 'CONTINGENCIA', 'INSTITUCIONAL', 'FAMILIAR', 'OTRA')),
  requiere_detalle BOOLEAN NOT NULL DEFAULT false,
  excluye_alertas BOOLEAN NOT NULL DEFAULT false,
  activo BOOLEAN NOT NULL DEFAULT true,
  orden INT NOT NULL DEFAULT 0,
  creado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  actualizado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO puntualidad_motivos_institucionales
  (codigo, nombre, categoria, requiere_detalle, excluye_alertas, orden)
VALUES
  ('TRANSPORTE_ESCOLAR', 'Incidente de transporte escolar', 'TRANSPORTE', true, true, 10),
  ('CONTINGENCIA_INSTITUCIONAL', 'Contingencia institucional', 'CONTINGENCIA', true, true, 20),
  ('ACTIVIDAD_INSTITUCIONAL', 'Actividad institucional autorizada', 'INSTITUCIONAL', true, true, 30),
  ('OTRO', 'Otro motivo autorizado', 'OTRA', true, false, 90)
ON CONFLICT (codigo) DO NOTHING;

CREATE TABLE IF NOT EXISTS puntualidad_excepciones_estudiante (
  id BIGSERIAL PRIMARY KEY,
  id_alumno INT NOT NULL REFERENCES alumno(id_alumno) ON DELETE RESTRICT,
  fecha_desde DATE NOT NULL,
  fecha_hasta DATE NOT NULL,
  motivo_codigo VARCHAR(50) NOT NULL REFERENCES puntualidad_motivos_institucionales(codigo) ON DELETE RESTRICT,
  detalle VARCHAR(1000) NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'VIGENTE' CHECK (estado IN ('VIGENTE', 'REVOCADA', 'VENCIDA')),
  creado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  revocado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revocado_en TIMESTAMPTZ,
  motivo_revocacion VARCHAR(500),
  CONSTRAINT ck_puntualidad_excepcion_estudiante_fecha CHECK (fecha_hasta >= fecha_desde)
);

CREATE INDEX IF NOT EXISTS idx_puntualidad_excepciones_estudiante
  ON puntualidad_excepciones_estudiante (id_alumno, fecha_desde, fecha_hasta, estado);

CREATE TABLE IF NOT EXISTS puntualidad_contingencias (
  id BIGSERIAL PRIMARY KEY,
  fecha DATE NOT NULL,
  nombre VARCHAR(160) NOT NULL,
  motivo_codigo VARCHAR(50) NOT NULL REFERENCES puntualidad_motivos_institucionales(codigo) ON DELETE RESTRICT,
  detalle VARCHAR(1000) NOT NULL,
  control_puntualidad_id BIGINT REFERENCES controles_puntualidad(id) ON DELETE SET NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'ABIERTA' CHECK (estado IN ('ABIERTA', 'CERRADA', 'ANULADA')),
  creado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cerrado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  cerrado_en TIMESTAMPTZ,
  motivo_cierre VARCHAR(500)
);

CREATE TABLE IF NOT EXISTS puntualidad_compromisos (
  id BIGSERIAL PRIMARY KEY,
  id_alumno INT NOT NULL REFERENCES alumno(id_alumno) ON DELETE RESTRICT,
  titulo VARCHAR(160) NOT NULL,
  descripcion VARCHAR(1000) NOT NULL,
  fecha_inicio DATE NOT NULL,
  fecha_revision DATE NOT NULL,
  fecha_fin DATE,
  meta_atrasos_maxima INT CHECK (meta_atrasos_maxima IS NULL OR meta_atrasos_maxima BETWEEN 0 AND 100),
  estado VARCHAR(20) NOT NULL DEFAULT 'ACTIVO' CHECK (estado IN ('ACTIVO', 'CUMPLIDO', 'INCUMPLIDO', 'CERRADO', 'CANCELADO')),
  responsable_id INT REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  cerrado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  resultado VARCHAR(1000),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cerrado_en TIMESTAMPTZ,
  CONSTRAINT ck_puntualidad_compromiso_fechas CHECK (fecha_revision >= fecha_inicio AND (fecha_fin IS NULL OR fecha_fin >= fecha_inicio))
);

CREATE INDEX IF NOT EXISTS idx_puntualidad_compromisos_alumno
  ON puntualidad_compromisos (id_alumno, estado, fecha_revision);

ALTER TABLE attendance_registrations
  ADD COLUMN IF NOT EXISTS turno_id_aplicado BIGINT,
  ADD COLUMN IF NOT EXISTS turno_nombre_aplicado VARCHAR(100),
  ADD COLUMN IF NOT EXISTS calendario_excepcion_id BIGINT REFERENCES puntualidad_calendario_excepciones(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS motivo_institucional_codigo VARCHAR(50) REFERENCES puntualidad_motivos_institucionales(codigo) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS excepcion_estudiante_id BIGINT REFERENCES puntualidad_excepciones_estudiante(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contingencia_id BIGINT REFERENCES puntualidad_contingencias(id) ON DELETE SET NULL;

INSERT INTO permisos_sistema (codigo, grupo, etiqueta, descripcion, orden, critico) VALUES
  ('punctuality.calendar.manage', 'Administracion', 'Configurar calendario excepcional', 'Mantiene dias especiales, actividades y suspensiones con reglas explicitas.', 126, true),
  ('punctuality.shifts.manage', 'Administracion', 'Configurar jornadas y turnos', 'Organiza controles por jornada de manana, tarde o completa.', 127, true),
  ('punctuality.exceptions.manage', 'Control de atrasos', 'Gestionar excepciones institucionales', 'Registra excepciones de transporte u otras causas autorizadas.', 56, true),
  ('punctuality.contingencies.manage', 'Control de atrasos', 'Gestionar contingencias masivas', 'Registra y cierra contingencias sin perder trazabilidad individual.', 57, true),
  ('punctuality.commitments.manage', 'Seguimiento institucional', 'Gestionar compromisos de puntualidad', 'Define metas, revisiones y resultados transparentes por estudiante.', 238, true),
  ('punctuality.improvements.view', 'Informacion', 'Reconocer mejoras de puntualidad', 'Compara periodos con criterios explicables y sin puntajes opacos.', 239, false)
ON CONFLICT (codigo) DO UPDATE SET
  grupo = EXCLUDED.grupo, etiqueta = EXCLUDED.etiqueta, descripcion = EXCLUDED.descripcion,
  orden = EXCLUDED.orden, critico = EXCLUDED.critico;

INSERT INTO permisos_rol (rol, permiso_codigo) VALUES
  ('admin', 'punctuality.calendar.manage'), ('admin', 'punctuality.shifts.manage'),
  ('admin', 'punctuality.exceptions.manage'), ('admin', 'punctuality.contingencies.manage'),
  ('admin', 'punctuality.commitments.manage'), ('admin', 'punctuality.improvements.view'),
  ('inspector', 'punctuality.exceptions.manage'), ('inspector', 'punctuality.contingencies.manage'),
  ('inspector', 'punctuality.commitments.manage'), ('inspector', 'punctuality.improvements.view'),
  ('direccion', 'punctuality.improvements.view'), ('secretaria', 'punctuality.improvements.view')
ON CONFLICT DO NOTHING;
