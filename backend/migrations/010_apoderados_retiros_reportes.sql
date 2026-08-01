-- Ficha estructurada de apoderados, catálogo de retiros y respaldo de importaciones.
ALTER TABLE visitantes
  ADD COLUMN IF NOT EXISTS email VARCHAR(160);

CREATE TABLE IF NOT EXISTS tipos_parentesco (
  codigo VARCHAR(40) PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  requiere_detalle BOOLEAN NOT NULL DEFAULT false,
  activo BOOLEAN NOT NULL DEFAULT true,
  orden INT NOT NULL DEFAULT 0
);

INSERT INTO tipos_parentesco (codigo, nombre, requiere_detalle, orden) VALUES
  ('MADRE', 'Madre', false, 10),
  ('PADRE', 'Padre', false, 20),
  ('APODERADO_PRINCIPAL', 'Apoderado/a principal', false, 30),
  ('APODERADO_SUPLENTE', 'Apoderado/a suplente', false, 40),
  ('HERMANO', 'Hermano/a', false, 50),
  ('ABUELO', 'Abuelo/a', false, 60),
  ('TIO', 'Tío/a', false, 70),
  ('FAMILIAR_AUTORIZADO', 'Familiar autorizado', false, 80),
  ('TRANSPORTE_ESCOLAR', 'Transporte escolar', false, 90),
  ('OTRO', 'Otra relación', true, 100)
ON CONFLICT (codigo) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  requiere_detalle = EXCLUDED.requiere_detalle,
  orden = EXCLUDED.orden;

CREATE TABLE IF NOT EXISTS retiro_motivos (
  codigo VARCHAR(40) PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL,
  requiere_detalle BOOLEAN NOT NULL DEFAULT false,
  activo BOOLEAN NOT NULL DEFAULT true,
  orden INT NOT NULL DEFAULT 0
);

INSERT INTO retiro_motivos (codigo, nombre, requiere_detalle, orden) VALUES
  ('SALUD', 'Malestar o problema de salud', false, 10),
  ('CITA_MEDICA', 'Hora médica o dental', false, 20),
  ('EMERGENCIA_FAMILIAR', 'Emergencia familiar', true, 30),
  ('TRAMITE_FAMILIAR', 'Trámite familiar', false, 40),
  ('ACTIVIDAD_ACADEMICA', 'Actividad académica autorizada', false, 50),
  ('ACTIVIDAD_DEPORTIVA', 'Actividad deportiva o cultural', false, 60),
  ('TRANSPORTE', 'Cambio o problema de transporte', false, 70),
  ('AUTORIZACION_DIRECCION', 'Autorización de Dirección', true, 80),
  ('OTRO', 'Otro motivo', true, 100)
ON CONFLICT (codigo) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  requiere_detalle = EXCLUDED.requiere_detalle,
  orden = EXCLUDED.orden;

