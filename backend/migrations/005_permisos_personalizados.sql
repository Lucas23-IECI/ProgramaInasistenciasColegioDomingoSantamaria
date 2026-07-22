-- Permisos configurables por cuenta con plantillas institucionales recomendadas.
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS ck_usuarios_rol;
ALTER TABLE usuarios
  ADD CONSTRAINT ck_usuarios_rol
  CHECK (rol IN ('admin', 'inspector', 'secretaria', 'direccion', 'lector', 'personalizado'));

CREATE TABLE IF NOT EXISTS permisos_sistema (
  codigo VARCHAR(80) PRIMARY KEY,
  grupo VARCHAR(60) NOT NULL,
  etiqueta VARCHAR(100) NOT NULL,
  descripcion VARCHAR(280) NOT NULL,
  orden INT NOT NULL DEFAULT 0,
  critico BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS permisos_rol (
  rol VARCHAR(20) NOT NULL,
  permiso_codigo VARCHAR(80) NOT NULL REFERENCES permisos_sistema(codigo) ON DELETE CASCADE,
  PRIMARY KEY (rol, permiso_codigo),
  CONSTRAINT ck_permisos_rol_rol
    CHECK (rol IN ('admin', 'inspector', 'secretaria', 'direccion', 'lector', 'personalizado'))
);

CREATE TABLE IF NOT EXISTS permisos_usuario (
  usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  permiso_codigo VARCHAR(80) NOT NULL REFERENCES permisos_sistema(codigo) ON DELETE CASCADE,
  concedido BOOLEAN NOT NULL,
  actualizado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (usuario_id, permiso_codigo)
);

CREATE INDEX IF NOT EXISTS idx_permisos_usuario_codigo
  ON permisos_usuario (permiso_codigo, concedido);

INSERT INTO permisos_sistema (codigo, grupo, etiqueta, descripcion, orden, critico) VALUES
  ('punctuality.view', 'Control de atrasos', 'Ver control diario', 'Consulta la jornada, los ingresos procesados y sus respaldos.', 10, false),
  ('punctuality.register', 'Control de atrasos', 'Registrar ingresos', 'Abre el terminal y permite registrar con pistola o búsqueda manual.', 20, false),
  ('punctuality.correct', 'Control de atrasos', 'Corregir registros', 'Modifica fecha u hora de un ingreso dejando trazabilidad.', 30, true),
  ('punctuality.cancel', 'Control de atrasos', 'Anular registros', 'Anula ingresos erróneos conservando el historial institucional.', 40, true),
  ('punctuality.justify', 'Control de atrasos', 'Gestionar justificaciones', 'Justifica atrasos, adjunta documentos y revoca justificaciones.', 50, true),
  ('reports.generate', 'Información', 'Generar reportes', 'Genera reportes de puntualidad por período, curso o estudiante.', 60, false),
  ('analytics.view', 'Información', 'Consultar estadísticas', 'Consulta indicadores, tendencias y alertas preventivas.', 70, false),
  ('students.view', 'Personas y cursos', 'Consultar estudiantes', 'Consulta el padrón de estudiantes, cursos y antecedentes básicos.', 80, false),
  ('students.manage', 'Personas y cursos', 'Editar estudiantes', 'Crea, modifica y desactiva estudiantes y matrículas.', 90, true),
  ('students.import', 'Personas y cursos', 'Importar matrícula', 'Ejecuta sincronizaciones masivas desde planillas institucionales.', 100, true),
  ('users.manage', 'Administración', 'Administrar usuarios', 'Crea cuentas, asigna permisos y activa o desactiva accesos.', 110, true),
  ('settings.manage', 'Administración', 'Configurar jornada', 'Modifica horarios, severidades y umbrales preventivos.', 120, true),
  ('audit.view', 'Administración', 'Consultar auditoría', 'Consulta la trazabilidad de accesos y cambios realizados.', 130, true)
ON CONFLICT (codigo) DO UPDATE SET
  grupo = EXCLUDED.grupo,
  etiqueta = EXCLUDED.etiqueta,
  descripcion = EXCLUDED.descripcion,
  orden = EXCLUDED.orden,
  critico = EXCLUDED.critico;

DELETE FROM permisos_rol;

-- Administrador: control completo del sistema.
INSERT INTO permisos_rol (rol, permiso_codigo)
SELECT 'admin', codigo FROM permisos_sistema;

-- Inspectoría: operación diaria completa sin administración crítica.
INSERT INTO permisos_rol (rol, permiso_codigo) VALUES
  ('inspector', 'punctuality.view'),
  ('inspector', 'punctuality.register'),
  ('inspector', 'punctuality.correct'),
  ('inspector', 'punctuality.cancel'),
  ('inspector', 'punctuality.justify'),
  ('inspector', 'reports.generate'),
  ('inspector', 'analytics.view'),
  ('inspector', 'students.view');

-- Secretaría: consulta y regularización documental.
INSERT INTO permisos_rol (rol, permiso_codigo) VALUES
  ('secretaria', 'punctuality.view'),
  ('secretaria', 'punctuality.justify'),
  ('secretaria', 'reports.generate'),
  ('secretaria', 'analytics.view'),
  ('secretaria', 'students.view');

-- Dirección: supervisión, información y trazabilidad.
INSERT INTO permisos_rol (rol, permiso_codigo) VALUES
  ('direccion', 'punctuality.view'),
  ('direccion', 'reports.generate'),
  ('direccion', 'analytics.view'),
  ('direccion', 'students.view'),
  ('direccion', 'audit.view');

-- Lector: terminal operacional fijo o personal.
INSERT INTO permisos_rol (rol, permiso_codigo) VALUES
  ('lector', 'punctuality.register');

