-- Esquema inicial para instalaciones nuevas del sistema de asistencia LDSM.
-- Este archivo no elimina tablas y solo se ejecuta cuando no existe el esquema base.

-- System configurations for attendance limits
CREATE TABLE configuracion_asistencia (
  id SERIAL PRIMARY KEY,
  hora_entrada TIME NOT NULL DEFAULT '08:00:00',
  hora_limite_atraso TIME NOT NULL DEFAULT '08:15:00'
);

-- Course/Grade definition
CREATE TABLE curso (
  id_curso SERIAL PRIMARY KEY,
  nombre_curso VARCHAR(100) UNIQUE NOT NULL
);

-- Combined User/Student table containing all school members imported from the ERP
CREATE TABLE alumno (
  id_alumno SERIAL PRIMARY KEY,
  uuid_erp VARCHAR(100) UNIQUE,        -- ERP unique identifier (ID de Usuario)
  rut VARCHAR(12) UNIQUE,               -- Cleaned RUT number without dots and hyphen
  dv CHAR(1),                           -- Verification digit
  documento_erp VARCHAR(64),            -- Documento original cuando no corresponde a un RUT chileno
  tipo_identificador VARCHAR(32),
  tipo_documento_extranjero VARCHAR(32),
  pais_emisor_documento VARCHAR(3),
  nombres VARCHAR(100) NOT NULL,
  paterno VARCHAR(100) NOT NULL,
  materno VARCHAR(100),
  email VARCHAR(150),
  telefono VARCHAR(50),
  rol VARCHAR(50) DEFAULT 'Estudiante', -- Estudiante, Admin, Profesor(a), etc.
  seccion VARCHAR(50),                  -- Course section
  genero VARCHAR(20),
  fecha_nacimiento DATE,
  nombre_usuario VARCHAR(100) UNIQUE,
  rut_apoderado VARCHAR(50),
  activo BOOLEAN DEFAULT true,
  fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  codigo_barra VARCHAR(100) UNIQUE,     -- Printable barcode value (usually clean RUT)
  origen_alta VARCHAR(20) NOT NULL DEFAULT 'LEGACY',
  erp_vinculado_en TIMESTAMPTZ
);

-- Matricula linking alumno and curso
CREATE TABLE matricula (
  id_matricula SERIAL PRIMARY KEY,
  id_alumno INT NOT NULL REFERENCES alumno(id_alumno) ON DELETE CASCADE,
  id_curso INT NOT NULL REFERENCES curso(id_curso) ON DELETE RESTRICT,
  fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_matricula_alumno UNIQUE (id_alumno)
);

-- Attendance scan records
CREATE TABLE attendance_registrations (
  id_registro SERIAL PRIMARY KEY,
  id_alumno INT REFERENCES alumno(id_alumno) ON DELETE SET NULL,
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  hora TIME NOT NULL DEFAULT CURRENT_TIME,
  estado VARCHAR(50) NOT NULL,          -- 'Presente', 'Atrasado', 'Justificado'
  tipo_registro VARCHAR(50) NOT NULL DEFAULT 'Entrada', -- 'Entrada', 'Salida'
  comentario TEXT,
  timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  severidad VARCHAR(20) DEFAULT 'Normal',
  justificado BOOLEAN DEFAULT false,
  tipo_justificacion VARCHAR(50),
  comentario_justificacion TEXT,
  archivo_justificacion VARCHAR(255),
  CONSTRAINT uq_asistencia_alumno_fecha_tipo UNIQUE (id_alumno, fecha, tipo_registro)
);

-- Admin & Scanner user credentials
CREATE TABLE usuarios (
  id SERIAL PRIMARY KEY,
  correo VARCHAR(150) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  rol VARCHAR(20) NOT NULL CONSTRAINT ck_usuarios_rol CHECK (rol IN ('admin', 'secretaria', 'lector')),
  nombre VARCHAR(100),
  cargo VARCHAR(100),
  fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  intentos_fallidos INT DEFAULT 0,
  bloqueado_hasta TIMESTAMPTZ,
  token_version INT DEFAULT 1,
  eliminado_en TIMESTAMPTZ,
  eliminado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  motivo_eliminacion TEXT
);

