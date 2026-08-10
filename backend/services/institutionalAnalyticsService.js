const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const validatePeriod = (from, to) => {
  if (!ISO_DATE.test(String(from || '')) || !ISO_DATE.test(String(to || ''))) {
    throw Object.assign(new Error('El período debe indicar fechas válidas.'), { status: 400 });
  }
  const start = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  const days = Math.round((end - start) / 86400000);
  if (days < 0 || days > 366) {
    throw Object.assign(new Error('El período debe abarcar entre 1 y 366 días.'), { status: 400 });
  }
  return { from, to, days: days + 1 };
};

const queryRows = async (pool, text, params) => (await pool.query(text, params)).rows;

const buildInstitutionalAnalytics = async (pool, { from, to }) => {
  const period = validatePeriod(from, to);
  const params = [period.from, period.to];

  const [summary] = await queryRows(pool, `
    SELECT COUNT(*) FILTER (WHERE ar.tipo_registro = 'Entrada')::int AS ingresos,
           COUNT(*) FILTER (WHERE ar.tipo_registro = 'Entrada' AND ar.estado = 'Atrasado')::int AS atrasos,
           COUNT(*) FILTER (WHERE ar.tipo_registro = 'Entrada' AND ar.estado <> 'Atrasado')::int AS a_tiempo,
           ROUND(AVG(ar.minutos_atraso) FILTER (WHERE ar.estado = 'Atrasado'), 1) AS promedio_minutos,
           COUNT(DISTINCT ar.id_alumno) FILTER (WHERE ar.estado = 'Atrasado')::int AS estudiantes_con_atrasos
    FROM attendance_registrations ar
    WHERE ar.fecha BETWEEN $1::date AND $2::date AND ar.anulado = false
  `, params);

  const daily = await queryRows(pool, `
    SELECT d::date AS fecha,
           COUNT(ar.id_registro)::int AS ingresos,
           COUNT(ar.id_registro) FILTER (WHERE ar.estado = 'Atrasado')::int AS atrasos
    FROM generate_series($1::date, $2::date, interval '1 day') d
    LEFT JOIN attendance_registrations ar ON ar.fecha = d::date
      AND ar.tipo_registro = 'Entrada' AND ar.anulado = false
    GROUP BY d ORDER BY d
  `, params);

  const courses = await queryRows(pool, `
    SELECT COALESCE(ar.curso_registro, 'Sin curso') AS curso,
           COUNT(*)::int AS ingresos,
           COUNT(*) FILTER (WHERE ar.estado = 'Atrasado')::int AS atrasos,
           ROUND(100.0 * COUNT(*) FILTER (WHERE ar.estado = 'Atrasado') / NULLIF(COUNT(*), 0), 1) AS porcentaje_atrasos
    FROM attendance_registrations ar
    WHERE ar.fecha BETWEEN $1::date AND $2::date AND ar.anulado = false AND ar.tipo_registro = 'Entrada'
    GROUP BY COALESCE(ar.curso_registro, 'Sin curso')
    ORDER BY atrasos DESC, curso
  `, params);

  const timeBlocks = await queryRows(pool, `
    SELECT COALESCE(ar.control_nombre, 'Ingreso general') AS bloque,
           COALESCE(to_char(ar.hora_limite_aplicada, 'HH24:MI'), 'Sin límite') AS hora_limite,
           COUNT(*)::int AS ingresos,
           COUNT(*) FILTER (WHERE ar.estado = 'Atrasado')::int AS atrasos,
           ROUND(AVG(ar.minutos_atraso) FILTER (WHERE ar.estado = 'Atrasado'), 1) AS promedio_minutos
    FROM attendance_registrations ar
    WHERE ar.fecha BETWEEN $1::date AND $2::date AND ar.anulado = false AND ar.tipo_registro = 'Entrada'
    GROUP BY ar.control_nombre, ar.hora_limite_aplicada
    ORDER BY atrasos DESC, bloque
  `, params);

  const improvedStudents = await queryRows(pool, `
    WITH limits AS (
      SELECT $1::date AS desde, $2::date AS hasta,
             $1::date + (($2::date - $1::date) / 2) AS corte
    ), counts AS (
      SELECT ar.id_alumno,
             COUNT(*) FILTER (WHERE ar.fecha <= l.corte AND ar.estado = 'Atrasado')::int AS antes,
             COUNT(*) FILTER (WHERE ar.fecha > l.corte AND ar.estado = 'Atrasado')::int AS despues
      FROM attendance_registrations ar CROSS JOIN limits l
      WHERE ar.fecha BETWEEN l.desde AND l.hasta AND ar.anulado = false AND ar.tipo_registro = 'Entrada'
      GROUP BY ar.id_alumno
    )
    SELECT c.id_alumno, concat_ws(' ', a.nombres, a.paterno, a.materno) AS estudiante,
           c.antes, c.despues, (c.antes - c.despues)::int AS reduccion
    FROM counts c JOIN alumno a ON a.id_alumno = c.id_alumno
    WHERE c.antes > c.despues AND c.antes > 0
    ORDER BY reduccion DESC, estudiante LIMIT 20
  `, params);

  const interventions = await queryRows(pool, `
    WITH first_intervention AS (
      SELECT cp.estudiante_id, MIN(ce.fecha_evento)::date AS fecha_intervencion
      FROM convivencia_participantes cp
      JOIN convivencia_eventos ce ON ce.id_caso = cp.id_caso
      WHERE cp.estudiante_id IS NOT NULL AND cp.activo = true
        AND ce.tipo IN ('MEDIDA', 'MEDIACION', 'ACUERDO', 'SEGUIMIENTO', 'DERIVACION')
        AND ce.fecha_evento::date BETWEEN $1::date AND $2::date
      GROUP BY cp.estudiante_id
    ), comparison AS (
      SELECT fi.estudiante_id,
        COUNT(ar.id_registro) FILTER (WHERE ar.estado = 'Atrasado' AND ar.fecha >= fi.fecha_intervencion - 30 AND ar.fecha < fi.fecha_intervencion)::int AS antes,
        COUNT(ar.id_registro) FILTER (WHERE ar.estado = 'Atrasado' AND ar.fecha >= fi.fecha_intervencion AND ar.fecha <= fi.fecha_intervencion + 30)::int AS despues
      FROM first_intervention fi
      LEFT JOIN attendance_registrations ar ON ar.id_alumno = fi.estudiante_id AND ar.anulado = false AND ar.tipo_registro = 'Entrada'
      GROUP BY fi.estudiante_id
    )
    SELECT COUNT(*)::int AS estudiantes_evaluados,
      COUNT(*) FILTER (WHERE despues < antes)::int AS mejoraron,
      COUNT(*) FILTER (WHERE despues = antes)::int AS sin_cambio,
      COUNT(*) FILTER (WHERE despues > antes)::int AS reincidieron
    FROM comparison
  `, params);

  const guardianContacts = await queryRows(pool, `
    WITH contacted AS (
      SELECT DISTINCT cc.id_caso
      FROM convivencia_casos cc
      JOIN convivencia_eventos ce ON ce.id_caso = cc.id_caso AND ce.tipo = 'ENTREVISTA'
      JOIN convivencia_participantes cp ON cp.id_caso = cc.id_caso AND cp.rol_en_caso = 'APODERADO' AND cp.activo = true
      WHERE ce.fecha_evento::date BETWEEN $1::date AND $2::date
    )
    SELECT COUNT(*)::int AS casos_con_contacto,
           COUNT(*) FILTER (WHERE cc.estado = 'CERRADO')::int AS cerrados,
           ROUND(100.0 * COUNT(*) FILTER (WHERE cc.estado = 'CERRADO') / NULLIF(COUNT(*), 0), 1) AS porcentaje_cierre
    FROM contacted c JOIN convivencia_casos cc ON cc.id_caso = c.id_caso
  `, params);

  const withdrawals = await queryRows(pool, `
    SELECT COALESCE(rm.nombre, r.motivo, 'Sin motivo') AS motivo, COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE r.estado = 'ENTREGADO')::int AS entregados
    FROM retiros_alumno r LEFT JOIN retiro_motivos rm ON rm.codigo = r.motivo_codigo
    WHERE r.solicitado_en::date BETWEEN $1::date AND $2::date
    GROUP BY COALESCE(rm.nombre, r.motivo, 'Sin motivo') ORDER BY total DESC, motivo
  `, params);

  const visitReasons = await queryRows(pool, `
    SELECT COALESCE(vm.nombre, v.motivo_codigo) AS motivo, COUNT(*)::int AS total
    FROM visitas v LEFT JOIN visita_motivos vm ON vm.codigo = v.motivo_codigo
    WHERE v.ingreso_en::date BETWEEN $1::date AND $2::date
    GROUP BY COALESCE(vm.nombre, v.motivo_codigo) ORDER BY total DESC, motivo
  `, params);

  const [cases] = await queryRows(pool, `
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE estado IN ('ABIERTO', 'EN_SEGUIMIENTO', 'EN_REVISION'))::int AS abiertos,
           COUNT(*) FILTER (WHERE estado = 'CERRADO')::int AS resueltos,
           ROUND(AVG(EXTRACT(EPOCH FROM (cerrado_en - creado_en)) / 86400) FILTER (WHERE estado = 'CERRADO'), 1) AS promedio_dias_resolucion
    FROM convivencia_casos WHERE creado_en::date BETWEEN $1::date AND $2::date
  `, params);

  const workload = await queryRows(pool, `
    SELECT COALESCE(NULLIF(trim(u.cargo), ''), p.nombre, 'Sin área asignada') AS area,
           COUNT(*)::int AS casos,
           COUNT(*) FILTER (WHERE cc.estado IN ('ABIERTO', 'EN_SEGUIMIENTO', 'EN_REVISION'))::int AS abiertos,
           COUNT(*) FILTER (WHERE cc.estado = 'CERRADO')::int AS resueltos
    FROM convivencia_casos cc
    LEFT JOIN usuarios u ON u.id = cc.responsable_usuario_id
    LEFT JOIN perfiles_acceso p ON p.codigo = u.rol
    WHERE cc.creado_en::date BETWEEN $1::date AND $2::date
    GROUP BY COALESCE(NULLIF(trim(u.cargo), ''), p.nombre, 'Sin área asignada')
    ORDER BY casos DESC, area
  `, params);

  const alerts = [];
  const delayRate = Number(summary?.ingresos) ? Number(((Number(summary.atrasos) / Number(summary.ingresos)) * 100).toFixed(1)) : 0;
  if (delayRate >= 20) alerts.push({
    level: 'alta', title: 'Alta proporción de atrasos registrados',
    explanation: `${summary.atrasos} de ${summary.ingresos} ingresos fueron atrasos (${delayRate}%). La alerta se activa desde 20%.`,
    rule: 'atrasos / ingresos registrados >= 20%'
  });
  if (Number(cases?.abiertos) >= 5) alerts.push({
    level: 'media', title: 'Casos de convivencia pendientes',
    explanation: `Hay ${cases.abiertos} casos abiertos o en seguimiento creados en el período. La alerta se activa desde 5 casos.`,
    rule: 'casos abiertos del período >= 5'
  });
  const peak = [...timeBlocks].sort((a, b) => Number(b.atrasos) - Number(a.atrasos))[0];
  if (peak && Number(peak.atrasos) > 0) alerts.push({
    level: 'informativa', title: `Bloque con mayor concentración: ${peak.bloque}`,
    explanation: `${peak.atrasos} atrasos se registraron en este bloque; se muestra el máximo observado, sin puntaje oculto.`,
    rule: 'máximo conteo de atrasos por bloque horario'
  });

  return {
    periodo: period,
    generado_en: new Date().toISOString(),
    resumen: { ...summary, tasa_atrasos: delayRate },
    tendencia_diaria: daily,
    comparacion_cursos: courses,
    bloques_horarios: timeBlocks,
    estudiantes_mejoraron: improvedStudents,
    reincidencia_post_intervencion: interventions[0] || { estudiantes_evaluados: 0, mejoraron: 0, sin_cambio: 0, reincidieron: 0 },
    contactos_apoderados: guardianContacts[0] || { casos_con_contacto: 0, cerrados: 0, porcentaje_cierre: null },
    retiros_anticipados: withdrawals,
    motivos_visita: visitReasons,
    convivencia: cases || { total: 0, abiertos: 0, resueltos: 0, promedio_dias_resolucion: null },
    carga_trabajo: workload,
    alertas: alerts,
    metodologia: {
      estudiantes_mejoraron: 'Compara atrasos registrados en la primera y segunda mitad del período.',
      reincidencia_post_intervencion: 'Compara 30 días antes y 30 días después de la primera medida, mediación, acuerdo, seguimiento o derivación.',
      contactos_apoderados: 'Indicador descriptivo: proporción de casos con entrevista y apoderado participante que están cerrados. No demuestra causalidad.',
      privacidad: 'Solo entrega métricas agregadas y nombres de estudiantes en la lista operativa de mejoría; no expone detalles de casos reservados.'
    }
  };
};

module.exports = { buildInstitutionalAnalytics, validatePeriod };
