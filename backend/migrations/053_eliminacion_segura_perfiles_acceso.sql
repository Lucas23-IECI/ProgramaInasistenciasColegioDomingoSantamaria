-- Retira perfiles configurables sin romper la referencia histórica de cuentas
-- eliminadas. Las cuentas se conservan por auditoría, por lo que el perfil
-- también debe permanecer como una referencia inactiva y no borrarse físicamente.
ALTER TABLE perfiles_acceso
  ADD COLUMN IF NOT EXISTS eliminado_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS eliminado_por INT;

DROP INDEX IF EXISTS uq_perfiles_acceso_nombre_normalizado;
CREATE UNIQUE INDEX IF NOT EXISTS uq_perfiles_acceso_nombre_normalizado
  ON perfiles_acceso (LOWER(trim(nombre)))
  WHERE eliminado_en IS NULL;

CREATE INDEX IF NOT EXISTS idx_perfiles_acceso_disponibles
  ON perfiles_acceso (activo, orden, codigo)
  WHERE eliminado_en IS NULL;
