-- Ampliacion aditiva del modulo existente de visitas y porteria.
-- No elimina ni reescribe visitas, retiros o visitantes existentes.

CREATE TABLE IF NOT EXISTS visita_entidades_externas (
  id BIGSERIAL PRIMARY KEY,
  tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('PROVEEDOR', 'CONTRATISTA', 'OTRA')),
  identificador VARCHAR(40),
  nombre VARCHAR(160) NOT NULL,
  contacto VARCHAR(160),
  telefono VARCHAR(40),
  email VARCHAR(160),
  activo BOOLEAN NOT NULL DEFAULT true,
  creado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  actualizado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_visita_entidad_nombre CHECK (char_length(trim(nombre)) BETWEEN 3 AND 160)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_visita_entidad_identificador
  ON visita_entidades_externas (tipo, identificador)
  WHERE identificador IS NOT NULL;

ALTER TABLE visitantes
  ADD COLUMN IF NOT EXISTS frecuente BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS entidad_externa_id BIGINT REFERENCES visita_entidades_externas(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS visita_restricciones_acceso (
  id BIGSERIAL PRIMARY KEY,
  visitante_id BIGINT NOT NULL REFERENCES visitantes(id) ON DELETE RESTRICT,
  tipo VARCHAR(30) NOT NULL CHECK (tipo IN ('ALERTA', 'REQUIERE_AUTORIZACION', 'BLOQUEO')),
  motivo VARCHAR(500) NOT NULL,
  vigente_desde TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  vigente_hasta TIMESTAMPTZ,
  activo BOOLEAN NOT NULL DEFAULT true,
  creado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  desactivado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  desactivado_en TIMESTAMPTZ,
  CONSTRAINT ck_visita_restriccion_vigencia CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde)
);

CREATE INDEX IF NOT EXISTS idx_visita_restricciones_vigentes
  ON visita_restricciones_acceso (visitante_id, activo, vigente_hasta);

CREATE TABLE IF NOT EXISTS visita_preinscripciones (
  id BIGSERIAL PRIMARY KEY,
  visitante_id BIGINT NOT NULL REFERENCES visitantes(id) ON DELETE RESTRICT,
  token_hash CHAR(64) NOT NULL UNIQUE,
  motivo_codigo VARCHAR(40) NOT NULL REFERENCES visita_motivos(codigo) ON DELETE RESTRICT,
  motivo_detalle VARCHAR(500),
  destino_codigo VARCHAR(40) NOT NULL REFERENCES visita_destinos(codigo) ON DELETE RESTRICT,
  persona_contactada VARCHAR(160) NOT NULL,
  entidad_externa_id BIGINT REFERENCES visita_entidades_externas(id) ON DELETE SET NULL,
  categoria VARCHAR(20) NOT NULL DEFAULT 'VISITA' CHECK (categoria IN ('VISITA', 'PROVEEDOR', 'CONTRATISTA')),
  valida_desde TIMESTAMPTZ NOT NULL,
  valida_hasta TIMESTAMPTZ NOT NULL,
  usos_maximos SMALLINT NOT NULL DEFAULT 1 CHECK (usos_maximos BETWEEN 1 AND 10),
  usos_realizados SMALLINT NOT NULL DEFAULT 0 CHECK (usos_realizados >= 0),
  estado VARCHAR(20) NOT NULL DEFAULT 'ESPERADA' CHECK (estado IN ('ESPERADA', 'UTILIZADA', 'VENCIDA', 'CANCELADA')),
  visita_id BIGINT REFERENCES visitas(id) ON DELETE SET NULL,
  observaciones VARCHAR(500),
  creado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  cancelado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cancelado_en TIMESTAMPTZ,
  CONSTRAINT ck_visita_preinscripcion_vigencia CHECK (valida_hasta > valida_desde)
);

CREATE INDEX IF NOT EXISTS idx_visita_preinscripciones_estado_fecha
  ON visita_preinscripciones (estado, valida_desde, valida_hasta);

