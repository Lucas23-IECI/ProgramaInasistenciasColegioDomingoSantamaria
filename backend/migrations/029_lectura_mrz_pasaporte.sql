-- Lectura local y restringida de la zona MRZ. El backend recibe solamente
-- metadatos de validación y nunca conserva la imagen ni las líneas del documento.

INSERT INTO permisos_sistema (
  codigo, grupo, etiqueta, descripcion, orden, critico
) VALUES (
  'students.identity.mrz',
  'Personas y cursos',
  'Leer MRZ de pasaporte',
  'Permite validar localmente la zona MRZ, exige revisión física y no guarda imágenes ni el texto leído.',
  96,
  true
)
ON CONFLICT (codigo) DO UPDATE SET
  grupo = EXCLUDED.grupo,
  etiqueta = EXCLUDED.etiqueta,
  descripcion = EXCLUDED.descripcion,
  orden = EXCLUDED.orden,
  critico = EXCLUDED.critico;

INSERT INTO permisos_rol (rol, permiso_codigo)
SELECT rol, 'students.identity.mrz'
FROM permisos_rol
WHERE permiso_codigo = 'students.identity.regularize'
ON CONFLICT (rol, permiso_codigo) DO NOTHING;

INSERT INTO permisos_usuario
  (usuario_id, permiso_codigo, concedido, actualizado_por, actualizado_en)
SELECT usuario_id, 'students.identity.mrz', concedido, actualizado_por, CURRENT_TIMESTAMP
FROM permisos_usuario
WHERE permiso_codigo = 'students.identity.regularize'
ON CONFLICT (usuario_id, permiso_codigo) DO NOTHING;
