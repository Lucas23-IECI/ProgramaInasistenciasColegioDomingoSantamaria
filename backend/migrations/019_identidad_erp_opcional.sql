-- El ERP define su UUID como identificador obligatorio y permite RUT vacío.
-- Los documentos no chilenos se conservan sin presentarlos como RUT válido.

ALTER TABLE alumno
  ADD COLUMN IF NOT EXISTS documento_erp VARCHAR(64);

UPDATE alumno
SET documento_erp = CONCAT(rut, CASE WHEN dv IS NOT NULL THEN '-' || dv ELSE '' END)
WHERE documento_erp IS NULL
  AND rut IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alumno_documento_erp
  ON alumno (LOWER(documento_erp))
  WHERE documento_erp IS NOT NULL;

ALTER TABLE importacion_estudiante_cambios
  ALTER COLUMN rut_referencia TYPE VARCHAR(64);
