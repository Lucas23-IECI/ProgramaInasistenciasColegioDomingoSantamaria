-- Mensajería institucional vinculada al trabajo real.
-- No implementa cifrado extremo a extremo: la confidencialidad se sostiene
-- mediante HTTPS, membresía explícita, permisos, auditoría y respaldos.

CREATE TABLE IF NOT EXISTS chat_conversaciones (
  id_conversacion BIGSERIAL PRIMARY KEY,
  tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('DIRECTA', 'GRUPO', 'CANAL', 'CONTEXTO')),
  nombre VARCHAR(180),
  descripcion VARCHAR(500),
  clave_dedupe VARCHAR(220),
  contexto_tipo VARCHAR(40),
  contexto_id VARCHAR(80),
  retencion_dias INT CHECK (retencion_dias IS NULL OR retencion_dias >= 30),
  activa BOOLEAN NOT NULL DEFAULT true,
  creada_por INT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  creada_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizada_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_conversacion_dedupe
  ON chat_conversaciones (clave_dedupe)
  WHERE clave_dedupe IS NOT NULL AND activa = true;
CREATE INDEX IF NOT EXISTS idx_chat_conversaciones_contexto
  ON chat_conversaciones (contexto_tipo, contexto_id) WHERE activa = true;

CREATE TABLE IF NOT EXISTS chat_miembros (
  id_conversacion BIGINT NOT NULL REFERENCES chat_conversaciones(id_conversacion) ON DELETE RESTRICT,
  usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  rol VARCHAR(20) NOT NULL DEFAULT 'MIEMBRO' CHECK (rol IN ('PROPIETARIO', 'MODERADOR', 'MIEMBRO')),
  notificaciones VARCHAR(20) NOT NULL DEFAULT 'TODAS' CHECK (notificaciones IN ('TODAS', 'MENCIONES', 'SILENCIADAS')),
  silenciado_hasta TIMESTAMPTZ,
  horario_silencio_desde TIME,
  horario_silencio_hasta TIME,
  ultima_lectura_en TIMESTAMPTZ,
  ultimo_mensaje_leido_id BIGINT,
  activo BOOLEAN NOT NULL DEFAULT true,
  incorporado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  incorporado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  retirado_en TIMESTAMPTZ,
  PRIMARY KEY (id_conversacion, usuario_id)
);

CREATE TABLE IF NOT EXISTS chat_mensajes (
  id_mensaje BIGSERIAL PRIMARY KEY,
  id_conversacion BIGINT NOT NULL REFERENCES chat_conversaciones(id_conversacion) ON DELETE RESTRICT,
  enviado_por INT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  tipo VARCHAR(20) NOT NULL DEFAULT 'NORMAL' CHECK (tipo IN ('NORMAL', 'URGENTE', 'SISTEMA')),
  contenido TEXT NOT NULL,
  responde_a_id BIGINT REFERENCES chat_mensajes(id_mensaje) ON DELETE SET NULL,
  editado_en TIMESTAMPTZ,
  eliminado_en TIMESTAMPTZ,
  eliminado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  motivo_eliminacion VARCHAR(300),
  enviado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_chat_mensaje_contenido CHECK (char_length(trim(contenido)) BETWEEN 1 AND 6000)
);

ALTER TABLE chat_miembros
  DROP CONSTRAINT IF EXISTS fk_chat_miembro_ultimo_mensaje;
ALTER TABLE chat_miembros
  ADD CONSTRAINT fk_chat_miembro_ultimo_mensaje
  FOREIGN KEY (ultimo_mensaje_leido_id) REFERENCES chat_mensajes(id_mensaje) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS chat_menciones (
  id_mensaje BIGINT NOT NULL REFERENCES chat_mensajes(id_mensaje) ON DELETE RESTRICT,
  usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  leida_en TIMESTAMPTZ,
  PRIMARY KEY (id_mensaje, usuario_id)
);

CREATE TABLE IF NOT EXISTS chat_lecturas (
  id_mensaje BIGINT NOT NULL REFERENCES chat_mensajes(id_mensaje) ON DELETE RESTRICT,
  usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  leido_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_mensaje, usuario_id)
);

CREATE TABLE IF NOT EXISTS chat_adjuntos (
  id_adjunto BIGSERIAL PRIMARY KEY,
  id_mensaje BIGINT NOT NULL REFERENCES chat_mensajes(id_mensaje) ON DELETE RESTRICT,
  id_documento INT NOT NULL UNIQUE REFERENCES justification_documents(id_documento) ON DELETE RESTRICT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chat_mensajes_fijados (
  id_conversacion BIGINT NOT NULL REFERENCES chat_conversaciones(id_conversacion) ON DELETE RESTRICT,
  id_mensaje BIGINT NOT NULL REFERENCES chat_mensajes(id_mensaje) ON DELETE RESTRICT,
  fijado_por INT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  fijado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_conversacion, id_mensaje)
);

