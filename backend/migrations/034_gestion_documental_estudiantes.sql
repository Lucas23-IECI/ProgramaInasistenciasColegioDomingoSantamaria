-- Expediente documental protegido por estudiante.
-- Migracion aditiva: no reemplaza adjuntos ni modifica atrasos, matriculas o convivencia.

CREATE TABLE IF NOT EXISTS expedientes_documentales (
  id_expediente SERIAL PRIMARY KEY,
  id_alumno INT NOT NULL UNIQUE REFERENCES alumno(id_alumno) ON DELETE RESTRICT,
  estado VARCHAR(16) NOT NULL DEFAULT 'ACTIVO' CONSTRAINT ck_expediente_estado CHECK (
    estado IN ('ACTIVO', 'ARCHIVADO')
  ),
  creado_por INT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  actualizado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS documentos_expediente (
  id_documento_expediente SERIAL PRIMARY KEY,
  id_expediente INT NOT NULL REFERENCES expedientes_documentales(id_expediente) ON DELETE RESTRICT,
  categoria VARCHAR(32) NOT NULL CONSTRAINT ck_documento_expediente_categoria CHECK (
    categoria IN (
      'CERTIFICADO', 'JUSTIFICACION', 'AUTORIZACION', 'ACTA', 'COMPROMISO',
      'IDENTIDAD', 'MATRICULA', 'FAMILIAR', 'CONVIVENCIA', 'OTRO'
    )
  ),
  titulo VARCHAR(180) NOT NULL,
  descripcion VARCHAR(600),
  estado VARCHAR(20) NOT NULL DEFAULT 'VIGENTE' CONSTRAINT ck_documento_expediente_estado CHECK (
    estado IN ('PENDIENTE', 'VIGENTE', 'VENCIDO', 'ARCHIVADO')
  ),
  nivel_acceso VARCHAR(20) NOT NULL DEFAULT 'RESERVADO' CONSTRAINT ck_documento_nivel_acceso CHECK (
    nivel_acceso IN ('INSTITUCIONAL', 'RESERVADO', 'MUY_RESERVADO')
  ),
  vigente_desde DATE,
  vence_en DATE,
  responsable_usuario_id INT REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_por INT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  actualizado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  version_registro INT NOT NULL DEFAULT 1 CHECK (version_registro > 0),
  CONSTRAINT ck_documento_vigencia CHECK (
    vigente_desde IS NULL OR vence_en IS NULL OR vence_en >= vigente_desde
  )
);

CREATE TABLE IF NOT EXISTS documento_expediente_versiones (
  id_version SERIAL PRIMARY KEY,
  id_documento_expediente INT NOT NULL REFERENCES documentos_expediente(id_documento_expediente) ON DELETE RESTRICT,
  numero_version INT NOT NULL CHECK (numero_version > 0),
  id_documento INT NOT NULL UNIQUE REFERENCES justification_documents(id_documento) ON DELETE RESTRICT,
  origen VARCHAR(20) NOT NULL DEFAULT 'CARGA' CONSTRAINT ck_documento_version_origen CHECK (
    origen IN ('CARGA', 'PLANTILLA', 'MIGRACION')
  ),
  notas_version VARCHAR(600),
  ocr_estado VARCHAR(24) NOT NULL DEFAULT 'NO_SOLICITADO' CONSTRAINT ck_documento_ocr_estado CHECK (
    ocr_estado IN ('NO_SOLICITADO', 'PENDIENTE', 'PROPUESTO', 'REVISADO', 'RECHAZADO', 'NO_COMPATIBLE', 'ERROR')
  ),
  ocr_texto_propuesto TEXT,
  ocr_datos_propuestos JSONB NOT NULL DEFAULT '{}'::jsonb,
  ocr_confianza NUMERIC(5,2),
  ocr_motor VARCHAR(80),
  ocr_revisado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  ocr_revisado_en TIMESTAMPTZ,
  creado_por INT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id_documento_expediente, numero_version),
  CONSTRAINT ck_documento_ocr_confianza CHECK (
    ocr_confianza IS NULL OR (ocr_confianza >= 0 AND ocr_confianza <= 100)
  )
);

CREATE TABLE IF NOT EXISTS firmas_documentales (
  id_firma SERIAL PRIMARY KEY,
  id_version INT NOT NULL REFERENCES documento_expediente_versiones(id_version) ON DELETE RESTRICT,
  tipo VARCHAR(20) NOT NULL CONSTRAINT ck_firma_documental_tipo CHECK (
    tipo IN ('REVISION', 'CONFORMIDAD', 'APROBACION')
  ),
  firmante_usuario_id INT REFERENCES usuarios(id) ON DELETE SET NULL,
  firmante_nombre VARCHAR(180) NOT NULL,
  firmante_cargo VARCHAR(180),
  declaracion VARCHAR(600) NOT NULL,
  sha256_version CHAR(64) NOT NULL,
  firmada_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revocada_en TIMESTAMPTZ,
  revocada_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  motivo_revocacion VARCHAR(600),
  UNIQUE (id_version, tipo, firmante_usuario_id, firmada_en)
);

