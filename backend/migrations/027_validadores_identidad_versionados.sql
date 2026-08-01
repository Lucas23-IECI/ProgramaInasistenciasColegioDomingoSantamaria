-- Registra qué regla validó cada identificador y con qué versión. La migración
-- no modifica valores ni invalida documentos históricos: conserva la evidencia
-- disponible y marca como pendiente aquello que requiere antecedentes.

ALTER TABLE alumno_identificador
  ADD COLUMN IF NOT EXISTS validador_id VARCHAR(80),
  ADD COLUMN IF NOT EXISTS validador_version VARCHAR(20),
  ADD COLUMN IF NOT EXISTS resultado_validacion VARCHAR(24),
  ADD COLUMN IF NOT EXISTS validado_en TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_alumno_identificador_resultado_validacion'
  ) THEN
    ALTER TABLE alumno_identificador
      ADD CONSTRAINT ck_alumno_identificador_resultado_validacion CHECK (
        resultado_validacion IS NULL OR resultado_validacion IN (
          'VERIFICADO', 'ESTRUCTURAL', 'DECLARADO', 'SISTEMA', 'PENDIENTE', 'RECHAZADO'
        )
      );
  END IF;
END $$;

UPDATE alumno_identificador
SET validador_id = CASE
      WHEN tipo = 'RUN_CHILE' THEN 'cl.run.modulo11'
      WHEN tipo = 'IPE_MINEDUC' THEN 'cl.mineduc.ipe.estructura'
      WHEN tipo IN ('PASAPORTE', 'DNI', 'CEDULA', 'DOCUMENTO_EXTRANJERO')
        THEN 'global.documento.estructural'
      WHEN tipo IN ('ID_ERP', 'CODIGO_INTERNO', 'CODIGO_BARRAS')
        THEN 'sistema.identificador.interno'
      ELSE validador_id
    END,
    validador_version = COALESCE(validador_version, '1.0.0'),
    resultado_validacion = CASE
      WHEN tipo = 'RUN_CHILE'
        THEN CASE WHEN nivel_validacion = 'DV_VERIFICADO' THEN 'VERIFICADO' ELSE 'PENDIENTE' END
      WHEN tipo = 'IPE_MINEDUC'
        THEN CASE
          WHEN nivel_validacion IN ('ESTRUCTURA_IPE_VALIDADA', 'FUENTE_MINEDUC_ERP', 'IPE_DECLARADO_MANUAL')
            THEN 'ESTRUCTURAL'
          ELSE 'PENDIENTE'
        END
      WHEN tipo IN ('PASAPORTE', 'DNI', 'CEDULA', 'DOCUMENTO_EXTRANJERO')
        THEN CASE WHEN pais_emisor IS NULL THEN 'PENDIENTE' ELSE 'ESTRUCTURAL' END
      WHEN tipo IN ('ID_ERP', 'CODIGO_INTERNO', 'CODIGO_BARRAS') THEN 'SISTEMA'
      ELSE COALESCE(resultado_validacion, 'PENDIENTE')
    END,
    validado_en = COALESCE(validado_en, actualizado_en, creado_en, CURRENT_TIMESTAMP)
WHERE validador_id IS NULL
   OR validador_version IS NULL
   OR resultado_validacion IS NULL
   OR validado_en IS NULL;

CREATE INDEX IF NOT EXISTS idx_alumno_identificador_validacion
  ON alumno_identificador (resultado_validacion, tipo, pais_emisor)
  WHERE estado <> 'REVOCADO';

COMMENT ON COLUMN alumno_identificador.validador_id IS
  'Identificador estable de la regla aplicada; no implica autenticidad documental.';
COMMENT ON COLUMN alumno_identificador.validador_version IS
  'Versión de la regla utilizada para poder reproducir la decisión histórica.';
COMMENT ON COLUMN alumno_identificador.resultado_validacion IS
  'Alcance comprobado: verificado, estructural, declarado, sistema, pendiente o rechazado.';
