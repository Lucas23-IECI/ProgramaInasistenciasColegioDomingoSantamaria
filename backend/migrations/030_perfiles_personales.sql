-- Ficha personal del equipo institucional. Esta migracion es aditiva: no
-- reemplaza cuentas, cargos, perfiles de acceso, permisos ni credenciales.

CREATE TABLE IF NOT EXISTS archivos_perfil (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  categoria VARCHAR(16) NOT NULL CHECK (categoria IN ('avatar', 'portada')),
  nombre_principal VARCHAR(255) NOT NULL UNIQUE,
  nombre_miniatura VARCHAR(255) NOT NULL UNIQUE,
  mime_type VARCHAR(40) NOT NULL DEFAULT 'image/webp',
  bytes_principal INTEGER NOT NULL CHECK (bytes_principal > 0),
  bytes_miniatura INTEGER NOT NULL CHECK (bytes_miniatura > 0),
  ancho INTEGER NOT NULL CHECK (ancho > 0),
  alto INTEGER NOT NULL CHECK (alto > 0),
  sha256 VARCHAR(64) NOT NULL,
  creado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  eliminado_en TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_archivos_perfil_usuario
  ON archivos_perfil(usuario_id, categoria)
  WHERE eliminado_en IS NULL;

CREATE TABLE IF NOT EXISTS perfiles_personales (
  usuario_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE RESTRICT,
  nombre_mostrado VARCHAR(120),
  biografia VARCHAR(600),
  area VARCHAR(120),
  ubicacion VARCHAR(160),
  anexo VARCHAR(30),
  telefono_interno VARCHAR(40),
  horario_trabajo VARCHAR(180),
  estado_disponibilidad VARCHAR(24) NOT NULL DEFAULT 'SIN_ESTADO'
    CHECK (estado_disponibilidad IN (
      'SIN_ESTADO', 'DISPONIBLE', 'OCUPADO', 'EN_REUNION', 'EN_TERRENO',
      'FUERA', 'AUSENTE', 'NO_MOLESTAR'
    )),
  mensaje_estado VARCHAR(180),
  estado_hasta TIMESTAMPTZ,
  visible_directorio BOOLEAN NOT NULL DEFAULT true,
  mostrar_contacto BOOLEAN NOT NULL DEFAULT true,
  cuenta_compartida BOOLEAN NOT NULL DEFAULT false,
  avatar_archivo_id INTEGER REFERENCES archivos_perfil(id) ON DELETE SET NULL,
  portada_archivo_id INTEGER REFERENCES archivos_perfil(id) ON DELETE SET NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  CONSTRAINT perfiles_personales_estado_hasta_coherente CHECK (
    estado_hasta IS NULL OR estado_disponibilidad <> 'SIN_ESTADO'
  )
);

CREATE INDEX IF NOT EXISTS idx_perfiles_personales_directorio
  ON perfiles_personales(visible_directorio, estado_disponibilidad);

INSERT INTO perfiles_personales (usuario_id, nombre_mostrado, actualizado_por)
SELECT u.id, NULLIF(BTRIM(u.nombre), ''), u.id
FROM usuarios u
WHERE u.eliminado_en IS NULL
ON CONFLICT (usuario_id) DO NOTHING;

INSERT INTO permisos_sistema (codigo, grupo, etiqueta, descripcion, orden, critico) VALUES
  ('profiles.own.edit', 'Perfil personal', 'Editar perfil propio', 'Permite actualizar la ficha, disponibilidad y fotografías de la cuenta que inició sesión.', 141, false),
  ('profiles.directory.view', 'Perfil personal', 'Consultar directorio interno', 'Permite consultar los perfiles visibles del equipo institucional.', 142, false),
  ('profiles.contact.view', 'Perfil personal', 'Consultar contacto interno', 'Permite ver datos de contacto declarados como visibles dentro del directorio.', 143, false),
  ('profiles.manage', 'Perfil personal', 'Administrar perfiles personales', 'Permite corregir datos institucionales, visibilidad y estado de perfiles del personal.', 144, true)
ON CONFLICT (codigo) DO UPDATE SET
  grupo = EXCLUDED.grupo,
  etiqueta = EXCLUDED.etiqueta,
  descripcion = EXCLUDED.descripcion,
  orden = EXCLUDED.orden,
  critico = EXCLUDED.critico;

INSERT INTO permisos_rol (rol, permiso_codigo)
SELECT p.codigo, 'profiles.own.edit'
FROM perfiles_acceso p
WHERE p.activo = true
ON CONFLICT (rol, permiso_codigo) DO NOTHING;

INSERT INTO permisos_rol (rol, permiso_codigo)
SELECT p.codigo, permiso.codigo
FROM perfiles_acceso p
CROSS JOIN (VALUES ('profiles.directory.view'), ('profiles.contact.view')) AS permiso(codigo)
WHERE p.activo = true
  AND p.codigo <> 'lector'
ON CONFLICT (rol, permiso_codigo) DO NOTHING;

INSERT INTO permisos_rol (rol, permiso_codigo)
SELECT p.codigo, 'profiles.manage'
FROM perfiles_acceso p
WHERE p.codigo = 'admin'
ON CONFLICT (rol, permiso_codigo) DO NOTHING;
