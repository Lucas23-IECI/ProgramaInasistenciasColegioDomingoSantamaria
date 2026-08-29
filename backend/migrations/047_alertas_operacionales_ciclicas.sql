-- Ciclos persistentes para avisos automáticos que pueden resolverse y reaparecer.
-- La tabla no elimina ni modifica notificaciones históricas.

CREATE TABLE IF NOT EXISTS alertas_operacionales_estado (
  clave_alerta VARCHAR(220) PRIMARY KEY,
  modulo VARCHAR(40) NOT NULL,
  tipo VARCHAR(64) NOT NULL,
  entidad_tipo VARCHAR(64),
  entidad_id VARCHAR(80),
  activa BOOLEAN NOT NULL DEFAULT true,
  ciclo INT NOT NULL DEFAULT 1 CHECK (ciclo > 0),
  detectada_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resuelta_en TIMESTAMPTZ,
  actualizada_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  datos JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_alertas_operacionales_activas
  ON alertas_operacionales_estado (modulo, tipo, activa, actualizada_en DESC);