-- Metadata de certificados y documentos de justificación.
CREATE TABLE justification_documents (
  id_documento SERIAL PRIMARY KEY,
  nombre_original VARCHAR(255) NOT NULL,
  nombre_almacenado VARCHAR(255) UNIQUE NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  tamano_bytes INT NOT NULL CHECK (tamano_bytes > 0 AND tamano_bytes <= 8388608),
  sha256 CHAR(64) NOT NULL,
  creado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Identificadores múltiples por integrante. Las columnas heredadas de alumno
-- se mantienen durante la transición para conservar compatibilidad.
CREATE TABLE alumno_identificador (
  id_identificador BIGSERIAL PRIMARY KEY,
  id_alumno INT NOT NULL REFERENCES alumno(id_alumno) ON DELETE CASCADE,
  tipo VARCHAR(32) NOT NULL CONSTRAINT ck_alumno_identificador_tipo CHECK (
    tipo IN (
      'RUN_CHILE', 'IPE_MINEDUC', 'PASAPORTE', 'DNI', 'CEDULA',
      'DOCUMENTO_EXTRANJERO', 'ID_ERP', 'CODIGO_INTERNO', 'CODIGO_BARRAS'
    )
  ),
  valor_original VARCHAR(160) NOT NULL,
  valor_normalizado VARCHAR(160) NOT NULL,
  pais_emisor VARCHAR(3),
  fuente VARCHAR(32) NOT NULL DEFAULT 'LEGACY' CONSTRAINT ck_alumno_identificador_fuente CHECK (
    fuente IN ('ERP', 'MANUAL', 'MINEDUC', 'REGULARIZACION', 'LEGACY', 'SISTEMA')
  ),
  estado VARCHAR(20) NOT NULL DEFAULT 'VIGENTE' CONSTRAINT ck_alumno_identificador_estado CHECK (
    estado IN ('PRINCIPAL', 'VIGENTE', 'ANTERIOR', 'PENDIENTE', 'REVOCADO')
  ),
  es_principal BOOLEAN NOT NULL DEFAULT false,
  nivel_validacion VARCHAR(40),
  validador_id VARCHAR(80),
  validador_version VARCHAR(20),
  resultado_validacion VARCHAR(24) CONSTRAINT ck_alumno_identificador_resultado_validacion CHECK (
    resultado_validacion IS NULL OR resultado_validacion IN (
      'VERIFICADO', 'ESTRUCTURAL', 'DECLARADO', 'SISTEMA', 'PENDIENTE', 'RECHAZADO'
    )
  ),
  validado_en TIMESTAMPTZ,
  vigente_desde DATE NOT NULL DEFAULT CURRENT_DATE,
  vigente_hasta DATE,
  creado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  respaldo_documento_id INT REFERENCES justification_documents(id_documento) ON DELETE SET NULL,
  metadatos JSONB NOT NULL DEFAULT '{}'::jsonb,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_alumno_identificador_valor CHECK (LENGTH(TRIM(valor_normalizado)) >= 2),
  CONSTRAINT ck_alumno_identificador_vigencia CHECK (
    vigente_hasta IS NULL OR vigente_hasta >= vigente_desde
  ),
  CONSTRAINT ck_alumno_identificador_principal CHECK (
    es_principal = false OR estado = 'PRINCIPAL'
  )
);

CREATE UNIQUE INDEX uq_alumno_identificador_activo
  ON alumno_identificador (tipo, valor_normalizado, COALESCE(pais_emisor, ''))
  WHERE estado <> 'REVOCADO';
CREATE UNIQUE INDEX uq_alumno_identificador_principal
  ON alumno_identificador (id_alumno)
  WHERE es_principal = true AND estado <> 'REVOCADO';
CREATE INDEX idx_alumno_identificador_alumno
  ON alumno_identificador (id_alumno, es_principal DESC, actualizado_en DESC);
CREATE INDEX idx_alumno_identificador_busqueda
  ON alumno_identificador (valor_normalizado)
  WHERE estado <> 'REVOCADO';
CREATE INDEX idx_alumno_identificador_validacion
  ON alumno_identificador (resultado_validacion, tipo, pais_emisor)
  WHERE estado <> 'REVOCADO';

ALTER TABLE attendance_registrations
  ADD COLUMN documento_id INT REFERENCES justification_documents(id_documento) ON DELETE RESTRICT;

-- Audit logs
CREATE TABLE audit_log (
  id SERIAL PRIMARY KEY,
  usuario_id INT REFERENCES usuarios(id) ON DELETE SET NULL,
  usuario_correo VARCHAR(150),
  accion VARCHAR(60) NOT NULL,
  entidad VARCHAR(60),
  entidad_id INT,
  detalle JSONB,
  ip VARCHAR(45),
  fecha TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_log_fecha ON audit_log (fecha DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_accion ON audit_log (accion);
CREATE INDEX IF NOT EXISTS idx_audit_log_correo ON audit_log (usuario_correo);

-- Snapshot of imported rows for diffing and optimization
CREATE TABLE alumno_excel_snapshot (
  id_alumno INT PRIMARY KEY REFERENCES alumno(id_alumno) ON DELETE CASCADE,
  raw_payload JSONB NOT NULL,
  fecha_importacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE schema_migrations (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(255) UNIQUE NOT NULL,
  aplicada_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_asistencia_fecha_tipo ON attendance_registrations (fecha, tipo_registro);
CREATE INDEX IF NOT EXISTS idx_asistencia_alumno_fecha ON attendance_registrations (id_alumno, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_asistencia_documento ON attendance_registrations (documento_id);
