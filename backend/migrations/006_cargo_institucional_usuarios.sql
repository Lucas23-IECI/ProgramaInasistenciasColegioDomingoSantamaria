-- Separa la función institucional de la plantilla técnica de permisos.
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS cargo VARCHAR(100);

ALTER TABLE usuarios
  DROP CONSTRAINT IF EXISTS ck_usuarios_cargo;

ALTER TABLE usuarios
  ADD CONSTRAINT ck_usuarios_cargo
  CHECK (cargo IS NULL OR char_length(trim(cargo)) BETWEEN 2 AND 100);

CREATE INDEX IF NOT EXISTS idx_usuarios_cargo_normalizado
  ON usuarios (LOWER(cargo))
  WHERE cargo IS NOT NULL;