CREATE TABLE IF NOT EXISTS importaciones_apoderados (
  id BIGSERIAL PRIMARY KEY,
  nombre_archivo VARCHAR(255) NOT NULL,
  hash_archivo VARCHAR(128),
  total_filas INT NOT NULL DEFAULT 0,
  filas_creadas INT NOT NULL DEFAULT 0,
  filas_actualizadas INT NOT NULL DEFAULT 0,
  filas_con_error INT NOT NULL DEFAULT 0,
  importado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  importado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE personas_autorizadas_retiro
  ADD COLUMN IF NOT EXISTS parentesco_codigo VARCHAR(40),
  ADD COLUMN IF NOT EXISTS parentesco_detalle VARCHAR(120),
  ADD COLUMN IF NOT EXISTS es_principal BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fuente_registro VARCHAR(30) NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS importacion_id BIGINT REFERENCES importaciones_apoderados(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS actualizado_por INT REFERENCES usuarios(id) ON DELETE SET NULL;

UPDATE personas_autorizadas_retiro
SET parentesco_codigo = CASE
  WHEN LOWER(parentesco) LIKE '%madre%' THEN 'MADRE'
  WHEN LOWER(parentesco) LIKE '%padre%' THEN 'PADRE'
  WHEN LOWER(parentesco) LIKE '%principal%' THEN 'APODERADO_PRINCIPAL'
  WHEN LOWER(parentesco) LIKE '%suplente%' THEN 'APODERADO_SUPLENTE'
  WHEN LOWER(parentesco) LIKE '%herman%' THEN 'HERMANO'
  WHEN LOWER(parentesco) LIKE '%abuel%' THEN 'ABUELO'
  WHEN LOWER(parentesco) LIKE '%tí%' OR LOWER(parentesco) LIKE '%ti%' THEN 'TIO'
  ELSE 'OTRO'
END
WHERE parentesco_codigo IS NULL;

ALTER TABLE personas_autorizadas_retiro
  ALTER COLUMN parentesco_codigo SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_autorizacion_parentesco'
  ) THEN
    ALTER TABLE personas_autorizadas_retiro
      ADD CONSTRAINT fk_autorizacion_parentesco
      FOREIGN KEY (parentesco_codigo) REFERENCES tipos_parentesco(codigo)
      ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
END $$;

ALTER TABLE retiros_alumno
  ADD COLUMN IF NOT EXISTS motivo_codigo VARCHAR(40),
  ADD COLUMN IF NOT EXISTS motivo_detalle VARCHAR(500),
  ADD COLUMN IF NOT EXISTS parentesco_declarado_codigo VARCHAR(40),
  ADD COLUMN IF NOT EXISTS parentesco_declarado_detalle VARCHAR(120);

UPDATE retiros_alumno
SET motivo_codigo = 'OTRO',
    motivo_detalle = COALESCE(motivo_detalle, motivo)
WHERE motivo_codigo IS NULL;

UPDATE retiros_alumno
SET parentesco_declarado_codigo = COALESCE(
  (SELECT pa.parentesco_codigo
   FROM personas_autorizadas_retiro pa
   WHERE pa.id = retiros_alumno.autorizacion_id),
  'OTRO'
)
WHERE parentesco_declarado_codigo IS NULL;

ALTER TABLE retiros_alumno
  ALTER COLUMN motivo_codigo SET NOT NULL,
  ALTER COLUMN parentesco_declarado_codigo SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_retiro_motivo'
  ) THEN
    ALTER TABLE retiros_alumno
      ADD CONSTRAINT fk_retiro_motivo
      FOREIGN KEY (motivo_codigo) REFERENCES retiro_motivos(codigo)
      ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_retiro_parentesco_declarado'
  ) THEN
    ALTER TABLE retiros_alumno
      ADD CONSTRAINT fk_retiro_parentesco_declarado
      FOREIGN KEY (parentesco_declarado_codigo) REFERENCES tipos_parentesco(codigo)
      ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_autorizaciones_importacion
  ON personas_autorizadas_retiro (importacion_id);

CREATE INDEX IF NOT EXISTS idx_retiros_motivo_fecha
  ON retiros_alumno (motivo_codigo, solicitado_en DESC);

INSERT INTO permisos_sistema (codigo, grupo, etiqueta, descripcion, orden, critico) VALUES
  (
    'withdrawals.import_guardians',
    'Visitas y retiros',
    'Importar ficha de apoderados',
    'Previsualiza y sincroniza vínculos de apoderados y personas autorizadas sin crear cuentas de acceso.',
    215,
    true
  )
ON CONFLICT (codigo) DO UPDATE SET
  grupo = EXCLUDED.grupo,
  etiqueta = EXCLUDED.etiqueta,
  descripcion = EXCLUDED.descripcion,
  orden = EXCLUDED.orden,
  critico = EXCLUDED.critico;

INSERT INTO permisos_rol (rol, permiso_codigo) VALUES
  ('admin', 'withdrawals.import_guardians'),
  ('inspector', 'withdrawals.import_guardians'),
  ('secretaria', 'withdrawals.import_guardians')
ON CONFLICT DO NOTHING;

-- Corrige cargos históricos creados antes de que el campo fuera obligatorio.
UPDATE usuarios
SET cargo = 'Portería'
WHERE rol = 'lector' AND (cargo IS NULL OR BTRIM(cargo) = '');

UPDATE usuarios
SET cargo = 'Administrador/a del sistema'
WHERE rol = 'admin' AND (cargo IS NULL OR BTRIM(cargo) = '');
