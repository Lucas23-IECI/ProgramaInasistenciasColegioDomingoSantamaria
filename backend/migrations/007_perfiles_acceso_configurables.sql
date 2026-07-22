-- Separa los perfiles de acceso de las cuentas personales del personal.
-- También retira la vinculación experimental e incorrecta con el padrón académico.
ALTER TABLE usuarios DROP COLUMN IF EXISTS persona_id CASCADE;
ALTER TABLE alumno DROP COLUMN IF EXISTS cargo_institucional CASCADE;
DELETE FROM schema_migrations WHERE nombre = '007_vinculo_persona_cuenta.sql';

CREATE TABLE IF NOT EXISTS perfiles_acceso (
  codigo VARCHAR(50) PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  descripcion VARCHAR(280) NOT NULL DEFAULT '',
  sistema BOOLEAN NOT NULL DEFAULT false,
  activo BOOLEAN NOT NULL DEFAULT true,
  orden INT NOT NULL DEFAULT 0,
  fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_perfiles_acceso_codigo CHECK (codigo ~ '^[a-z0-9][a-z0-9_-]{1,49}$'),
  CONSTRAINT ck_perfiles_acceso_nombre CHECK (char_length(trim(nombre)) BETWEEN 2 AND 100)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_perfiles_acceso_nombre_normalizado
  ON perfiles_acceso (LOWER(trim(nombre)));

INSERT INTO perfiles_acceso (codigo, nombre, descripcion, sistema, orden) VALUES
  ('admin', 'Administrador', 'Acceso completo y administración crítica.', true, 10),
  ('inspector', 'Inspectoría', 'Operación diaria, correcciones, justificaciones e información.', true, 20),
  ('secretaria', 'Secretaría', 'Consulta, reportes y gestión documental.', true, 30),
  ('direccion', 'Dirección', 'Supervisión, estadísticas, reportes y auditoría.', true, 40),
  ('lector', 'Portería / lector', 'Terminal de registro con pistola y búsqueda manual.', true, 50),
  ('personalizado', 'Personalizado', 'Perfil sin accesos iniciales para configuraciones excepcionales.', true, 90)
ON CONFLICT (codigo) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  descripcion = EXCLUDED.descripcion,
  sistema = EXCLUDED.sistema,
  orden = EXCLUDED.orden;

ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS ck_usuarios_rol;
ALTER TABLE usuarios ALTER COLUMN rol TYPE VARCHAR(50);
ALTER TABLE permisos_rol DROP CONSTRAINT IF EXISTS ck_permisos_rol_rol;
ALTER TABLE permisos_rol ALTER COLUMN rol TYPE VARCHAR(50);

ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS fk_usuarios_perfil_acceso;
ALTER TABLE usuarios
  ADD CONSTRAINT fk_usuarios_perfil_acceso
  FOREIGN KEY (rol) REFERENCES perfiles_acceso(codigo) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE permisos_rol DROP CONSTRAINT IF EXISTS fk_permisos_rol_perfil;
ALTER TABLE permisos_rol
  ADD CONSTRAINT fk_permisos_rol_perfil
  FOREIGN KEY (rol) REFERENCES perfiles_acceso(codigo) ON UPDATE CASCADE ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_usuarios_perfil_activo ON usuarios (rol, activo);
