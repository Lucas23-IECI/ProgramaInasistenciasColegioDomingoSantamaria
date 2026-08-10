-- Centro institucional de seguimiento de estudiantes y familias.
-- Migración aditiva: no modifica ni elimina atrasos, matrículas, visitas,
-- retiros, documentos, perfiles ni casos de convivencia existentes.

CREATE TABLE IF NOT EXISTS seguimiento_reglas (
  codigo VARCHAR(64) PRIMARY KEY,
  nombre VARCHAR(160) NOT NULL,
  descripcion VARCHAR(500) NOT NULL,
  tipo_senal VARCHAR(48) NOT NULL,
  umbral INT NOT NULL DEFAULT 1 CHECK (umbral > 0),
  ventana_dias INT CHECK (ventana_dias IS NULL OR ventana_dias > 0),
  prioridad VARCHAR(16) NOT NULL DEFAULT 'MEDIA' CHECK (prioridad IN ('BAJA', 'MEDIA', 'ALTA', 'URGENTE')),
  plazo_dias INT NOT NULL DEFAULT 5 CHECK (plazo_dias > 0),
  activa BOOLEAN NOT NULL DEFAULT true,
  configuracion JSONB NOT NULL DEFAULT '{}'::jsonb,
  creada_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizada_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizada_por INT REFERENCES usuarios(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS seguimiento_casos (
  id_caso BIGSERIAL PRIMARY KEY,
  codigo VARCHAR(32) UNIQUE,
  titulo VARCHAR(180) NOT NULL,
  motivo_apertura TEXT NOT NULL,
  origen VARCHAR(20) NOT NULL DEFAULT 'MANUAL' CHECK (origen IN ('AUTOMATICO', 'MANUAL', 'DERIVACION')),
  regla_codigo VARCHAR(64) REFERENCES seguimiento_reglas(codigo) ON DELETE SET NULL,
  clave_dedupe VARCHAR(180),
  prioridad VARCHAR(16) NOT NULL DEFAULT 'MEDIA' CHECK (prioridad IN ('BAJA', 'MEDIA', 'ALTA', 'URGENTE')),
  estado VARCHAR(24) NOT NULL DEFAULT 'ABIERTO' CHECK (
    estado IN ('ABIERTO', 'ASIGNADO', 'EN_CONTACTO', 'EN_SEGUIMIENTO', 'ESCALADO', 'RESUELTO', 'CERRADO', 'ANULADO')
  ),
  estudiante_principal_id INT REFERENCES alumno(id_alumno) ON DELETE RESTRICT,
  responsable_usuario_id INT REFERENCES usuarios(id) ON DELETE SET NULL,
  fecha_limite DATE,
  resultado_final TEXT,
  convivencia_caso_id INT REFERENCES convivencia_casos(id_caso) ON DELETE SET NULL,
  retiro_id BIGINT REFERENCES retiros_alumno(id) ON DELETE SET NULL,
  visita_id BIGINT REFERENCES visitas(id) ON DELETE SET NULL,
  creado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  actualizado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  cerrado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cerrado_en TIMESTAMPTZ,
  version INT NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT ck_seguimiento_cierre CHECK (
    (estado IN ('CERRADO', 'ANULADO') AND cerrado_en IS NOT NULL)
    OR estado NOT IN ('CERRADO', 'ANULADO')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_seguimiento_caso_automatico_abierto
  ON seguimiento_casos (clave_dedupe)
  WHERE clave_dedupe IS NOT NULL AND estado NOT IN ('CERRADO', 'ANULADO');

CREATE TABLE IF NOT EXISTS seguimiento_caso_estudiantes (
  id_caso BIGINT NOT NULL REFERENCES seguimiento_casos(id_caso) ON DELETE RESTRICT,
  id_alumno INT NOT NULL REFERENCES alumno(id_alumno) ON DELETE RESTRICT,
  relacion VARCHAR(24) NOT NULL DEFAULT 'PRINCIPAL' CHECK (relacion IN ('PRINCIPAL', 'HERMANO', 'RELACIONADO', 'OTRO')),
  agregado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  agregado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_caso, id_alumno)
);

CREATE TABLE IF NOT EXISTS seguimiento_senales (
  id_senal BIGSERIAL PRIMARY KEY,
  regla_codigo VARCHAR(64) NOT NULL REFERENCES seguimiento_reglas(codigo) ON DELETE RESTRICT,
  clave VARCHAR(180) NOT NULL,
  entidad_tipo VARCHAR(40) NOT NULL,
  entidad_id VARCHAR(80) NOT NULL,
  id_alumno INT REFERENCES alumno(id_alumno) ON DELETE RESTRICT,
  id_caso BIGINT REFERENCES seguimiento_casos(id_caso) ON DELETE SET NULL,
  activa BOOLEAN NOT NULL DEFAULT true,
  ocurrencias INT NOT NULL DEFAULT 1 CHECK (ocurrencias >= 0),
  detectada_primera_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  detectada_ultima_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resuelta_en TIMESTAMPTZ,
  datos JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (regla_codigo, clave)
);

CREATE TABLE IF NOT EXISTS seguimiento_tareas (
  id_tarea BIGSERIAL PRIMARY KEY,
  id_caso BIGINT NOT NULL REFERENCES seguimiento_casos(id_caso) ON DELETE RESTRICT,
  titulo VARCHAR(180) NOT NULL,
  detalle TEXT,
  estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE', 'EN_PROGRESO', 'COMPLETADA', 'CANCELADA')),
  prioridad VARCHAR(16) NOT NULL DEFAULT 'MEDIA' CHECK (prioridad IN ('BAJA', 'MEDIA', 'ALTA', 'URGENTE')),
  responsable_usuario_id INT REFERENCES usuarios(id) ON DELETE SET NULL,
  fecha_limite DATE,
  completada_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  completada_en TIMESTAMPTZ,
  creada_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  creada_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizada_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS seguimiento_notas (
  id_nota BIGSERIAL PRIMARY KEY,
  id_caso BIGINT NOT NULL REFERENCES seguimiento_casos(id_caso) ON DELETE RESTRICT,
  contenido TEXT NOT NULL,
  interna BOOLEAN NOT NULL DEFAULT true,
  creada_por INT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  creada_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  editada_en TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS seguimiento_contactos (
  id_contacto BIGSERIAL PRIMARY KEY,
  id_caso BIGINT NOT NULL REFERENCES seguimiento_casos(id_caso) ON DELETE RESTRICT,
  tipo VARCHAR(24) NOT NULL CHECK (tipo IN ('LLAMADA', 'MENSAJE', 'CORREO', 'ENTREVISTA', 'REUNION', 'OTRO')),
  destinatario VARCHAR(180) NOT NULL,
  resultado VARCHAR(24) NOT NULL CHECK (resultado IN ('CONTACTADO', 'SIN_RESPUESTA', 'REPROGRAMADO', 'RECHAZADO', 'ACUERDO', 'OTRO')),
  detalle TEXT,
  realizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  registrado_por INT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  proximo_contacto_en TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS seguimiento_acuerdos (
  id_acuerdo BIGSERIAL PRIMARY KEY,
  id_caso BIGINT NOT NULL REFERENCES seguimiento_casos(id_caso) ON DELETE RESTRICT,
  descripcion TEXT NOT NULL,
  responsable VARCHAR(180),
  fecha_compromiso DATE,
  estado VARCHAR(20) NOT NULL DEFAULT 'VIGENTE' CHECK (estado IN ('VIGENTE', 'CUMPLIDO', 'INCUMPLIDO', 'ANULADO')),
  registrado_por INT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  registrado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS seguimiento_documentos (
  id_seguimiento_documento BIGSERIAL PRIMARY KEY,
  id_caso BIGINT NOT NULL REFERENCES seguimiento_casos(id_caso) ON DELETE RESTRICT,
  id_documento INT NOT NULL UNIQUE REFERENCES justification_documents(id_documento) ON DELETE RESTRICT,
  descripcion VARCHAR(300),
  activo BOOLEAN NOT NULL DEFAULT true,
  creado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS seguimiento_eventos (
  id_evento BIGSERIAL PRIMARY KEY,
  id_caso BIGINT NOT NULL REFERENCES seguimiento_casos(id_caso) ON DELETE RESTRICT,
  tipo VARCHAR(40) NOT NULL,
  titulo VARCHAR(180) NOT NULL,
  detalle TEXT,
  metadatos JSONB NOT NULL DEFAULT '{}'::jsonb,
  realizado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  realizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_seguimiento_casos_operacion
  ON seguimiento_casos (estado, prioridad, fecha_limite, actualizado_en DESC);
CREATE INDEX IF NOT EXISTS idx_seguimiento_casos_estudiante
  ON seguimiento_casos (estudiante_principal_id, estado, actualizado_en DESC);
CREATE INDEX IF NOT EXISTS idx_seguimiento_casos_responsable
  ON seguimiento_casos (responsable_usuario_id, estado, fecha_limite);
CREATE INDEX IF NOT EXISTS idx_seguimiento_senales_estado
  ON seguimiento_senales (activa, regla_codigo, detectada_ultima_en DESC);
CREATE INDEX IF NOT EXISTS idx_seguimiento_tareas_caso
  ON seguimiento_tareas (id_caso, estado, fecha_limite);
CREATE INDEX IF NOT EXISTS idx_seguimiento_eventos_caso
  ON seguimiento_eventos (id_caso, realizado_en DESC, id_evento DESC);

INSERT INTO seguimiento_reglas (codigo, nombre, descripcion, tipo_senal, umbral, ventana_dias, prioridad, plazo_dias, activa) VALUES
  ('ATRASOS_PREVENTIVOS', 'Tres atrasos en treinta días', 'Abre seguimiento preventivo al alcanzar tres atrasos registrados en los últimos treinta días.', 'ATRASOS', 3, 30, 'MEDIA', 3, true),
  ('ATRASOS_CRITICOS', 'Cinco atrasos en treinta días', 'Escala la prioridad cuando se registran cinco atrasos en los últimos treinta días.', 'ATRASOS', 5, 30, 'ALTA', 2, true),
  ('ALTA_MANUAL_SIN_ERP', 'Alta manual sin vínculo ERP', 'Detecta estudiantes creados manualmente que todavía no están vinculados con el ERP.', 'CALIDAD_PADRON', 1, NULL, 'MEDIA', 5, true),
  ('ESTUDIANTE_SIN_CURSO', 'Estudiante sin curso vigente', 'Detecta estudiantes activos sin matrícula vigente.', 'CALIDAD_PADRON', 1, NULL, 'ALTA', 2, true),
  ('ESTUDIANTE_SIN_APODERADO', 'Estudiante sin apoderado vigente', 'Detecta estudiantes activos sin persona responsable o autorizada vigente.', 'FAMILIA', 1, NULL, 'MEDIA', 5, true),
  ('RETIROS_REITERADOS', 'Retiros anticipados reiterados', 'Detecta tres retiros entregados durante los últimos treinta días.', 'RETIROS', 3, 30, 'MEDIA', 3, true),
  ('JUSTIFICACION_PENDIENTE', 'Justificación de atraso pendiente', 'Detecta atrasos de días anteriores que continúan sin justificación.', 'PUNTUALIDAD', 1, 30, 'MEDIA', 3, true),
  ('VISITA_SIN_CERRAR', 'Visita abierta fuera de plazo', 'Detecta visitas que continúan abiertas después de doce horas.', 'OPERACION', 1, NULL, 'ALTA', 1, true),
  ('RETIRO_SIN_CERRAR', 'Retiro pendiente fuera de plazo', 'Detecta retiros solicitados o autorizados sin resolución después de doce horas.', 'OPERACION', 1, NULL, 'ALTA', 1, true),
  ('CONFLICTO_IDENTIDAD', 'Conflicto de identidad pendiente', 'Detecta conflictos de identidad del padrón que requieren revisión humana.', 'IDENTIDAD', 1, NULL, 'URGENTE', 1, true)
ON CONFLICT (codigo) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  descripcion = EXCLUDED.descripcion,
  tipo_senal = EXCLUDED.tipo_senal,
  umbral = EXCLUDED.umbral,
  ventana_dias = EXCLUDED.ventana_dias,
  prioridad = EXCLUDED.prioridad,
  plazo_dias = EXCLUDED.plazo_dias;

INSERT INTO permisos_sistema (codigo, grupo, etiqueta, descripcion, orden, critico) VALUES
  ('seguimiento.view', 'Seguimiento institucional', 'Consultar seguimientos', 'Consulta casos, tareas, contactos, acuerdos y líneas de tiempo institucionales.', 600, true),
  ('seguimiento.create', 'Seguimiento institucional', 'Abrir seguimientos', 'Permite abrir casos manuales o derivados asociados a estudiantes y familias.', 601, true),
  ('seguimiento.manage', 'Seguimiento institucional', 'Gestionar seguimientos', 'Permite actualizar prioridad, estado, tareas, notas y acuerdos.', 602, true),
  ('seguimiento.assign', 'Seguimiento institucional', 'Asignar responsables', 'Permite asignar o cambiar la persona responsable y los plazos.', 603, true),
  ('seguimiento.contacts', 'Seguimiento institucional', 'Registrar contactos', 'Permite registrar llamadas, mensajes, entrevistas y sus resultados.', 604, true),
  ('seguimiento.documents', 'Seguimiento institucional', 'Gestionar documentos', 'Permite adjuntar y descargar documentos protegidos de un seguimiento.', 605, true),
  ('seguimiento.close', 'Seguimiento institucional', 'Cerrar seguimientos', 'Permite resolver, cerrar, reabrir o anular seguimientos con motivo obligatorio.', 606, true),
  ('seguimiento.automation.manage', 'Seguimiento institucional', 'Administrar automatizaciones', 'Permite ejecutar, activar y configurar reglas automáticas de detección.', 607, true)
ON CONFLICT (codigo) DO UPDATE SET
  grupo = EXCLUDED.grupo,
  etiqueta = EXCLUDED.etiqueta,
  descripcion = EXCLUDED.descripcion,
  orden = EXCLUDED.orden,
  critico = EXCLUDED.critico;

INSERT INTO perfiles_acceso (codigo, nombre, descripcion, sistema, activo, orden)
VALUES ('seguimiento', 'Seguimiento Institucional', 'Gestión preventiva de casos, tareas, contactos y acuerdos con trazabilidad.', true, true, 47)
ON CONFLICT (codigo) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  descripcion = EXCLUDED.descripcion,
  sistema = EXCLUDED.sistema,
  orden = EXCLUDED.orden,
  actualizado_en = CURRENT_TIMESTAMP;

INSERT INTO permisos_rol (rol, permiso_codigo)
SELECT 'admin', codigo FROM permisos_sistema WHERE codigo LIKE 'seguimiento.%'
ON CONFLICT DO NOTHING;

INSERT INTO permisos_rol (rol, permiso_codigo) VALUES
  ('inspector', 'seguimiento.view'),
  ('inspector', 'seguimiento.create'),
  ('inspector', 'seguimiento.manage'),
  ('inspector', 'seguimiento.assign'),
  ('inspector', 'seguimiento.contacts'),
  ('inspector', 'seguimiento.documents'),
  ('inspector', 'seguimiento.close'),
  ('direccion', 'seguimiento.view'),
  ('direccion', 'seguimiento.create'),
  ('direccion', 'seguimiento.manage'),
  ('direccion', 'seguimiento.assign'),
  ('direccion', 'seguimiento.contacts'),
  ('direccion', 'seguimiento.documents'),
  ('direccion', 'seguimiento.close'),
  ('direccion', 'seguimiento.automation.manage'),
  ('secretaria', 'seguimiento.view'),
  ('secretaria', 'seguimiento.create'),
  ('secretaria', 'seguimiento.contacts'),
  ('secretaria', 'seguimiento.documents'),
  ('convivencia', 'seguimiento.view'),
  ('convivencia', 'seguimiento.create'),
  ('convivencia', 'seguimiento.manage'),
  ('convivencia', 'seguimiento.assign'),
  ('convivencia', 'seguimiento.contacts'),
  ('convivencia', 'seguimiento.documents'),
  ('convivencia', 'seguimiento.close')
ON CONFLICT DO NOTHING;
