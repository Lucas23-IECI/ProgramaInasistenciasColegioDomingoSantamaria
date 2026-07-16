-- Eliminar credenciales ERP almacenadas y sanear snapshots históricos.
UPDATE alumno_excel_snapshot
SET raw_payload = raw_payload - ARRAY['Contraseña', 'Contrasena', 'contrasena', 'password', 'Password', 'clave', 'Clave']
WHERE raw_payload ?| ARRAY['Contraseña', 'Contrasena', 'contrasena', 'password', 'Password', 'clave', 'Clave'];

ALTER TABLE alumno DROP COLUMN IF EXISTS contrasena;

-- Conservar una sola matrícula actual por alumno. La matrícula histórica se diseñará en otra etapa.
DELETE FROM matricula
WHERE id_alumno IS NULL OR id_curso IS NULL;

DELETE FROM matricula anterior
USING matricula reciente
WHERE anterior.id_alumno = reciente.id_alumno
  AND anterior.id_matricula < reciente.id_matricula;

ALTER TABLE matricula ALTER COLUMN id_alumno SET NOT NULL;
ALTER TABLE matricula ALTER COLUMN id_curso SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'matricula'::regclass
      AND conname = 'uq_matricula_alumno'
  ) THEN
    ALTER TABLE matricula ADD CONSTRAINT uq_matricula_alumno UNIQUE (id_alumno);
  END IF;
END $$;

-- Nunca decidir automáticamente qué registro de asistencia duplicado conservar.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM attendance_registrations
    WHERE id_alumno IS NOT NULL
    GROUP BY id_alumno, fecha, tipo_registro
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Existen registros de asistencia duplicados. Deben revisarse antes de aplicar la restricción única.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'attendance_registrations'::regclass
      AND conname = 'uq_asistencia_alumno_fecha_tipo'
  ) THEN
    ALTER TABLE attendance_registrations
      ADD CONSTRAINT uq_asistencia_alumno_fecha_tipo UNIQUE (id_alumno, fecha, tipo_registro);
  END IF;
END $$;

-- Roles válidos para cuentas del sistema.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'usuarios'::regclass
      AND conname = 'ck_usuarios_rol'
  ) THEN
    ALTER TABLE usuarios
      ADD CONSTRAINT ck_usuarios_rol CHECK (rol IN ('admin', 'secretaria', 'lector'));
  END IF;
END $$;

-- Documentos compartibles entre varios días justificados.
CREATE TABLE IF NOT EXISTS justification_documents (
  id_documento SERIAL PRIMARY KEY,
  nombre_original VARCHAR(255) NOT NULL,
  nombre_almacenado VARCHAR(255) UNIQUE NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  tamano_bytes INT NOT NULL CHECK (tamano_bytes > 0 AND tamano_bytes <= 8388608),
  sha256 CHAR(64) NOT NULL,
  creado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE attendance_registrations
  ADD COLUMN IF NOT EXISTS documento_id INT REFERENCES justification_documents(id_documento) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_asistencia_fecha_tipo
  ON attendance_registrations (fecha, tipo_registro);
CREATE INDEX IF NOT EXISTS idx_asistencia_alumno_fecha
  ON attendance_registrations (id_alumno, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_asistencia_documento
  ON attendance_registrations (documento_id);