CREATE TABLE IF NOT EXISTS plantillas_documentales (
  id_plantilla SERIAL PRIMARY KEY,
  codigo VARCHAR(48) NOT NULL UNIQUE,
  nombre VARCHAR(180) NOT NULL,
  categoria VARCHAR(32) NOT NULL CONSTRAINT ck_plantilla_documental_categoria CHECK (
    categoria IN ('CERTIFICADO', 'JUSTIFICACION', 'AUTORIZACION', 'ACTA', 'COMPROMISO', 'MATRICULA', 'FAMILIAR', 'OTRO')
  ),
  descripcion VARCHAR(600),
  contenido TEXT NOT NULL,
  campos_permitidos JSONB NOT NULL DEFAULT '[]'::jsonb,
  activa BOOLEAN NOT NULL DEFAULT true,
  sistema BOOLEAN NOT NULL DEFAULT false,
  creado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  actualizado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_expedientes_documentales_alumno
  ON expedientes_documentales (id_alumno, estado);
CREATE INDEX IF NOT EXISTS idx_documentos_expediente_vigencia
  ON documentos_expediente (id_expediente, estado, vence_en, actualizado_en DESC);
CREATE INDEX IF NOT EXISTS idx_documentos_expediente_categoria
  ON documentos_expediente (categoria, estado, vence_en);
CREATE INDEX IF NOT EXISTS idx_documento_versiones_documento
  ON documento_expediente_versiones (id_documento_expediente, numero_version DESC);
CREATE INDEX IF NOT EXISTS idx_documento_versiones_ocr
  ON documento_expediente_versiones (ocr_estado, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_firmas_documentales_version
  ON firmas_documentales (id_version, firmada_en DESC) WHERE revocada_en IS NULL;

INSERT INTO permisos_sistema (codigo, grupo, etiqueta, descripcion, orden, critico) VALUES
  ('documents.view', 'Gestion documental', 'Consultar expedientes documentales', 'Permite consultar expedientes, vigencias y versiones documentales de estudiantes.', 520, true),
  ('documents.upload', 'Gestion documental', 'Incorporar documentos', 'Permite crear documentos y cargar nuevas versiones protegidas.', 521, true),
  ('documents.manage', 'Gestion documental', 'Gestionar vigencias y metadatos', 'Permite editar clasificacion, responsable, vigencia y archivar documentos.', 522, true),
  ('documents.sign', 'Gestion documental', 'Firmar documentos internamente', 'Permite registrar revisiones, conformidades y aprobaciones autenticadas.', 523, true),
  ('documents.templates', 'Gestion documental', 'Gestionar plantillas y generar PDF', 'Permite mantener plantillas institucionales y generar documentos PDF.', 524, true),
  ('documents.ocr', 'Gestion documental', 'Extraer y revisar datos mediante OCR', 'Permite solicitar OCR local y aprobar o rechazar sus propuestas.', 525, true)
ON CONFLICT (codigo) DO UPDATE SET
  grupo = EXCLUDED.grupo,
  etiqueta = EXCLUDED.etiqueta,
  descripcion = EXCLUDED.descripcion,
  orden = EXCLUDED.orden,
  critico = EXCLUDED.critico;

INSERT INTO perfiles_acceso (codigo, nombre, descripcion, sistema, activo, orden)
VALUES (
  'documental',
  'Gestion Documental',
  'Expedientes protegidos, vigencias, versiones, firmas internas, plantillas y OCR revisable.',
  true,
  true,
  46
)
ON CONFLICT (codigo) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  descripcion = EXCLUDED.descripcion,
  sistema = EXCLUDED.sistema,
  orden = EXCLUDED.orden,
  actualizado_en = CURRENT_TIMESTAMP;

INSERT INTO permisos_rol (rol, permiso_codigo)
SELECT 'admin', codigo FROM permisos_sistema WHERE codigo LIKE 'documents.%'
ON CONFLICT DO NOTHING;

INSERT INTO permisos_rol (rol, permiso_codigo)
SELECT 'documental', codigo FROM permisos_sistema WHERE codigo LIKE 'documents.%'
ON CONFLICT DO NOTHING;

INSERT INTO plantillas_documentales (
  codigo, nombre, categoria, descripcion, contenido, campos_permitidos, sistema
) VALUES
  (
    'CERTIFICADO_MATRICULA',
    'Certificado de matricula',
    'CERTIFICADO',
    'Constancia institucional de matricula vigente.',
    'Se certifica que {{estudiante_nombre}}, identificado/a con {{estudiante_documento}}, mantiene matricula vigente en {{curso}}.\n\nFecha de emision: {{fecha_emision}}.\n\nObservacion: {{observacion}}',
    '["estudiante_nombre", "estudiante_documento", "curso", "fecha_emision", "observacion"]'::jsonb,
    true
  ),
  (
    'AUTORIZACION_INSTITUCIONAL',
    'Autorizacion institucional',
    'AUTORIZACION',
    'Documento base para registrar una autorizacion informada.',
    'Yo, {{responsable_nombre}}, declaro autorizar a {{estudiante_nombre}} para {{detalle}}.\n\nVigencia: {{vigencia}}.\nFecha: {{fecha_emision}}.',
    '["responsable_nombre", "estudiante_nombre", "detalle", "vigencia", "fecha_emision"]'::jsonb,
    true
  ),
  (
    'COMPROMISO_INSTITUCIONAL',
    'Compromiso institucional',
    'COMPROMISO',
    'Acta breve para formalizar compromisos y fechas de revision.',
    'En relacion con {{materia}}, se acuerda el siguiente compromiso: {{detalle}}.\n\nResponsable: {{responsable_nombre}}.\nFecha de revision: {{fecha_revision}}.\nFecha de emision: {{fecha_emision}}.',
    '["materia", "detalle", "responsable_nombre", "fecha_revision", "fecha_emision"]'::jsonb,
    true
  )
ON CONFLICT (codigo) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  categoria = EXCLUDED.categoria,
  descripcion = EXCLUDED.descripcion,
  contenido = EXCLUDED.contenido,
  campos_permitidos = EXCLUDED.campos_permitidos,
  sistema = EXCLUDED.sistema,
  actualizado_en = CURRENT_TIMESTAMP;
