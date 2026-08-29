-- Estado verificable de los envíos institucionales y reintentos seguros.
-- No elimina notificaciones ni altera su destinatario o lectura.

ALTER TABLE notificaciones_envios
  ADD COLUMN IF NOT EXISTS estado VARCHAR(20) NOT NULL DEFAULT 'ENVIADO',
  ADD COLUMN IF NOT EXISTS error_publico VARCHAR(500),
  ADD COLUMN IF NOT EXISTS destinatarios_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS reintento_de BIGINT,
  ADD COLUMN IF NOT EXISTS reintento_numero INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_notificacion_envio_estado'
      AND conrelid = 'notificaciones_envios'::regclass
  ) THEN
    ALTER TABLE notificaciones_envios
      ADD CONSTRAINT ck_notificacion_envio_estado
      CHECK (estado IN ('PENDIENTE', 'ENVIADO', 'FALLIDO'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_notificacion_envio_reintento'
      AND conrelid = 'notificaciones_envios'::regclass
  ) THEN
    ALTER TABLE notificaciones_envios
      ADD CONSTRAINT ck_notificacion_envio_reintento
      CHECK (reintento_numero >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_notificacion_envio_reintento'
      AND conrelid = 'notificaciones_envios'::regclass
  ) THEN
    ALTER TABLE notificaciones_envios
      ADD CONSTRAINT fk_notificacion_envio_reintento
      FOREIGN KEY (reintento_de) REFERENCES notificaciones_envios(id_envio) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notificaciones_envios_estado
  ON notificaciones_envios (enviado_por, estado, creado_en DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_notificaciones_envios_reintento
  ON notificaciones_envios (reintento_de)
  WHERE reintento_de IS NOT NULL;
