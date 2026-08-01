-- Los identificadores de menores se ocultan por defecto. Solo una consulta
-- individual explícita, autorizada y auditada puede revelar los valores.

INSERT INTO permisos_sistema (
  codigo, grupo, etiqueta, descripcion, orden, critico
) VALUES (
  'students.identifiers.view_sensitive',
  'Personas y cursos',
  'Ver identificadores completos',
  'Permite revelar temporalmente RUN, IPE, pasaporte e identificadores ERP en una ficha individual. Cada revelación queda auditada.',
  95,
  true
)
ON CONFLICT (codigo) DO UPDATE SET
  grupo = EXCLUDED.grupo,
  etiqueta = EXCLUDED.etiqueta,
  descripcion = EXCLUDED.descripcion,
  orden = EXCLUDED.orden,
  critico = EXCLUDED.critico;

INSERT INTO permisos_rol (rol, permiso_codigo)
SELECT codigo, 'students.identifiers.view_sensitive'
FROM perfiles_acceso
WHERE codigo = 'admin'
ON CONFLICT (rol, permiso_codigo) DO NOTHING;
