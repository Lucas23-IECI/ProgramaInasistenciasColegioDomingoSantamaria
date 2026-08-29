-- Reactivación explícita de señales automáticas.
-- Permite distinguir una condición persistente de una condición resuelta que
-- vuelve a aparecer, sin duplicar avisos durante el mismo ciclo.

ALTER TABLE seguimiento_senales
  ADD COLUMN IF NOT EXISTS ciclo_deteccion INT NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_seguimiento_senal_ciclo'
      AND conrelid = 'seguimiento_senales'::regclass
  ) THEN
    ALTER TABLE seguimiento_senales
      ADD CONSTRAINT ck_seguimiento_senal_ciclo CHECK (ciclo_deteccion > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_seguimiento_tareas_vencidas
  ON seguimiento_tareas (fecha_limite, responsable_usuario_id, id_caso)
  WHERE estado IN ('PENDIENTE', 'EN_PROGRESO');
