-- Guarda una fuente normalizada para permitir reencuadrar avatar y portada.
-- Las imagenes anteriores siguen funcionando: su fuente permanece NULL.

ALTER TABLE archivos_perfil
  ADD COLUMN IF NOT EXISTS nombre_fuente VARCHAR(255),
  ADD COLUMN IF NOT EXISTS mime_fuente VARCHAR(40),
  ADD COLUMN IF NOT EXISTS bytes_fuente INTEGER,
  ADD COLUMN IF NOT EXISTS sha256_fuente VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS uq_archivos_perfil_nombre_fuente
  ON archivos_perfil(nombre_fuente)
  WHERE nombre_fuente IS NOT NULL;

