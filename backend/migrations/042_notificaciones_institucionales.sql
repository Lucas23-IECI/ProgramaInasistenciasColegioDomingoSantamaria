-- Notificaciones institucionales dirigidas y auditables.
-- Amplia la bandeja existente sin modificar ni eliminar avisos de Seguimiento.

CREATE TABLE IF NOT EXISTS notificaciones_envios (
  id_envio BIGSERIAL PRIMARY KEY,
  enviado_por INT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  titulo VARCHAR(180) NOT NULL,
  detalle VARCHAR(1000) NOT NULL,
  prioridad VARCHAR(20) NOT NULL DEFAULT 'NORMAL'
    CHECK (prioridad IN ('NORMAL', 'IMPORTANTE', 'URGENTE')),
  enlace VARCHAR(300),
  destinatarios_total INT NOT NULL CHECK (destinatarios_total > 0),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE notificaciones_internas
  ADD COLUMN IF NOT EXISTS envio_id BIGINT,
  ADD COLUMN IF NOT EXISTS enviado_por INT,
  ADD COLUMN IF NOT EXISTS prioridad VARCHAR(20) NOT NULL DEFAULT 'NORMAL';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_notificacion_interna_envio'
      AND conrelid = 'notificaciones_internas'::regclass
  ) THEN
    ALTER TABLE notificaciones_internas
      ADD CONSTRAINT fk_notificacion_interna_envio
      FOREIGN KEY (envio_id) REFERENCES notificaciones_envios(id_envio) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_notificacion_interna_emisor'
      AND conrelid = 'notificaciones_internas'::regclass
  ) THEN
    ALTER TABLE notificaciones_internas
      ADD CONSTRAINT fk_notificacion_interna_emisor
      FOREIGN KEY (enviado_por) REFERENCES usuarios(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_notificacion_interna_prioridad'
      AND conrelid = 'notificaciones_internas'::regclass
  ) THEN
    ALTER TABLE notificaciones_internas
      ADD CONSTRAINT ck_notificacion_interna_prioridad
      CHECK (prioridad IN ('NORMAL', 'IMPORTANTE', 'URGENTE'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notificaciones_envios_emisor
  ON notificaciones_envios (enviado_por, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_notificaciones_internas_envio
  ON notificaciones_internas (envio_id);

INSERT INTO permisos_sistema (codigo, grupo, etiqueta, descripcion, orden, critico) VALUES
  ('notifications.send', 'Comunicación institucional', 'Enviar avisos institucionales', 'Permite enviar notificaciones visibles dentro de la aplicación a cuentas activas seleccionadas.', 657, true)
ON CONFLICT (codigo) DO UPDATE SET
  grupo = EXCLUDED.grupo,
  etiqueta = EXCLUDED.etiqueta,
  descripcion = EXCLUDED.descripcion,
  orden = EXCLUDED.orden,
  critico = EXCLUDED.critico;

INSERT INTO permisos_rol (rol, permiso_codigo) VALUES
  ('admin', 'notifications.send'),
  ('direccion', 'notifications.send')
ON CONFLICT DO NOTHING;
