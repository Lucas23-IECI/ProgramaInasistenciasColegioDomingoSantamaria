-- Corrige los UUID ERP migrados antes de estandarizar la normalización.
-- La operación es idempotente y mantiene el valor original para auditoría.

UPDATE alumno_identificador
SET valor_normalizado = REGEXP_REPLACE(
      UPPER(valor_normalizado),
      '[^0-9A-Z]',
      '',
      'g'
    ),
    actualizado_en = CURRENT_TIMESTAMP
WHERE tipo = 'ID_ERP'
  AND valor_normalizado <> REGEXP_REPLACE(
    UPPER(valor_normalizado),
    '[^0-9A-Z]',
    '',
    'g'
  );
