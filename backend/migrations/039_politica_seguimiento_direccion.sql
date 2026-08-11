-- Política de seguimiento confirmada por Dirección el 10-08-2026.
-- Migración aditiva: conserva atrasos, casos, asignaciones, mensajes y auditoría.

ALTER TABLE seguimiento_reglas
  DROP CONSTRAINT IF EXISTS ck_seguimiento_regla_escalamiento;
ALTER TABLE seguimiento_reglas
  ADD CONSTRAINT ck_seguimiento_regla_escalamiento
  CHECK (escalamiento_dias IS NULL OR escalamiento_dias >= 0);

CREATE TABLE IF NOT EXISTS seguimiento_grupos_notificacion (
  codigo VARCHAR(64) PRIMARY KEY,
  nombre VARCHAR(160) NOT NULL,
  descripcion VARCHAR(500),
  activo BOOLEAN NOT NULL DEFAULT true,
  orden SMALLINT NOT NULL DEFAULT 100,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS seguimiento_grupo_perfiles (
  grupo_codigo VARCHAR(64) NOT NULL
    REFERENCES seguimiento_grupos_notificacion(codigo) ON DELETE CASCADE,
  perfil_codigo VARCHAR(64) NOT NULL
    REFERENCES perfiles_acceso(codigo) ON DELETE RESTRICT,
  PRIMARY KEY (grupo_codigo, perfil_codigo)
);

CREATE TABLE IF NOT EXISTS seguimiento_regla_escalamiento_grupos (
  regla_codigo VARCHAR(64) NOT NULL
    REFERENCES seguimiento_reglas(codigo) ON DELETE CASCADE,
  grupo_codigo VARCHAR(64) NOT NULL
    REFERENCES seguimiento_grupos_notificacion(codigo) ON DELETE RESTRICT,
  PRIMARY KEY (regla_codigo, grupo_codigo)
);

INSERT INTO seguimiento_grupos_notificacion (codigo, nombre, descripcion, orden) VALUES
  ('INSPECTORIA', 'Inspectoría', 'Equipo operativo responsable del seguimiento inicial y su supervisión.', 10),
  ('EQUIPO_GESTION', 'Equipo de Gestión', 'Equipo directivo que recibe seguimientos vencidos para su supervisión.', 20),
  ('CONVIVENCIA', 'Equipo de Convivencia', 'Equipo reservado para casos derivados formalmente a Convivencia Escolar.', 30)
ON CONFLICT (codigo) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  descripcion = EXCLUDED.descripcion,
  orden = EXCLUDED.orden,
  actualizado_en = CURRENT_TIMESTAMP;

INSERT INTO seguimiento_grupo_perfiles (grupo_codigo, perfil_codigo) VALUES
  ('INSPECTORIA', 'inspector'),
  ('EQUIPO_GESTION', 'direccion'),
  ('CONVIVENCIA', 'convivencia')
ON CONFLICT DO NOTHING;

INSERT INTO seguimiento_regla_escalamiento_grupos (regla_codigo, grupo_codigo) VALUES
  ('ATRASOS_PREVENTIVOS', 'INSPECTORIA'),
  ('ATRASOS_PREVENTIVOS', 'EQUIPO_GESTION'),
  ('ATRASOS_CRITICOS', 'INSPECTORIA'),
  ('ATRASOS_CRITICOS', 'EQUIPO_GESTION')
ON CONFLICT DO NOTHING;

UPDATE seguimiento_reglas
SET nombre = 'Tres atrasos en quince días',
    descripcion = 'Abre seguimiento preventivo al alcanzar tres atrasos registrados dentro de una ventana móvil de quince días.',
    umbral = 3,
    ventana_dias = 15,
    plazo_dias = 3,
    responsable_perfil_codigo = 'inspector',
    escalamiento_dias = 0,
    notificar_responsable = true,
    actualizada_en = CURRENT_TIMESTAMP
WHERE codigo = 'ATRASOS_PREVENTIVOS';

-- La política institucional conserva las conversaciones durante el año escolar.
-- La aplicación automática permanece apagada hasta una aprobación operacional explícita.
UPDATE chat_configuracion
SET retencion_predeterminada_dias = 365,
    retencion_activa = false,
    actualizada_en = CURRENT_TIMESTAMP
WHERE id_configuracion = 1;

ALTER TABLE chat_conversaciones
  ADD COLUMN IF NOT EXISTS codigo_institucional VARCHAR(64),
  ADD COLUMN IF NOT EXISTS grupo_notificacion_codigo VARCHAR(64)
    REFERENCES seguimiento_grupos_notificacion(codigo) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_canal_codigo_institucional
  ON chat_conversaciones (codigo_institucional)
  WHERE codigo_institucional IS NOT NULL AND activa = true;

