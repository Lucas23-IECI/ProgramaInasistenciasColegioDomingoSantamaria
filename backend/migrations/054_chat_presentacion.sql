ALTER TABLE chat_conversaciones ADD COLUMN IF NOT EXISTS solo_administradores BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE chat_conversaciones ADD COLUMN IF NOT EXISTS foto_data TEXT;
ALTER TABLE chat_conversaciones ADD COLUMN IF NOT EXISTS foto_version TEXT;

CREATE TABLE IF NOT EXISTS chat_apariencia_usuario (
  usuario_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  fondo TEXT NOT NULL DEFAULT 'institucional' CHECK (fondo IN ('institucional','salvia','arena','azul','personalizado')),
  tamano_texto TEXT NOT NULL DEFAULT 'normal' CHECK (tamano_texto IN ('normal','grande')),
  fondo_data TEXT,
  actualizada_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
