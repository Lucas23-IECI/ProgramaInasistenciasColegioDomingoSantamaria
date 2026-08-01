const normalizeReason = (value, fallback) => {
  const reason = String(value || fallback || '').trim();
  return reason.slice(0, 500) || 'Actualización institucional';
};

const getActiveEnrollment = async (queryable, studentId, { forUpdate = false } = {}) => {
  const result = await queryable.query(`
    SELECT m.id_matricula, m.id_alumno, m.id_curso, m.vigente_desde,
           c.nombre_curso
    FROM matricula m
    JOIN curso c ON c.id_curso = m.id_curso
    WHERE m.id_alumno = $1 AND m.vigente_hasta IS NULL
    ORDER BY m.vigente_desde DESC, m.id_matricula DESC
    LIMIT 1
    ${forUpdate ? 'FOR UPDATE OF m' : ''}
  `, [studentId]);
  return result.rows[0] || null;
};

const assignEnrollment = async (queryable, {
  studentId,
  courseId,
  userId = null,
  reason = 'Asignación de matrícula',
  effectiveDate = null
}) => {
  const date = effectiveDate || (await queryable.query('SELECT CURRENT_DATE::text AS fecha')).rows[0].fecha;
  const current = await getActiveEnrollment(queryable, studentId, { forUpdate: true });

  if (current && Number(current.id_curso) === Number(courseId)) {
    return { changed: false, current, previous: current };
  }

  if (current) {
    await queryable.query(`
      UPDATE matricula
      SET vigente_hasta = GREATEST(vigente_desde, $1::date),
          motivo_cambio = $2,
          actualizado_por = $3,
          actualizado_en = CURRENT_TIMESTAMP
      WHERE id_matricula = $4
    `, [date, normalizeReason(reason, 'Cambio de curso'), userId, current.id_matricula]);
  }

  const inserted = await queryable.query(`
    INSERT INTO matricula (
      id_alumno, id_curso, fecha_registro, vigente_desde,
      motivo_cambio, creado_por, actualizado_por
    )
    VALUES ($1, $2, CURRENT_TIMESTAMP, $3::date, $4, $5, $5)
    RETURNING *
  `, [studentId, courseId, date, normalizeReason(reason, 'Asignación de matrícula'), userId]);

  return { changed: true, current: inserted.rows[0], previous: current };
};

const closeEnrollment = async (queryable, {
  studentId,
  userId = null,
  reason,
  effectiveDate = null
}) => {
  const date = effectiveDate || (await queryable.query('SELECT CURRENT_DATE::text AS fecha')).rows[0].fecha;
  const current = await getActiveEnrollment(queryable, studentId, { forUpdate: true });
  if (!current) return { changed: false, previous: null };

  await queryable.query(`
    UPDATE matricula
    SET vigente_hasta = GREATEST(vigente_desde, $1::date),
        motivo_cambio = $2,
        actualizado_por = $3,
        actualizado_en = CURRENT_TIMESTAMP
    WHERE id_matricula = $4
  `, [date, normalizeReason(reason, 'Retiro de matrícula'), userId, current.id_matricula]);

  return { changed: true, previous: current };
};

module.exports = {
  assignEnrollment,
  closeEnrollment,
  getActiveEnrollment
};
