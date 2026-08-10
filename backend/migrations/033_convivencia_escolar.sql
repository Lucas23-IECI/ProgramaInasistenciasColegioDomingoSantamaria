-- Dominio reservado de Convivencia Escolar.
-- La migracion es aditiva: no modifica registros de atrasos, visitas ni matriculas.

CREATE TABLE IF NOT EXISTS convivencia_casos (
  id_caso SERIAL PRIMARY KEY,
  codigo VARCHAR(32) UNIQUE,
  titulo VARCHAR(180) NOT NULL,
  categoria VARCHAR(40) NOT NULL DEFAULT 'CONVIVENCIA' CONSTRAINT ck_convivencia_categoria CHECK (
    categoria IN ('CONVIVENCIA', 'CONFLICTO', 'ACOSO', 'VIOLENCIA', 'DISCRIMINACION', 'VULNERACION', 'OTRO')
  ),
  prioridad VARCHAR(16) NOT NULL DEFAULT 'MEDIA' CONSTRAINT ck_convivencia_prioridad CHECK (
    prioridad IN ('BAJA', 'MEDIA', 'ALTA', 'URGENTE')
  ),
  estado VARCHAR(24) NOT NULL DEFAULT 'ABIERTO' CONSTRAINT ck_convivencia_estado CHECK (
    estado IN ('ABIERTO', 'EN_SEGUIMIENTO', 'EN_REVISION', 'CERRADO', 'ANULADO')
  ),
  descripcion_inicial TEXT NOT NULL,
  fecha_situacion DATE NOT NULL DEFAULT CURRENT_DATE,
  proxima_revision DATE,
  responsable_usuario_id INT REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_por INT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  actualizado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  cerrado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  motivo_cierre TEXT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cerrado_en TIMESTAMPTZ,
  version INT NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT ck_convivencia_cierre CHECK (
    (estado = 'CERRADO' AND cerrado_en IS NOT NULL AND motivo_cierre IS NOT NULL)
    OR estado <> 'CERRADO'
  )
);

CREATE TABLE IF NOT EXISTS convivencia_participantes (
  id_participante SERIAL PRIMARY KEY,
  id_caso INT NOT NULL REFERENCES convivencia_casos(id_caso) ON DELETE RESTRICT,
  tipo_persona VARCHAR(16) NOT NULL CONSTRAINT ck_convivencia_participante_tipo CHECK (
    tipo_persona IN ('ESTUDIANTE', 'PERSONAL', 'EXTERNA', 'OTRA')
  ),
  estudiante_id INT REFERENCES alumno(id_alumno) ON DELETE RESTRICT,
  usuario_id INT REFERENCES usuarios(id) ON DELETE RESTRICT,
  nombre_externo VARCHAR(180),
  rol_en_caso VARCHAR(24) NOT NULL CONSTRAINT ck_convivencia_participante_rol CHECK (
    rol_en_caso IN ('AFECTADO', 'INVOLUCRADO', 'TESTIGO', 'APODERADO', 'PROFESIONAL', 'OTRO')
  ),
  detalle_relacion VARCHAR(300),
  activo BOOLEAN NOT NULL DEFAULT true,
  creado_por INT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  retirado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  retirado_en TIMESTAMPTZ,
  CONSTRAINT ck_convivencia_participante_referencia CHECK (
    (tipo_persona = 'ESTUDIANTE' AND estudiante_id IS NOT NULL AND usuario_id IS NULL AND nombre_externo IS NULL)
    OR (tipo_persona = 'PERSONAL' AND estudiante_id IS NULL AND usuario_id IS NOT NULL AND nombre_externo IS NULL)
    OR (tipo_persona IN ('EXTERNA', 'OTRA') AND estudiante_id IS NULL AND usuario_id IS NULL AND char_length(trim(nombre_externo)) >= 2)
  )
);

