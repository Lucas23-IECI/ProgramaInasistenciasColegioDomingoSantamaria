-- Control institucional de visitas y retiros, independiente de puntualidad.
CREATE TABLE IF NOT EXISTS visitantes (
  id BIGSERIAL PRIMARY KEY,
  tipo_documento VARCHAR(20) NOT NULL DEFAULT 'RUT'
    CHECK (tipo_documento IN ('RUT', 'PASAPORTE', 'OTRO')),
  documento_numero VARCHAR(40) NOT NULL,
  nombre_completo VARCHAR(160) NOT NULL,
  telefono VARCHAR(40),
  activo BOOLEAN NOT NULL DEFAULT true,
  creado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  actualizado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_visitantes_documento CHECK (char_length(trim(documento_numero)) BETWEEN 3 AND 40),
  CONSTRAINT ck_visitantes_nombre CHECK (char_length(trim(nombre_completo)) BETWEEN 3 AND 160)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_visitantes_documento
  ON visitantes (tipo_documento, documento_numero);

CREATE INDEX IF NOT EXISTS idx_visitantes_nombre
  ON visitantes (LOWER(nombre_completo));

CREATE TABLE IF NOT EXISTS visita_motivos (
  codigo VARCHAR(40) NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT true,
  orden INT NOT NULL DEFAULT 0,
  PRIMARY KEY (codigo)
);

INSERT INTO visita_motivos (codigo, nombre, orden) VALUES
  ('REUNION', 'Reunión', 10),
  ('TRAMITE', 'Trámite administrativo', 20),
  ('PROVEEDOR', 'Entrega o proveedor', 30),
  ('DOCENTE', 'Entrevista con docente', 40),
  ('ACTIVIDAD', 'Actividad institucional', 50),
  ('OTRO', 'Otro motivo', 90)
ON CONFLICT (codigo) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  orden = EXCLUDED.orden;

CREATE TABLE IF NOT EXISTS visita_destinos (
  codigo VARCHAR(40) NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT true,
  orden INT NOT NULL DEFAULT 0,
  PRIMARY KEY (codigo)
);

INSERT INTO visita_destinos (codigo, nombre, orden) VALUES
  ('DIRECCION', 'Dirección', 10),
  ('INSPECTORIA', 'Inspectoría', 20),
  ('SECRETARIA', 'Secretaría', 30),
  ('UTP', 'Unidad Técnico Pedagógica', 40),
  ('CONVIVENCIA', 'Convivencia Escolar', 50),
  ('PORTERIA', 'Portería', 60),
  ('OTRO', 'Otra dependencia', 90)
ON CONFLICT (codigo) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  orden = EXCLUDED.orden;

CREATE TABLE IF NOT EXISTS visitas (
  id BIGSERIAL PRIMARY KEY,
  visitante_id BIGINT NOT NULL REFERENCES visitantes(id) ON DELETE RESTRICT,
  motivo_codigo VARCHAR(40) NOT NULL,
  motivo_detalle VARCHAR(500),
  destino_codigo VARCHAR(40) NOT NULL,
  persona_contactada VARCHAR(160),
  observaciones VARCHAR(500),
  estado VARCHAR(20) NOT NULL DEFAULT 'DENTRO'
    CHECK (estado IN ('DENTRO', 'FINALIZADA', 'RECHAZADA', 'ANULADA')),
  origen VARCHAR(20) NOT NULL DEFAULT 'MANUAL'
    CHECK (origen IN ('LECTOR', 'MANUAL')),
  ingreso_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  salida_en TIMESTAMPTZ,
  registrado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  finalizado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  anulado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  motivo_anulacion VARCHAR(500),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_visitas_motivo FOREIGN KEY (motivo_codigo)
    REFERENCES visita_motivos(codigo) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_visitas_destino FOREIGN KEY (destino_codigo)
    REFERENCES visita_destinos(codigo) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_visita_activa_por_visitante
  ON visitas (visitante_id)
  WHERE estado = 'DENTRO';

CREATE INDEX IF NOT EXISTS idx_visitas_estado_ingreso
  ON visitas (estado, ingreso_en DESC);

CREATE INDEX IF NOT EXISTS idx_visitas_visitante
  ON visitas (visitante_id, ingreso_en DESC);

CREATE TABLE IF NOT EXISTS visita_eventos (
  id BIGSERIAL PRIMARY KEY,
  visita_id BIGINT NOT NULL REFERENCES visitas(id) ON DELETE RESTRICT,
  accion VARCHAR(30) NOT NULL
    CHECK (accion IN ('REGISTRAR_ENTRADA', 'REGISTRAR_SALIDA', 'CORREGIR', 'RECHAZAR', 'ANULAR')),
  detalle JSONB,
  realizado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  realizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_visita_eventos_visita
  ON visita_eventos (visita_id, realizado_en DESC);

CREATE TABLE IF NOT EXISTS personas_autorizadas_retiro (
  id BIGSERIAL PRIMARY KEY,
  id_alumno INT NOT NULL REFERENCES alumno(id_alumno) ON DELETE RESTRICT,
  visitante_id BIGINT NOT NULL REFERENCES visitantes(id) ON DELETE RESTRICT,
  parentesco VARCHAR(80) NOT NULL,
  origen_autorizacion VARCHAR(160) NOT NULL,
  vigente_desde DATE NOT NULL DEFAULT CURRENT_DATE,
  vigente_hasta DATE,
  activo BOOLEAN NOT NULL DEFAULT true,
  creado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_autorizacion_vigencia
    CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_autorizacion_retiro_activa
  ON personas_autorizadas_retiro (id_alumno, visitante_id)
  WHERE activo = true;

CREATE INDEX IF NOT EXISTS idx_autorizaciones_alumno
  ON personas_autorizadas_retiro (id_alumno, activo);

CREATE TABLE IF NOT EXISTS retiros_alumno (
  id BIGSERIAL PRIMARY KEY,
  id_alumno INT NOT NULL REFERENCES alumno(id_alumno) ON DELETE RESTRICT,
  visitante_id BIGINT NOT NULL REFERENCES visitantes(id) ON DELETE RESTRICT,
  autorizacion_id BIGINT REFERENCES personas_autorizadas_retiro(id) ON DELETE SET NULL,
  motivo VARCHAR(500) NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'SOLICITADO'
    CHECK (estado IN ('SOLICITADO', 'AUTORIZADO', 'RECHAZADO', 'ENTREGADO', 'CANCELADO')),
  solicitado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  solicitado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decidido_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  decidido_en TIMESTAMPTZ,
  motivo_decision VARCHAR(500),
  entregado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  entregado_en TIMESTAMPTZ,
  cancelado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  cancelado_en TIMESTAMPTZ,
  motivo_cancelacion VARCHAR(500),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_retiro_activo_alumno
  ON retiros_alumno (id_alumno)
  WHERE estado IN ('SOLICITADO', 'AUTORIZADO');

CREATE INDEX IF NOT EXISTS idx_retiros_estado_fecha
  ON retiros_alumno (estado, solicitado_en DESC);

CREATE INDEX IF NOT EXISTS idx_retiros_visitante
  ON retiros_alumno (visitante_id, solicitado_en DESC);

INSERT INTO permisos_sistema (codigo, grupo, etiqueta, descripcion, orden, critico) VALUES
  ('visits.view', 'Visitas y retiros', 'Ver visitas', 'Consulta las personas que se encuentran dentro y el historial de visitas.', 140, false),
  ('visits.register', 'Visitas y retiros', 'Registrar visitas', 'Registra visitantes nuevos o frecuentes mediante RUT, documento o búsqueda manual.', 150, false),
  ('visits.checkout', 'Visitas y retiros', 'Registrar salidas', 'Confirma la salida de una visita activa dejando trazabilidad.', 160, false),
  ('visits.manage', 'Visitas y retiros', 'Corregir o anular visitas', 'Gestiona excepciones y anulaciones con motivo obligatorio.', 170, true),
  ('visits.history', 'Visitas y retiros', 'Consultar historial de visitantes', 'Busca visitas anteriores por persona, documento, destino o período.', 180, true),
  ('withdrawals.register', 'Visitas y retiros', 'Solicitar retiros', 'Registra solicitudes de retiro de estudiantes sin aprobarlas automáticamente.', 190, false),
  ('withdrawals.approve', 'Visitas y retiros', 'Autorizar y entregar retiros', 'Aprueba, rechaza y confirma la entrega de un estudiante.', 200, true),
  ('withdrawals.authorizations', 'Visitas y retiros', 'Administrar autorizaciones', 'Mantiene las personas autorizadas para retirar a cada estudiante.', 210, true),
  ('visits.reports', 'Visitas y retiros', 'Generar reportes de visitas', 'Exporta registros de visitas y retiros por período.', 220, true),
  ('visits.settings', 'Visitas y retiros', 'Configurar visitas', 'Administra motivos, destinos y reglas operativas del módulo.', 230, true)
ON CONFLICT (codigo) DO UPDATE SET
  grupo = EXCLUDED.grupo,
  etiqueta = EXCLUDED.etiqueta,
  descripcion = EXCLUDED.descripcion,
  orden = EXCLUDED.orden,
  critico = EXCLUDED.critico;

INSERT INTO permisos_rol (rol, permiso_codigo)
SELECT 'admin', codigo
FROM permisos_sistema
WHERE codigo LIKE 'visits.%' OR codigo LIKE 'withdrawals.%'
ON CONFLICT DO NOTHING;

INSERT INTO permisos_rol (rol, permiso_codigo) VALUES
  ('inspector', 'visits.view'),
  ('inspector', 'visits.register'),
  ('inspector', 'visits.checkout'),
  ('inspector', 'visits.manage'),
  ('inspector', 'visits.history'),
  ('inspector', 'withdrawals.register'),
  ('inspector', 'withdrawals.approve'),
  ('inspector', 'withdrawals.authorizations'),
  ('inspector', 'visits.reports'),
  ('secretaria', 'visits.view'),
  ('secretaria', 'visits.register'),
  ('secretaria', 'visits.checkout'),
  ('secretaria', 'visits.history'),
  ('secretaria', 'withdrawals.register'),
  ('secretaria', 'withdrawals.authorizations'),
  ('secretaria', 'visits.reports'),
  ('direccion', 'visits.view'),
  ('direccion', 'visits.history'),
  ('direccion', 'visits.reports'),
  ('lector', 'visits.view'),
  ('lector', 'visits.register'),
  ('lector', 'visits.checkout'),
  ('lector', 'withdrawals.register')
ON CONFLICT DO NOTHING;
