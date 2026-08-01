ALTER TABLE alumno
  ADD COLUMN IF NOT EXISTS origen_alta VARCHAR(20),
  ADD COLUMN IF NOT EXISTS erp_vinculado_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS creado_manualmente_por INT REFERENCES usuarios(id) ON DELETE SET NULL;

UPDATE alumno
SET origen_alta = 'LEGACY'
WHERE origen_alta IS NULL;

UPDATE alumno a
SET origen_alta = 'ERP',
    erp_vinculado_en = COALESCE(a.erp_vinculado_en, s.fecha_importacion)
FROM alumno_excel_snapshot s
WHERE s.id_alumno = a.id_alumno;

UPDATE alumno a
SET origen_alta = 'MANUAL'
WHERE EXISTS (
  SELECT 1
  FROM audit_log l
  WHERE l.accion = 'CREAR_ALUMNO'
    AND l.entidad = 'alumno'
    AND l.entidad_id = a.id_alumno
    AND COALESCE(l.detalle->>'origen', '') = 'MANUAL'
);

ALTER TABLE alumno
  ALTER COLUMN origen_alta SET DEFAULT 'LEGACY',
  ALTER COLUMN origen_alta SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_alumno_origen_alta'
  ) THEN
    ALTER TABLE alumno
      ADD CONSTRAINT ck_alumno_origen_alta
      CHECK (origen_alta IN ('MANUAL', 'ERP', 'LEGACY'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_alumno_origen_alta
  ON alumno (origen_alta, erp_vinculado_en);
