-- Corrige la variante histórica "1� Medio" creada por una codificación inválida.
-- Si existen matrículas asociadas, se reasignan al curso canónico antes de eliminarla.
DO $$
DECLARE
  curso_canonico INT;
  curso_corrupto INT;
BEGIN
  SELECT id_curso INTO curso_canonico
  FROM curso
  WHERE nombre_curso = '1° Medio'
  LIMIT 1;

  SELECT id_curso INTO curso_corrupto
  FROM curso
  WHERE nombre_curso = '1� Medio'
  LIMIT 1;

  IF curso_corrupto IS NULL THEN
    RETURN;
  END IF;

  IF curso_canonico IS NULL THEN
    UPDATE curso
    SET nombre_curso = '1° Medio'
    WHERE id_curso = curso_corrupto;
    RETURN;
  END IF;

  UPDATE matricula
  SET id_curso = curso_canonico
  WHERE id_curso = curso_corrupto;

  DELETE FROM curso
  WHERE id_curso = curso_corrupto;
END $$;
