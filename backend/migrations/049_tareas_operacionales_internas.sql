-- Tareas internas aditivas para la bandeja operacional.
-- No modifica visitas, retiros, atrasos, usuarios ni cierres existentes.

CREATE TABLE IF NOT EXISTS tareas_operacionales_internas (
  id_tarea BIGSERIAL PRIMARY KEY,
  titulo VARCHAR(160) NOT NULL,
  detalle VARCHAR(1500),
  prioridad VARCHAR(20) NOT NULL DEFAULT 'MEDIA'
    CHECK (prioridad IN ('BAJA', 'MEDIA', 'ALTA', 'URGENTE')),
  estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE'
    CHECK (estado IN ('PENDIENTE', 'EN_PROGRESO', 'COMPLETADA', 'CANCELADA')),
  responsable_usuario_id INT REFERENCES usuarios(id) ON DELETE SET NULL,
  fecha_limite DATE,
  creada_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  completada_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  creada_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizada_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completada_en TIMESTAMPTZ,
  version INT NOT NULL DEFAULT 1,
  CONSTRAINT ck_tarea_operacional_titulo CHECK (char_length(trim(titulo)) BETWEEN 3 AND 160)
);

CREATE INDEX IF NOT EXISTS idx_tareas_operacionales_pendientes
  ON tareas_operacionales_internas (estado, fecha_limite, prioridad, creada_en);
CREATE INDEX IF NOT EXISTS idx_tareas_operacionales_responsable
  ON tareas_operacionales_internas (responsable_usuario_id, estado, fecha_limite);

CREATE TABLE IF NOT EXISTS tarea_operacional_eventos (
  id_evento BIGSERIAL PRIMARY KEY,
  id_tarea BIGINT NOT NULL REFERENCES tareas_operacionales_internas(id_tarea) ON DELETE RESTRICT,
  tipo VARCHAR(30) NOT NULL CHECK (tipo IN ('CREADA', 'ESTADO_CAMBIADO', 'REASIGNADA')),
  detalle VARCHAR(500),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  realizado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  realizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tarea_operacional_eventos_tarea
  ON tarea_operacional_eventos (id_tarea, realizado_en, id_evento);

INSERT INTO permisos_sistema (codigo, grupo, etiqueta, descripcion, orden, critico)
VALUES (
  'operations.tasks.manage',
  'Operación diaria',
  'Gestionar tareas internas',
  'Crea, asigna y resuelve tareas internas con historial visible y auditoría.',
  238,
  false
)
ON CONFLICT (codigo) DO UPDATE SET
  grupo = EXCLUDED.grupo,
  etiqueta = EXCLUDED.etiqueta,
  descripcion = EXCLUDED.descripcion,
  orden = EXCLUDED.orden,
  critico = EXCLUDED.critico;

INSERT INTO permisos_rol (rol, permiso_codigo) VALUES
  ('admin', 'operations.tasks.manage'),
  ('inspector', 'operations.tasks.manage'),
  ('direccion', 'operations.tasks.manage')
ON CONFLICT DO NOTHING;
