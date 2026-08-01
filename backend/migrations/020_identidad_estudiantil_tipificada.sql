-- Tipifica la identidad del padrón sin confundir RUN, IPE y documentos extranjeros.
-- La fuente ERP sigue siendo necesaria para acreditar identificadores que no tienen
-- un algoritmo chileno de dígito verificador.

ALTER TABLE alumno
  ADD COLUMN IF NOT EXISTS tipo_identificador VARCHAR(32),
  ADD COLUMN IF NOT EXISTS tipo_documento_extranjero VARCHAR(32),
  ADD COLUMN IF NOT EXISTS pais_emisor_documento VARCHAR(3);

UPDATE alumno
SET tipo_identificador = CASE
  WHEN (
    documento_erp IS NOT NULL
    AND REGEXP_REPLACE(UPPER(documento_erp), '[^0-9A-Z]', '', 'g') ~ '^1[0-9]{8}[0-9K]$'
  ) OR (
    rut ~ '^[0-9]{9,}$'
    AND REGEXP_REPLACE(
      UPPER(CONCAT(rut, CASE WHEN dv IS NOT NULL THEN dv ELSE '' END)),
      '[^0-9A-Z]',
      '',
      'g'
    ) ~ '^1[0-9]{8}[0-9K]$'
  ) THEN 'IPE_MINEDUC'
  WHEN rut IS NOT NULL THEN 'RUN_CHILE'
  WHEN documento_erp IS NOT NULL THEN 'DOCUMENTO_EXTRANJERO'
  WHEN uuid_erp IS NOT NULL THEN 'ID_ERP'
  ELSE 'SIN_IDENTIFICADOR_LEGACY'
END
WHERE tipo_identificador IS NULL;

CREATE INDEX IF NOT EXISTS idx_alumno_tipo_identificador
  ON alumno (tipo_identificador);

CREATE INDEX IF NOT EXISTS idx_alumno_documento_normalizado
  ON alumno ((REGEXP_REPLACE(UPPER(documento_erp), '[^0-9A-Z]', '', 'g')))
  WHERE documento_erp IS NOT NULL;
