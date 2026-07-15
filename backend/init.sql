-- Database initialization script for LDSM Attendance System

DROP TABLE IF EXISTS attendance_registrations CASCADE;
DROP TABLE IF EXISTS configuracion_asistencia CASCADE;
DROP TABLE IF EXISTS alumno_excel_snapshot CASCADE;
DROP TABLE IF EXISTS matricula CASCADE;
DROP TABLE IF EXISTS curso CASCADE;
DROP TABLE IF EXISTS alumno CASCADE;
DROP TABLE IF EXISTS usuarios CASCADE;
DROP TABLE IF EXISTS audit_log CASCADE;

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
  contrasena VARCHAR(255),
  rut_apoderado VARCHAR(50),
  activo BOOLEAN DEFAULT true,
  fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  codigo_barra VARCHAR(100) UNIQUE      -- Printable barcode value (usually clean RUT)
);

-- Matricula linking alumno and curso
CREATE TABLE matricula (
  id_matricula SERIAL PRIMARY KEY,
  id_alumno INT REFERENCES alumno(id_alumno) ON DELETE CASCADE,
  id_curso INT REFERENCES curso(id_curso) ON DELETE CASCADE,
  fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  severidad VARCHAR(20) DEFAULT 'Normal',
  justificado BOOLEAN DEFAULT false,
  tipo_justificacion VARCHAR(50),
  comentario_justificacion TEXT,
  archivo_justificacion VARCHAR(255)
);

-- Admin & Scanner user credentials
CREATE TABLE usuarios (
  id SERIAL PRIMARY KEY,
  correo VARCHAR(150) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  rol VARCHAR(20) NOT NULL,             -- 'admin', 'lector'
  nombre VARCHAR(100),
  fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  intentos_fallidos INT DEFAULT 0,
  bloqueado_hasta TIMESTAMP,
  token_version INT DEFAULT 1
);

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
  fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_log_fecha ON audit_log (fecha DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_accion ON audit_log (accion);
CREATE INDEX IF NOT EXISTS idx_audit_log_correo ON audit_log (usuario_correo);

-- Snapshot of imported rows for diffing and optimization
CREATE TABLE alumno_excel_snapshot (
  id_alumno INT PRIMARY KEY REFERENCES alumno(id_alumno) ON DELETE CASCADE,
  raw_payload JSONB NOT NULL,
  fecha_importacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
