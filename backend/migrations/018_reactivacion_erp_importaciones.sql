-- Compatibilidad para instalaciones que ya aplicaron la gobernanza inicial.

ALTER TABLE importaciones_estudiantes
  ALTER COLUMN estado TYPE VARCHAR(32);

ALTER TABLE importacion_estudiante_cambios
  DROP CONSTRAINT IF EXISTS importacion_estudiante_cambios_accion_check;

ALTER TABLE importacion_estudiante_cambios
  ADD CONSTRAINT importacion_estudiante_cambios_accion_check
  CHECK (accion IN (
    'CREADO',
    'ACTUALIZADO',
    'SIN_CAMBIOS',
    'VINCULADO_MANUAL',
    'REACTIVADO_DESDE_ERP',
    'RETIRADO_POR_NOMINA',
    'RECHAZADO',
    'CONFLICTO'
  ));
