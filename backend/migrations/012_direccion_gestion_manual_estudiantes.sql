INSERT INTO permisos_rol (rol, permiso_codigo)
VALUES ('direccion', 'students.manage')
ON CONFLICT (rol, permiso_codigo) DO NOTHING;