CREATE TABLE IF NOT EXISTS chat_vinculos (
  id_conversacion BIGINT NOT NULL REFERENCES chat_conversaciones(id_conversacion) ON DELETE RESTRICT,
  entidad_tipo VARCHAR(40) NOT NULL CHECK (entidad_tipo IN ('ESTUDIANTE', 'RETIRO', 'VISITA', 'SEGUIMIENTO', 'CONVIVENCIA', 'DOCUMENTO')),
  entidad_id VARCHAR(80) NOT NULL,
  creado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_conversacion, entidad_tipo, entidad_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_miembros_usuario
  ON chat_miembros (usuario_id, activo, id_conversacion);
CREATE INDEX IF NOT EXISTS idx_chat_mensajes_conversacion
  ON chat_mensajes (id_conversacion, enviado_en DESC, id_mensaje DESC);
CREATE INDEX IF NOT EXISTS idx_chat_menciones_usuario
  ON chat_menciones (usuario_id, leida_en);
CREATE INDEX IF NOT EXISTS idx_chat_lecturas_usuario
  ON chat_lecturas (usuario_id, leido_en DESC);
CREATE INDEX IF NOT EXISTS idx_chat_vinculos_entidad
  ON chat_vinculos (entidad_tipo, entidad_id);

INSERT INTO permisos_sistema (codigo, grupo, etiqueta, descripcion, orden, critico) VALUES
  ('chat.access', 'Comunicación institucional', 'Usar chat interno', 'Permite acceder a conversaciones donde la cuenta es miembro.', 650, true),
  ('chat.direct.create', 'Comunicación institucional', 'Iniciar conversaciones directas', 'Permite iniciar una conversación institucional con otra cuenta activa.', 651, true),
  ('chat.group.create', 'Comunicación institucional', 'Crear grupos de trabajo', 'Permite crear conversaciones grupales e incorporar miembros.', 652, true),
  ('chat.channels.manage', 'Comunicación institucional', 'Administrar canales', 'Permite crear y configurar canales institucionales y sus miembros.', 653, true),
  ('chat.urgent', 'Comunicación institucional', 'Enviar mensajes urgentes', 'Permite marcar mensajes como urgentes con tratamiento visual prioritario.', 654, true),
  ('chat.attach', 'Comunicación institucional', 'Adjuntar archivos al chat', 'Permite adjuntar archivos validados a conversaciones institucionales.', 655, true),
  ('chat.moderate', 'Comunicación institucional', 'Moderar conversaciones', 'Permite retirar mensajes con motivo y trazabilidad dentro de conversaciones administradas.', 656, true)
ON CONFLICT (codigo) DO UPDATE SET
  grupo = EXCLUDED.grupo,
  etiqueta = EXCLUDED.etiqueta,
  descripcion = EXCLUDED.descripcion,
  orden = EXCLUDED.orden,
  critico = EXCLUDED.critico;

INSERT INTO perfiles_acceso (codigo, nombre, descripcion, sistema, activo, orden)
VALUES ('comunicaciones', 'Comunicaciones Institucionales', 'Conversaciones directas, grupos, canales y comunicaciones vinculadas a casos.', true, true, 48)
ON CONFLICT (codigo) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  descripcion = EXCLUDED.descripcion,
  sistema = EXCLUDED.sistema,
  orden = EXCLUDED.orden,
  actualizado_en = CURRENT_TIMESTAMP;

INSERT INTO permisos_rol (rol, permiso_codigo)
SELECT 'admin', codigo FROM permisos_sistema WHERE codigo LIKE 'chat.%'
ON CONFLICT DO NOTHING;

INSERT INTO permisos_rol (rol, permiso_codigo)
SELECT p.codigo, permiso.codigo
FROM perfiles_acceso p
CROSS JOIN (VALUES ('chat.access'), ('chat.direct.create'), ('chat.attach')) AS permiso(codigo)
WHERE p.activo = true AND p.codigo <> 'personalizado'
ON CONFLICT DO NOTHING;

INSERT INTO permisos_rol (rol, permiso_codigo) VALUES
  ('direccion', 'chat.group.create'),
  ('direccion', 'chat.channels.manage'),
  ('direccion', 'chat.urgent'),
  ('direccion', 'chat.moderate'),
  ('inspector', 'chat.group.create'),
  ('inspector', 'chat.urgent'),
  ('convivencia', 'chat.group.create'),
  ('convivencia', 'chat.urgent'),
  ('seguimiento', 'chat.group.create'),
  ('seguimiento', 'chat.urgent')
ON CONFLICT DO NOTHING;
