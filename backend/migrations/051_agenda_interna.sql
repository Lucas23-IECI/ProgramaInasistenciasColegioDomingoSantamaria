-- Agenda privada y aditiva para coordinación entre cuentas internas.
-- No reemplaza tareas, controles de puntualidad ni calendarios institucionales existentes.

CREATE TABLE IF NOT EXISTS agenda_eventos (
  id_evento BIGSERIAL PRIMARY KEY,
  titulo VARCHAR(180) NOT NULL,
  detalle VARCHAR(1500),
  tipo VARCHAR(24) NOT NULL DEFAULT 'REUNION'
    CHECK (tipo IN ('REUNION', 'REVISION', 'RECORDATORIO', 'OTRO')),
  estado VARCHAR(24) NOT NULL DEFAULT 'PROGRAMADO'
    CHECK (estado IN ('PROGRAMADO', 'COMPLETADO', 'CANCELADO')),
  inicio TIMESTAMPTZ NOT NULL,
  fin TIMESTAMPTZ NOT NULL,
  todo_el_dia BOOLEAN NOT NULL DEFAULT false,
  ubicacion VARCHAR(180),
  alcance VARCHAR(20) NOT NULL DEFAULT 'PERSONAL'
    CHECK (alcance IN ('PERSONAL', 'INVITADOS')),
  creado_por INT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  cancelado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  motivo_cancelacion VARCHAR(500),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cancelado_en TIMESTAMPTZ,
  version INT NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT ck_agenda_evento_fechas CHECK (fin > inicio)
);

CREATE INDEX IF NOT EXISTS idx_agenda_eventos_periodo
  ON agenda_eventos (inicio, fin, estado);
CREATE INDEX IF NOT EXISTS idx_agenda_eventos_creador
  ON agenda_eventos (creado_por, inicio DESC);

CREATE TABLE IF NOT EXISTS agenda_evento_participantes (
  id_evento BIGINT NOT NULL REFERENCES agenda_eventos(id_evento) ON DELETE RESTRICT,
  usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  rol VARCHAR(20) NOT NULL DEFAULT 'PARTICIPANTE'
    CHECK (rol IN ('ORGANIZADOR', 'PARTICIPANTE')),
  respuesta VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE'
    CHECK (respuesta IN ('PENDIENTE', 'ACEPTADA', 'RECHAZADA')),
  respondido_en TIMESTAMPTZ,
  agregado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_evento, usuario_id)
);

CREATE INDEX IF NOT EXISTS idx_agenda_participantes_usuario
  ON agenda_evento_participantes (usuario_id, respuesta, id_evento);

CREATE TABLE IF NOT EXISTS agenda_recordatorios (
  id_recordatorio BIGSERIAL PRIMARY KEY,
  id_evento BIGINT NOT NULL REFERENCES agenda_eventos(id_evento) ON DELETE RESTRICT,
  usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  minutos_antes INT NOT NULL DEFAULT 30 CHECK (minutos_antes BETWEEN 0 AND 10080),
  estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE'
    CHECK (estado IN ('PENDIENTE', 'ENVIADO', 'CANCELADO', 'FALLIDO')),
  enviado_en TIMESTAMPTZ,
  error_publico VARCHAR(500),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id_evento, usuario_id)
);

CREATE INDEX IF NOT EXISTS idx_agenda_recordatorios_pendientes
  ON agenda_recordatorios (estado, id_evento)
  WHERE estado = 'PENDIENTE';

INSERT INTO permisos_sistema (codigo, grupo, etiqueta, descripcion, orden, critico) VALUES
  ('agenda.view', 'Coordinación interna', 'Consultar agenda personal', 'Permite consultar únicamente eventos propios o donde la cuenta fue invitada.', 660, false),
  ('agenda.create', 'Coordinación interna', 'Crear eventos de agenda', 'Permite crear reuniones, revisiones y recordatorios internos e invitar cuentas activas.', 661, false)
ON CONFLICT (codigo) DO UPDATE SET
  grupo = EXCLUDED.grupo,
  etiqueta = EXCLUDED.etiqueta,
  descripcion = EXCLUDED.descripcion,
  orden = EXCLUDED.orden,
  critico = EXCLUDED.critico;

INSERT INTO permisos_rol (rol, permiso_codigo) VALUES
  ('admin', 'agenda.view'), ('admin', 'agenda.create'),
  ('direccion', 'agenda.view'), ('direccion', 'agenda.create'),
  ('inspector', 'agenda.view'), ('inspector', 'agenda.create'),
  ('secretaria', 'agenda.view'), ('secretaria', 'agenda.create'),
  ('convivencia', 'agenda.view'), ('convivencia', 'agenda.create'),
  ('documental', 'agenda.view'), ('documental', 'agenda.create')
ON CONFLICT DO NOTHING;
