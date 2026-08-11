-- Operación institucional configurable para Seguimiento y Chat.
-- Migración aditiva: no elimina ni transforma casos, mensajes o archivos existentes.

ALTER TABLE seguimiento_reglas
  ADD COLUMN IF NOT EXISTS responsable_perfil_codigo VARCHAR(64),
  ADD COLUMN IF NOT EXISTS escalamiento_dias INT,
  ADD COLUMN IF NOT EXISTS notificar_responsable BOOLEAN NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_seguimiento_regla_perfil_responsable'
  ) THEN
    ALTER TABLE seguimiento_reglas
      ADD CONSTRAINT fk_seguimiento_regla_perfil_responsable
      FOREIGN KEY (responsable_perfil_codigo) REFERENCES perfiles_acceso(codigo) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE seguimiento_reglas
  DROP CONSTRAINT IF EXISTS ck_seguimiento_regla_escalamiento;
ALTER TABLE seguimiento_reglas
  ADD CONSTRAINT ck_seguimiento_regla_escalamiento
  CHECK (escalamiento_dias IS NULL OR escalamiento_dias > 0);

ALTER TABLE seguimiento_casos
  ADD COLUMN IF NOT EXISTS asignado_automaticamente BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notificado_asignacion_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notificado_vencimiento_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS escalado_automatico_en TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS seguimiento_configuracion (
  id_configuracion SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id_configuracion = 1),
  automatizacion_activa BOOLEAN NOT NULL DEFAULT false,
  intervalo_minutos INT NOT NULL DEFAULT 15 CHECK (intervalo_minutos BETWEEN 5 AND 1440),
  asignacion_automatica BOOLEAN NOT NULL DEFAULT true,
  escalamiento_automatico BOOLEAN NOT NULL DEFAULT true,
  notificaciones_activas BOOLEAN NOT NULL DEFAULT true,
  ultima_ejecucion_en TIMESTAMPTZ,
  ultima_ejecucion_resultado JSONB,
  actualizada_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  actualizada_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO seguimiento_configuracion (id_configuracion)
VALUES (1)
ON CONFLICT (id_configuracion) DO NOTHING;

CREATE TABLE IF NOT EXISTS notificaciones_internas (
  id_notificacion BIGSERIAL PRIMARY KEY,
  usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  modulo VARCHAR(40) NOT NULL,
  tipo VARCHAR(48) NOT NULL,
  titulo VARCHAR(180) NOT NULL,
  detalle VARCHAR(600),
  enlace VARCHAR(300),
  clave_dedupe VARCHAR(220),
  leida_en TIMESTAMPTZ,
  creada_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_notificacion_interna_dedupe
  ON notificaciones_internas (usuario_id, clave_dedupe)
  WHERE clave_dedupe IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notificacion_interna_bandeja
  ON notificaciones_internas (usuario_id, leida_en, creada_en DESC);

CREATE TABLE IF NOT EXISTS chat_configuracion (
  id_configuracion SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id_configuracion = 1),
  retencion_activa BOOLEAN NOT NULL DEFAULT false,
  retencion_predeterminada_dias INT NOT NULL DEFAULT 365
    CHECK (retencion_predeterminada_dias BETWEEN 30 AND 3650),
  preservar_fijados BOOLEAN NOT NULL DEFAULT true,
  ultima_revision_en TIMESTAMPTZ,
  ultima_revision_resultado JSONB,
  actualizada_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
  actualizada_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO chat_configuracion (id_configuracion)
VALUES (1)
ON CONFLICT (id_configuracion) DO NOTHING;

UPDATE seguimiento_reglas SET responsable_perfil_codigo = 'inspector', escalamiento_dias = 2
WHERE codigo IN ('ATRASOS_PREVENTIVOS', 'ATRASOS_CRITICOS', 'JUSTIFICACION_PENDIENTE')
  AND responsable_perfil_codigo IS NULL;
UPDATE seguimiento_reglas SET responsable_perfil_codigo = 'secretaria', escalamiento_dias = 3
WHERE codigo IN ('ALTA_MANUAL_SIN_ERP', 'ESTUDIANTE_SIN_CURSO', 'ESTUDIANTE_SIN_APODERADO', 'CONFLICTO_IDENTIDAD')
  AND responsable_perfil_codigo IS NULL;
UPDATE seguimiento_reglas SET responsable_perfil_codigo = 'inspector', escalamiento_dias = 1
WHERE codigo IN ('RETIROS_REITERADOS', 'VISITA_SIN_CERRAR', 'RETIRO_SIN_CERRAR')
  AND responsable_perfil_codigo IS NULL;

