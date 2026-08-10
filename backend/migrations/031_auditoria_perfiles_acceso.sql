-- Conserva el perfil que tenia quien ejecuto cada accion. No existe una FK
-- intencionalmente: el dato debe sobrevivir a reasignaciones y eliminaciones.

ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS perfil_codigo_snapshot VARCHAR(50),
  ADD COLUMN IF NOT EXISTS perfil_nombre_snapshot VARCHAR(100);

UPDATE audit_log a
SET perfil_codigo_snapshot = u.rol,
    perfil_nombre_snapshot = COALESCE(p.nombre, u.rol)
FROM usuarios u
LEFT JOIN perfiles_acceso p ON p.codigo = u.rol
WHERE a.usuario_id = u.id
  AND a.perfil_codigo_snapshot IS NULL;

CREATE INDEX IF NOT EXISTS idx_audit_log_perfil_fecha
  ON audit_log (perfil_codigo_snapshot, fecha DESC);
