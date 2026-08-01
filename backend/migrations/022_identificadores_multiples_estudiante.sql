-- Mantiene varios identificadores por estudiante sin eliminar las columnas
-- heredadas de alumno. La transición es aditiva, reversible y compatible con
-- la planilla ERP vigente.

CREATE TABLE IF NOT EXISTS alumno_identificador (
  id_identificador BIGSERIAL PRIMARY KEY,
  id_alumno INT NOT NULL REFERENCES alumno(id_alumno) ON DELETE CASCADE,
  tipo VARCHAR(32) NOT NULL CONSTRAINT ck_alumno_identificador_tipo CHECK (
    tipo IN (
      'RUN_CHILE',
      'IPE_MINEDUC',
      'PASAPORTE',
      'DNI',
      'CEDULA',
      'DOCUMENTO_EXTRANJERO',
      'ID_ERP',
      'CODIGO_INTERNO',
      'CODIGO_BARRAS'
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

CREATE UNIQUE INDEX IF NOT EXISTS uq_alumno_identificador_activo
  ON alumno_identificador (
    tipo,
    valor_normalizado,
    COALESCE(pais_emisor, '')
  )
  WHERE estado <> 'REVOCADO';

CREATE UNIQUE INDEX IF NOT EXISTS uq_alumno_identificador_principal
  ON alumno_identificador (id_alumno)
  WHERE es_principal = true AND estado <> 'REVOCADO';

CREATE INDEX IF NOT EXISTS idx_alumno_identificador_alumno
  ON alumno_identificador (id_alumno, es_principal DESC, actualizado_en DESC);

CREATE INDEX IF NOT EXISTS idx_alumno_identificador_busqueda
  ON alumno_identificador (valor_normalizado)
  WHERE estado <> 'REVOCADO';

-- RUN vigente.
INSERT INTO alumno_identificador (
  id_alumno, tipo, valor_original, valor_normalizado, pais_emisor,
  fuente, estado, es_principal, nivel_validacion, vigente_desde
)
SELECT
  a.id_alumno,
  'RUN_CHILE',
  CONCAT(a.rut, '-', a.dv),
  UPPER(CONCAT(a.rut, a.dv)),
  'CHL',
  CASE WHEN a.origen_alta = 'ERP' THEN 'ERP'
       WHEN a.origen_alta = 'MANUAL' THEN 'MANUAL'
       ELSE 'LEGACY' END,
  'PRINCIPAL',
  true,
  'DV_VERIFICADO',
  COALESCE(a.creado_manualmente_en::date, a.fecha_actualizacion::date, CURRENT_DATE)
FROM alumno a
WHERE a.rut IS NOT NULL
  AND a.dv IS NOT NULL
  AND a.tipo_identificador = 'RUN_CHILE'
ON CONFLICT DO NOTHING;

-- IPE/RUT 100 conservado por Mineduc o por el ERP.
INSERT INTO alumno_identificador (
  id_alumno, tipo, valor_original, valor_normalizado, pais_emisor,
  fuente, estado, es_principal, nivel_validacion, vigente_desde
)
SELECT
  a.id_alumno,
  'IPE_MINEDUC',
  a.documento_erp,
  REGEXP_REPLACE(UPPER(a.documento_erp), '[^0-9A-Z]', '', 'g'),
  'CHL',
  CASE WHEN a.origen_alta = 'ERP' THEN 'ERP' ELSE 'MINEDUC' END,
  'PRINCIPAL',
  true,
  'FUENTE_MINEDUC_ERP',
  COALESCE(a.fecha_actualizacion::date, CURRENT_DATE)
FROM alumno a
WHERE a.tipo_identificador = 'IPE_MINEDUC'
  AND NULLIF(a.documento_erp, '') IS NOT NULL
ON CONFLICT DO NOTHING;

-- Documento extranjero principal. El país se conserva solo cuando fue
-- informado; nunca se inventa a partir del formato.
INSERT INTO alumno_identificador (
  id_alumno, tipo, valor_original, valor_normalizado, pais_emisor,
  fuente, estado, es_principal, nivel_validacion, vigente_desde
)
SELECT
  a.id_alumno,
  CASE a.tipo_documento_extranjero
    WHEN 'PASAPORTE' THEN 'PASAPORTE'
    WHEN 'DNI' THEN 'DNI'
    WHEN 'CEDULA' THEN 'CEDULA'
    ELSE 'DOCUMENTO_EXTRANJERO'
  END,
  a.documento_erp,
  REGEXP_REPLACE(UPPER(a.documento_erp), '[^0-9A-Z]', '', 'g'),
  a.pais_emisor_documento,
  CASE WHEN a.origen_alta = 'ERP' THEN 'ERP'
       WHEN a.origen_alta = 'MANUAL' THEN 'MANUAL'
       ELSE 'LEGACY' END,
  'PRINCIPAL',
  true,
  'FORMATO_Y_ORIGEN_ERP',
  COALESCE(a.creado_manualmente_en::date, a.fecha_actualizacion::date, CURRENT_DATE)
FROM alumno a
WHERE a.tipo_identificador = 'DOCUMENTO_EXTRANJERO'
  AND NULLIF(a.documento_erp, '') IS NOT NULL
ON CONFLICT DO NOTHING;

-- UUID del ERP: puede coexistir con el documento principal.
INSERT INTO alumno_identificador (
  id_alumno, tipo, valor_original, valor_normalizado,
  fuente, estado, es_principal, nivel_validacion, vigente_desde
)
SELECT
  a.id_alumno,
  'ID_ERP',
  a.uuid_erp,
  REGEXP_REPLACE(UPPER(a.uuid_erp), '[^0-9A-Z]', '', 'g'),
  'ERP',
  CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM alumno_identificador ai
      WHERE ai.id_alumno = a.id_alumno
        AND ai.es_principal = true
        AND ai.estado <> 'REVOCADO'
    ) THEN 'PRINCIPAL'
    ELSE 'VIGENTE'
  END,
  NOT EXISTS (
    SELECT 1
    FROM alumno_identificador ai
    WHERE ai.id_alumno = a.id_alumno
      AND ai.es_principal = true
      AND ai.estado <> 'REVOCADO'
  ),
  'ID_ERP',
  COALESCE(a.erp_vinculado_en::date, a.fecha_actualizacion::date, CURRENT_DATE)
FROM alumno a
WHERE NULLIF(a.uuid_erp, '') IS NOT NULL
ON CONFLICT DO NOTHING;

-- Código utilizado por pistola/cámara. No es un documento civil.
INSERT INTO alumno_identificador (
  id_alumno, tipo, valor_original, valor_normalizado,
  fuente, estado, es_principal, nivel_validacion, vigente_desde
)
SELECT
  a.id_alumno,
  'CODIGO_BARRAS',
  a.codigo_barra,
  REGEXP_REPLACE(UPPER(a.codigo_barra), '[^0-9A-Z]', '', 'g'),
  'SISTEMA',
  'VIGENTE',
  false,
  'CODIGO_OPERATIVO',
  COALESCE(a.fecha_actualizacion::date, CURRENT_DATE)
FROM alumno a
WHERE NULLIF(a.codigo_barra, '') IS NOT NULL
ON CONFLICT DO NOTHING;