ALTER TABLE visitas
  ADD COLUMN IF NOT EXISTS preinscripcion_id BIGINT REFERENCES visita_preinscripciones(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS entidad_externa_id BIGINT REFERENCES visita_entidades_externas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS categoria VARCHAR(20) NOT NULL DEFAULT 'VISITA',
  ADD COLUMN IF NOT EXISTS salida_esperada_en TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_visitas_categoria'
      AND conrelid = 'visitas'::regclass
  ) THEN
    ALTER TABLE visitas ADD CONSTRAINT ck_visitas_categoria
      CHECK (categoria IN ('VISITA', 'PROVEEDOR', 'CONTRATISTA'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS visita_vehiculos (
  id BIGSERIAL PRIMARY KEY,
  patente VARCHAR(16) NOT NULL,
  tipo VARCHAR(30) NOT NULL DEFAULT 'OTRO' CHECK (tipo IN ('AUTOMOVIL', 'CAMIONETA', 'CAMION', 'MOTOCICLETA', 'OTRO')),
  marca VARCHAR(60),
  modelo VARCHAR(60),
  color VARCHAR(40),
  visitante_id BIGINT REFERENCES visitantes(id) ON DELETE SET NULL,
  entidad_externa_id BIGINT REFERENCES visita_entidades_externas(id) ON DELETE SET NULL,
  activo BOOLEAN NOT NULL DEFAULT true,
  creado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_visita_vehiculo_patente ON visita_vehiculos (UPPER(patente));

CREATE TABLE IF NOT EXISTS visita_vehiculo_movimientos (
  visita_id BIGINT NOT NULL REFERENCES visitas(id) ON DELETE RESTRICT,
  vehiculo_id BIGINT NOT NULL REFERENCES visita_vehiculos(id) ON DELETE RESTRICT,
  registrado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  registrado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (visita_id, vehiculo_id)
);

CREATE TABLE IF NOT EXISTS visita_encomiendas (
  id BIGSERIAL PRIMARY KEY,
  tipo VARCHAR(20) NOT NULL DEFAULT 'ENCOMIENDA' CHECK (tipo IN ('ENCOMIENDA', 'ENTREGA')),
  entidad_externa_id BIGINT REFERENCES visita_entidades_externas(id) ON DELETE SET NULL,
  remitente VARCHAR(160) NOT NULL,
  destinatario VARCHAR(160) NOT NULL,
  descripcion VARCHAR(500) NOT NULL,
  referencia VARCHAR(100),
  estado VARCHAR(20) NOT NULL DEFAULT 'RECIBIDA' CHECK (estado IN ('RECIBIDA', 'ENTREGADA', 'RECHAZADA', 'CANCELADA')),
  recibido_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  recibido_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  entregado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  entregado_en TIMESTAMPTZ,
  observaciones VARCHAR(500)
);

CREATE INDEX IF NOT EXISTS idx_visita_encomiendas_estado ON visita_encomiendas (estado, recibido_en DESC);

CREATE TABLE IF NOT EXISTS visita_puntos_reunion (
  id BIGSERIAL PRIMARY KEY,
  codigo VARCHAR(40) NOT NULL UNIQUE,
  nombre VARCHAR(120) NOT NULL,
  descripcion VARCHAR(500),
  activo BOOLEAN NOT NULL DEFAULT true,
  creado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS visita_emergencias (
  id BIGSERIAL PRIMARY KEY,
  tipo VARCHAR(30) NOT NULL CHECK (tipo IN ('EVACUACION', 'SIMULACRO', 'OTRA')),
  descripcion VARCHAR(500) NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'ACTIVA' CHECK (estado IN ('ACTIVA', 'CERRADA', 'CANCELADA')),
  punto_reunion_id BIGINT REFERENCES visita_puntos_reunion(id) ON DELETE SET NULL,
  iniciada_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  iniciada_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cerrada_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  cerrada_en TIMESTAMPTZ,
  observaciones_cierre VARCHAR(500)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_visita_emergencia_activa
  ON visita_emergencias ((true)) WHERE estado = 'ACTIVA';

CREATE TABLE IF NOT EXISTS visita_emergencia_presentes (
  emergencia_id BIGINT NOT NULL REFERENCES visita_emergencias(id) ON DELETE RESTRICT,
  visita_id BIGINT NOT NULL REFERENCES visitas(id) ON DELETE RESTRICT,
  estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE', 'CONFIRMADO', 'NO_UBICADO', 'SALIO')),
  punto_reunion_id BIGINT REFERENCES visita_puntos_reunion(id) ON DELETE SET NULL,
  verificado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  verificado_en TIMESTAMPTZ,
  observaciones VARCHAR(500),
  PRIMARY KEY (emergencia_id, visita_id)
);

INSERT INTO permisos_sistema (codigo, grupo, etiqueta, descripcion, orden, critico) VALUES
  ('visits.preregistrations.manage', 'Visitas y retiros', 'Gestionar visitas esperadas', 'Crea y cancela preinscripciones con codigos temporales.', 232, true),
  ('visits.restrictions.manage', 'Visitas y retiros', 'Gestionar restricciones de acceso', 'Registra alertas, autorizaciones adicionales y bloqueos auditados.', 233, true),
  ('visits.deliveries.manage', 'Visitas y retiros', 'Gestionar entregas y encomiendas', 'Recibe y entrega encomiendas con trazabilidad.', 234, false),
  ('visits.vehicles.manage', 'Visitas y retiros', 'Gestionar vehiculos de visita', 'Registra vehiculos vinculados con visitas, proveedores o contratistas.', 235, false),
  ('visits.emergency.view', 'Visitas y retiros', 'Ver ocupacion de emergencia', 'Consulta personas externas dentro y su estado de verificacion.', 236, true),
  ('visits.emergency.manage', 'Visitas y retiros', 'Gestionar evacuacion de visitas', 'Inicia, verifica y cierra eventos de evacuacion o simulacro.', 237, true)
ON CONFLICT (codigo) DO UPDATE SET
  grupo = EXCLUDED.grupo, etiqueta = EXCLUDED.etiqueta, descripcion = EXCLUDED.descripcion,
  orden = EXCLUDED.orden, critico = EXCLUDED.critico;

INSERT INTO permisos_rol (rol, permiso_codigo) VALUES
  ('admin', 'visits.preregistrations.manage'),
  ('admin', 'visits.restrictions.manage'),
  ('admin', 'visits.deliveries.manage'),
  ('admin', 'visits.vehicles.manage'),
  ('admin', 'visits.emergency.view'),
  ('admin', 'visits.emergency.manage'),
  ('inspector', 'visits.preregistrations.manage'),
  ('inspector', 'visits.restrictions.manage'),
  ('inspector', 'visits.deliveries.manage'),
  ('inspector', 'visits.vehicles.manage'),
  ('inspector', 'visits.emergency.view'),
  ('inspector', 'visits.emergency.manage'),
  ('lector', 'visits.deliveries.manage'),
  ('lector', 'visits.vehicles.manage'),
  ('lector', 'visits.emergency.view'),
  ('direccion', 'visits.emergency.view')
ON CONFLICT DO NOTHING;
