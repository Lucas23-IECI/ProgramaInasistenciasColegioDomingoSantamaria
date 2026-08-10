-- Analítica institucional explicable y soporte idempotente para operación sin conexión.
-- Migración completamente aditiva: no elimina ni reescribe registros existentes.

ALTER TABLE attendance_registrations
  ADD COLUMN IF NOT EXISTS offline_operation_id UUID,
  ADD COLUMN IF NOT EXISTS registrado_dispositivo VARCHAR(120),
  ADD COLUMN IF NOT EXISTS registrado_sin_conexion BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_offline_operation
  ON attendance_registrations (offline_operation_id)
  WHERE offline_operation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS reportes_institucionales_programados (
  id_reporte SERIAL PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL,
  frecuencia VARCHAR(12) NOT NULL CHECK (frecuencia IN ('SEMANAL', 'MENSUAL')),
  formato VARCHAR(8) NOT NULL DEFAULT 'PDF' CHECK (formato IN ('PDF', 'XLSX')),
  dia_semana SMALLINT CHECK (dia_semana BETWEEN 1 AND 7),
  dia_mes SMALLINT CHECK (dia_mes BETWEEN 1 AND 28),
  hora TIME NOT NULL DEFAULT '07:00',
  activo BOOLEAN NOT NULL DEFAULT true,
  ultima_ejecucion TIMESTAMPTZ,
  proxima_ejecucion TIMESTAMPTZ,
  creado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  actualizado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_reporte_programado_dia CHECK (
    (frecuencia = 'SEMANAL' AND dia_semana IS NOT NULL)
    OR (frecuencia = 'MENSUAL' AND dia_mes IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS reportes_institucionales_ejecuciones (
  id_ejecucion BIGSERIAL PRIMARY KEY,
  id_reporte INT REFERENCES reportes_institucionales_programados(id_reporte) ON DELETE SET NULL,
  nombre_reporte VARCHAR(120) NOT NULL,
  frecuencia VARCHAR(12) NOT NULL,
  formato VARCHAR(8) NOT NULL,
  periodo_desde DATE NOT NULL,
  periodo_hasta DATE NOT NULL,
  estado VARCHAR(12) NOT NULL DEFAULT 'GENERADO' CHECK (estado IN ('GENERADO', 'ERROR')),
  resumen JSONB,
  error TEXT,
  generado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  generado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reportes_institucionales_ejecuciones_fecha
  ON reportes_institucionales_ejecuciones (generado_en DESC);

INSERT INTO permisos_sistema (codigo, grupo, etiqueta, descripcion, orden, critico) VALUES
  ('analytics.institutional.view', 'Analítica institucional', 'Consultar analítica institucional', 'Consulta tendencias, comparaciones y explicaciones institucionales agregadas.', 560, true),
  ('analytics.institutional.export', 'Analítica institucional', 'Exportar analítica institucional', 'Genera reportes PDF o Excel respetando el período consultado.', 561, true),
  ('analytics.schedules.manage', 'Analítica institucional', 'Programar reportes institucionales', 'Configura y ejecuta reportes semanales o mensuales dentro del sistema.', 562, true)
ON CONFLICT (codigo) DO UPDATE SET
  grupo = EXCLUDED.grupo,
  etiqueta = EXCLUDED.etiqueta,
  descripcion = EXCLUDED.descripcion,
  orden = EXCLUDED.orden,
  critico = EXCLUDED.critico;

INSERT INTO permisos_rol (rol, permiso_codigo)
SELECT 'admin', codigo FROM permisos_sistema WHERE codigo LIKE 'analytics.%'
ON CONFLICT DO NOTHING;

INSERT INTO permisos_rol (rol, permiso_codigo) VALUES
  ('direccion', 'analytics.view'),
  ('direccion', 'analytics.institutional.view'),
  ('direccion', 'analytics.institutional.export'),
  ('direccion', 'analytics.schedules.manage'),
  ('inspector', 'analytics.institutional.view')
ON CONFLICT DO NOTHING;
