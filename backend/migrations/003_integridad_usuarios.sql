-- Endurece las cuentas sin eliminar usuarios ni invalidar sesiones existentes.
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS debe_cambiar_password BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ultimo_acceso TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS password_actualizado_en TIMESTAMPTZ;

UPDATE usuarios
SET correo = LOWER(TRIM(correo)),
    intentos_fallidos = GREATEST(COALESCE(intentos_fallidos, 0), 0),
    token_version = GREATEST(COALESCE(token_version, 1), 1);

ALTER TABLE usuarios
  ALTER COLUMN intentos_fallidos SET DEFAULT 0,
  ALTER COLUMN intentos_fallidos SET NOT NULL,
  ALTER COLUMN token_version SET DEFAULT 1,
  ALTER COLUMN token_version SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_usuarios_correo_normalizado
  ON usuarios (LOWER(correo));

CREATE INDEX IF NOT EXISTS idx_usuarios_activo_rol
  ON usuarios (activo, rol);

