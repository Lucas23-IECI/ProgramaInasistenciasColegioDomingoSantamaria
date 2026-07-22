-- Conserva la trazabilidad institucional al retirar una cuenta del sistema.
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS eliminado_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS eliminado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS motivo_eliminacion TEXT;

ALTER TABLE usuarios
  DROP CONSTRAINT IF EXISTS usuarios_correo_key;

DROP INDEX IF EXISTS uq_usuarios_correo_normalizado;

CREATE UNIQUE INDEX IF NOT EXISTS uq_usuarios_correo_activo
  ON usuarios (LOWER(correo))
  WHERE eliminado_en IS NULL;

CREATE INDEX IF NOT EXISTS idx_usuarios_no_eliminados_perfil
  ON usuarios (rol, activo)
  WHERE eliminado_en IS NULL;

CREATE INDEX IF NOT EXISTS idx_audit_log_usuario_entidad
  ON audit_log (entidad, entidad_id, fecha DESC);
