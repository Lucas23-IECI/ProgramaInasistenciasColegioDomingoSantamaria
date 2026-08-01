-- Regularización controlada de IPE a RUN sobre la misma ficha institucional.
-- Conserva el IPE como identificador anterior, exige respaldo documental y
-- registra quién realizó la operación.

CREATE TABLE IF NOT EXISTS regularizaciones_identidad_estudiante (
  id_regularizacion BIGSERIAL PRIMARY KEY,
  id_alumno INT NOT NULL REFERENCES alumno(id_alumno) ON DELETE RESTRICT,
  tipo_operacion VARCHAR(32) NOT NULL DEFAULT 'IPE_A_RUN' CONSTRAINT ck_regularizacion_identidad_tipo CHECK (
    tipo_operacion IN ('IPE_A_RUN')
  ),
  identificador_anterior_id BIGINT NOT NULL REFERENCES alumno_identificador(id_identificador) ON DELETE RESTRICT,
  identificador_nuevo_id BIGINT NOT NULL REFERENCES alumno_identificador(id_identificador) ON DELETE RESTRICT,
  motivo VARCHAR(500) NOT NULL,
  tipo_respaldo VARCHAR(50) NOT NULL CONSTRAINT ck_regularizacion_identidad_respaldo CHECK (
    tipo_respaldo IN (
      'CEDULA_IDENTIDAD',
      'CERTIFICADO_NACIMIENTO',
      'COMPROBANTE_REGULARIZACION',
      'DOCUMENTO_MINEDUC',
      'OTRO'
    )
  ),
  detalle_respaldo VARCHAR(500),
  documento_id INT NOT NULL REFERENCES justification_documents(id_documento) ON DELETE RESTRICT,
  realizado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  realizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_regularizacion_identidad_identificadores_distintos CHECK (
    identificador_anterior_id <> identificador_nuevo_id
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_regularizacion_identidad_nuevo
  ON regularizaciones_identidad_estudiante (identificador_nuevo_id);

CREATE INDEX IF NOT EXISTS idx_regularizacion_identidad_alumno
  ON regularizaciones_identidad_estudiante (id_alumno, realizado_en DESC);

INSERT INTO permisos_sistema (
  codigo, grupo, etiqueta, descripcion, orden, critico
) VALUES (
  'students.identity.regularize',
  'Personas y cursos',
  'Regularizar IPE a RUN',
  'Vincula un RUN a una ficha con IPE, exige respaldo y conserva el historial de identidad.',
  95,
  true
)
ON CONFLICT (codigo) DO UPDATE SET
  grupo = EXCLUDED.grupo,
  etiqueta = EXCLUDED.etiqueta,
  descripcion = EXCLUDED.descripcion,
  orden = EXCLUDED.orden,
  critico = EXCLUDED.critico;

INSERT INTO permisos_rol (rol, permiso_codigo)
SELECT codigo, 'students.identity.regularize'
FROM perfiles_acceso
WHERE codigo IN ('admin', 'secretaria')
ON CONFLICT (rol, permiso_codigo) DO NOTHING;
