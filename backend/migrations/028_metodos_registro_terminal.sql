-- Separa los métodos operativos del terminal sin retirar el permiso base.
-- Los perfiles y excepciones existentes heredan el mismo criterio que ya tenían
-- para punctuality.register, evitando pérdidas de acceso durante la actualización.

INSERT INTO permisos_sistema (codigo, grupo, etiqueta, descripcion, orden, critico) VALUES
  ('punctuality.register.barcode', 'Control de atrasos', 'Registrar con pistola', 'Permite leer el código de barras del carnet con una pistola conectada al equipo.', 21, false),
  ('punctuality.register.camera', 'Control de atrasos', 'Registrar con cámara', 'Permite utilizar la cámara de un dispositivo para leer el código del carnet sin guardar imágenes.', 22, false),
  ('punctuality.register.manual', 'Control de atrasos', 'Buscar para registrar', 'Permite encontrar a un estudiante por nombre o identificador y registrar su ingreso.', 23, false)
ON CONFLICT (codigo) DO UPDATE SET
  grupo = EXCLUDED.grupo,
  etiqueta = EXCLUDED.etiqueta,
  descripcion = EXCLUDED.descripcion,
  orden = EXCLUDED.orden,
  critico = EXCLUDED.critico;

INSERT INTO permisos_rol (rol, permiso_codigo)
SELECT DISTINCT base.rol, methods.codigo
FROM permisos_rol base
CROSS JOIN (VALUES
  ('punctuality.register.barcode'),
  ('punctuality.register.camera'),
  ('punctuality.register.manual')
) AS methods(codigo)
WHERE base.permiso_codigo = 'punctuality.register'
ON CONFLICT DO NOTHING;

INSERT INTO permisos_usuario
  (usuario_id, permiso_codigo, concedido, actualizado_por, actualizado_en)
SELECT base.usuario_id, methods.codigo, base.concedido, base.actualizado_por, CURRENT_TIMESTAMP
FROM permisos_usuario base
CROSS JOIN (VALUES
  ('punctuality.register.barcode'),
  ('punctuality.register.camera'),
  ('punctuality.register.manual')
) AS methods(codigo)
WHERE base.permiso_codigo = 'punctuality.register'
ON CONFLICT (usuario_id, permiso_codigo) DO NOTHING;

UPDATE perfiles_acceso
SET descripcion = 'Puesto operativo fijo: registro de estudiantes con pistola, cámara o búsqueda manual, y control de visitas y retiros.',
    actualizado_en = CURRENT_TIMESTAMP
WHERE codigo = 'lector';
