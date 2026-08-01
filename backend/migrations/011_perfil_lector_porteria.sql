-- El perfil Lector representa el puesto fijo de Portería.
-- Sus dos módulos son Registro de estudiantes y Visitas/retiros.
DELETE FROM permisos_usuario
WHERE usuario_id IN (
  SELECT id FROM usuarios WHERE rol = 'lector'
);

DELETE FROM permisos_rol
WHERE rol = 'lector';

INSERT INTO permisos_rol (rol, permiso_codigo) VALUES
  ('lector', 'punctuality.register'),
  ('lector', 'visits.view'),
  ('lector', 'visits.register'),
  ('lector', 'visits.checkout'),
  ('lector', 'withdrawals.register')
ON CONFLICT DO NOTHING;

UPDATE perfiles_acceso
SET nombre = 'Portería / lector',
    descripcion = 'Puesto operativo fijo: registro de estudiantes y control de visitas y retiros.',
    actualizado_en = CURRENT_TIMESTAMP
WHERE codigo = 'lector';

UPDATE usuarios
SET cargo = COALESCE(NULLIF(BTRIM(cargo), ''), 'Portería'),
    token_version = token_version + 1
WHERE rol = 'lector';