CREATE TABLE IF NOT EXISTS convivencia_eventos (
  id_evento SERIAL PRIMARY KEY,
  id_caso INT NOT NULL REFERENCES convivencia_casos(id_caso) ON DELETE RESTRICT,
  tipo VARCHAR(24) NOT NULL CONSTRAINT ck_convivencia_evento_tipo CHECK (
    tipo IN ('SITUACION', 'MEDIDA', 'ENTREVISTA', 'MEDIACION', 'ACUERDO', 'SEGUIMIENTO', 'DERIVACION', 'REVISION', 'CIERRE', 'REAPERTURA')
  ),
  titulo VARCHAR(180) NOT NULL,
  detalle TEXT NOT NULL,
  resultado TEXT,
  fecha_evento TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  proxima_revision DATE,
  creado_por INT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS convivencia_evento_participantes (
  id_evento INT NOT NULL REFERENCES convivencia_eventos(id_evento) ON DELETE CASCADE,
  id_participante INT NOT NULL REFERENCES convivencia_participantes(id_participante) ON DELETE RESTRICT,
  PRIMARY KEY (id_evento, id_participante)
);

CREATE TABLE IF NOT EXISTS convivencia_documentos (
  id_convivencia_documento SERIAL PRIMARY KEY,
  id_caso INT NOT NULL REFERENCES convivencia_casos(id_caso) ON DELETE RESTRICT,
  id_evento INT REFERENCES convivencia_eventos(id_evento) ON DELETE RESTRICT,
  id_documento INT NOT NULL UNIQUE REFERENCES justification_documents(id_documento) ON DELETE RESTRICT,
  descripcion VARCHAR(300),
  activo BOOLEAN NOT NULL DEFAULT true,
  creado_por INT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_convivencia_casos_estado_revision
  ON convivencia_casos (estado, proxima_revision, actualizado_en DESC);
CREATE INDEX IF NOT EXISTS idx_convivencia_casos_responsable
  ON convivencia_casos (responsable_usuario_id, estado);
CREATE INDEX IF NOT EXISTS idx_convivencia_participantes_caso
  ON convivencia_participantes (id_caso, activo, id_participante);
CREATE INDEX IF NOT EXISTS idx_convivencia_participantes_estudiante
  ON convivencia_participantes (estudiante_id) WHERE activo = true;
CREATE INDEX IF NOT EXISTS idx_convivencia_eventos_caso_fecha
  ON convivencia_eventos (id_caso, fecha_evento DESC, id_evento DESC);
CREATE INDEX IF NOT EXISTS idx_convivencia_documentos_caso
  ON convivencia_documentos (id_caso, activo, creado_en DESC);

INSERT INTO permisos_sistema (codigo, grupo, etiqueta, descripcion, orden, critico) VALUES
  ('convivencia.view', 'Convivencia escolar', 'Consultar casos de convivencia', 'Permite consultar casos, participantes, actuaciones y fechas de revision del modulo reservado.', 500, true),
  ('convivencia.create', 'Convivencia escolar', 'Registrar situaciones', 'Permite abrir casos y registrar la situacion inicial con sus personas involucradas.', 501, true),
  ('convivencia.manage', 'Convivencia escolar', 'Gestionar actuaciones', 'Permite registrar medidas, entrevistas, mediaciones, acuerdos, seguimientos y derivaciones.', 502, true),
  ('convivencia.documents', 'Convivencia escolar', 'Gestionar documentos reservados', 'Permite adjuntar y descargar documentos protegidos de los casos.', 503, true),
  ('convivencia.close', 'Convivencia escolar', 'Cerrar y reabrir casos', 'Permite cerrar o reabrir casos dejando motivo y trazabilidad.', 504, true)
ON CONFLICT (codigo) DO UPDATE SET
  grupo = EXCLUDED.grupo,
  etiqueta = EXCLUDED.etiqueta,
  descripcion = EXCLUDED.descripcion,
  orden = EXCLUDED.orden,
  critico = EXCLUDED.critico;

INSERT INTO perfiles_acceso (codigo, nombre, descripcion, sistema, activo, orden)
VALUES (
  'convivencia',
  'Convivencia Escolar',
  'Gestion reservada de situaciones, entrevistas, acuerdos, derivaciones y seguimientos.',
  true,
  true,
  45
)
ON CONFLICT (codigo) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  descripcion = EXCLUDED.descripcion,
  sistema = EXCLUDED.sistema,
  orden = EXCLUDED.orden,
  actualizado_en = CURRENT_TIMESTAMP;

INSERT INTO permisos_rol (rol, permiso_codigo)
SELECT 'admin', codigo
FROM permisos_sistema
WHERE codigo LIKE 'convivencia.%'
ON CONFLICT DO NOTHING;

INSERT INTO permisos_rol (rol, permiso_codigo)
SELECT 'convivencia', codigo
FROM permisos_sistema
WHERE codigo LIKE 'convivencia.%'
ON CONFLICT DO NOTHING;
