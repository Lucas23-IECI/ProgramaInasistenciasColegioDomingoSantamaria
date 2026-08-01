-- Versiones antiguas del importador guardaron el RUT-100/IPE en las columnas
-- rut y dv. Se conserva el identificador, pero se reclasifica para no presentarlo
-- ni validarlo como RUN chileno.

UPDATE alumno
SET documento_erp = COALESCE(
      NULLIF(documento_erp, ''),
      CONCAT(rut, CASE WHEN dv IS NOT NULL THEN '-' || dv ELSE '' END)
    ),
    tipo_identificador = 'IPE_MINEDUC',
    tipo_documento_extranjero = NULL,
    pais_emisor_documento = NULL,
    rut = NULL,
    dv = NULL,
    codigo_barra = REGEXP_REPLACE(
      UPPER(COALESCE(
        NULLIF(documento_erp, ''),
        CONCAT(rut, CASE WHEN dv IS NOT NULL THEN '-' || dv ELSE '' END)
      )),
      '[^0-9A-Z]',
      '',
      'g'
    ),
    fecha_actualizacion = CURRENT_TIMESTAMP
WHERE rut ~ '^[0-9]{9,}$'
  AND REGEXP_REPLACE(
        UPPER(CONCAT(rut, CASE WHEN dv IS NOT NULL THEN dv ELSE '' END)),
        '[^0-9A-Z]',
        '',
        'g'
      ) ~ '^1[0-9]{8}[0-9K]$';
