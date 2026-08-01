-- Exportaciones diferenciadas del padrón. La salida operativa protege los
-- documentos; la administrativa contiene identificadores completos y queda
-- reservada a perfiles autorizados y auditada por el backend.

INSERT INTO permisos_sistema (
  codigo, grupo, etiqueta, descripcion, orden, critico
) VALUES
  (
    'students.export',
    'Personas y cursos',
    'Exportar padrón operativo',
    'Descarga el padrón y sus incidencias con identificadores personales protegidos.',
    96,
    false
  ),
  (
    'students.export_sensitive',
    'Personas y cursos',
    'Exportar identificadores completos',
    'Descarga una exportación administrativa restringida con documentos e historial de identificadores completos.',
    97,
    true
  )
ON CONFLICT (codigo) DO UPDATE SET
  grupo = EXCLUDED.grupo,
  etiqueta = EXCLUDED.etiqueta,
  descripcion = EXCLUDED.descripcion,
  orden = EXCLUDED.orden,
  critico = EXCLUDED.critico;

INSERT INTO permisos_rol (rol, permiso_codigo)
SELECT codigo, 'students.export'
FROM perfiles_acceso
WHERE codigo IN ('admin', 'inspector', 'secretaria', 'direccion')
ON CONFLICT (rol, permiso_codigo) DO NOTHING;

INSERT INTO permisos_rol (rol, permiso_codigo)
SELECT codigo, 'students.export_sensitive'
FROM perfiles_acceso
WHERE codigo = 'admin'
ON CONFLICT (rol, permiso_codigo) DO NOTHING;
