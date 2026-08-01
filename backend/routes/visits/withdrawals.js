const registerWithdrawalRoutes = (context) => {
  const {
    router,
    pool,
    verifyPermission,
    verifyAnyPermission,
    insertarAudit,
    getClientIp,
    sanitizeText,
    parsePositiveId,
    findOrCreateVisitor,
    visitorPayload,
    visitSelect,
    mapVisit,
    withdrawalSelect,
    mapWithdrawal,
    isIsoDate,
    validateDateRange,
    cleanDocument,
    maskDocument,
    normalizeVisitorDocument,
    buildVisitsMarkdown,
    buildVisitsWorkbook,
    streamVisitsPdf
  } = context;

  router.get('/retiros', verifyAnyPermission([
    'visits.view',
    'visits.history',
    'visits.reports',
    'withdrawals.register',
    'withdrawals.approve',
    'withdrawals.authorizations'
  ]), async (req, res) => {
    const state = sanitizeText(req.query.estado, 20).toUpperCase();
    const conditions = [];
    const params = [];
    if (state) {
      conditions.push('r.estado = $1');
      params.push(state);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    try {
      const result = await pool.query(
        `${withdrawalSelect}
         ${where}
         ORDER BY CASE r.estado WHEN 'SOLICITADO' THEN 0 WHEN 'AUTORIZADO' THEN 1 ELSE 2 END,
                  r.solicitado_en DESC
         LIMIT 100`,
        params
      );
      res.json(result.rows.map(mapWithdrawal));
    } catch (error) {
      console.error('[retiros:listar]', error.message);
      res.status(500).json({ message: 'No fue posible obtener los retiros.' });
    }
  });

  router.get('/reportes', verifyPermission('visits.reports'), async (req, res) => {
    const today = new Date();
    const defaultTo = today.toISOString().slice(0, 10);
    const defaultFromDate = new Date(today);
    defaultFromDate.setDate(defaultFromDate.getDate() - 29);
    const defaultFrom = defaultFromDate.toISOString().slice(0, 10);
    const from = String(req.query.desde || defaultFrom);
    const to = String(req.query.hasta || defaultTo);
    const scope = String(req.query.tipo || 'TODO').toUpperCase();
    const format = String(req.query.formato || 'json').toLowerCase();

    if (!isIsoDate(from) || !isIsoDate(to)) {
      return res.status(400).json({ message: 'El período del reporte no es válido.' });
    }
    const range = validateDateRange(from, to, { maxDays: 366 });
    if (range.error) return res.status(400).json({ message: range.error });
    if (!['TODO', 'VISITAS', 'RETIROS'].includes(scope)) {
      return res.status(400).json({ message: 'El contenido del reporte no es válido.' });
    }
    if (!['json', 'xlsx', 'pdf', 'md'].includes(format)) {
      return res.status(400).json({ message: 'El formato solicitado no es válido.' });
    }

    try {
      const [visitsResult, withdrawalsResult] = await Promise.all([
        scope === 'RETIROS'
          ? Promise.resolve({ rows: [] })
          : pool.query(
            `${visitSelect}
             WHERE v.ingreso_en >= $1::date
               AND v.ingreso_en < ($2::date + interval '1 day')
             ORDER BY v.ingreso_en DESC
             LIMIT 10000`,
            [from, to]
          ),
        scope === 'VISITAS'
          ? Promise.resolve({ rows: [] })
          : pool.query(
            `${withdrawalSelect}
             WHERE r.solicitado_en >= $1::date
               AND r.solicitado_en < ($2::date + interval '1 day')
             ORDER BY r.solicitado_en DESC
             LIMIT 10000`,
            [from, to]
          )
      ]);
      const report = {
        generado_en: new Date().toISOString(),
        periodo: { desde: from, hasta: to },
        tipo: scope,
        resumen: {
          visitas: visitsResult.rows.length,
          personas_dentro: visitsResult.rows.filter((row) => row.estado === 'DENTRO').length,
          retiros: withdrawalsResult.rows.length,
          retiros_pendientes: withdrawalsResult.rows.filter((row) => row.estado === 'SOLICITADO').length,
          retiros_entregados: withdrawalsResult.rows.filter((row) => row.estado === 'ENTREGADO').length
        },
        visitas: visitsResult.rows.map(mapVisit),
        retiros: withdrawalsResult.rows.map(mapWithdrawal)
      };

      await insertarAudit(pool, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: 'EXPORTAR_REPORTE_VISITAS',
        entidad: 'reporte_visitas_retiros',
        entidad_id: null,
        detalle: {
          desde: from,
          hasta: to,
          tipo: scope,
          formato: format,
          visitas: report.resumen.visitas,
          retiros: report.resumen.retiros
        },
        ip: getClientIp(req)
      });

      if (format === 'pdf') {
        streamVisitsPdf(res, report);
        return;
      }

      if (format === 'xlsx') {
        const buffer = await buildVisitsWorkbook(report);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="reporte-visitas-retiros-${from}-${to}.xlsx"`);
        res.send(buffer);
        return;
      }

      if (format === 'md') {
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="reporte-visitas-retiros-${from}-${to}.md"`);
        res.send(buildVisitsMarkdown(report));
        return;
      }

      res.json(report);
    } catch (error) {
      console.error('[visitas:reportes]', error.message);
      res.status(500).json({ message: 'No fue posible generar el reporte.' });
    }
  });

  router.post('/retiros', verifyPermission('withdrawals.register'), async (req, res) => {
    const studentId = parsePositiveId(req.body?.id_alumno);
    const reasonCode = sanitizeText(req.body?.motivo_codigo, 40).toUpperCase();
    const reasonDetail = sanitizeText(req.body?.motivo_detalle, 500);
    const relationshipCode = sanitizeText(req.body?.parentesco_declarado_codigo, 40).toUpperCase();
    const relationshipDetail = sanitizeText(req.body?.parentesco_declarado_detalle, 120);
    if (!studentId) return res.status(400).json({ message: 'Selecciona el estudiante que será retirado.' });
    if (!reasonCode) return res.status(400).json({ message: 'Selecciona el motivo del retiro.' });
    if (!relationshipCode) return res.status(400).json({ message: 'Selecciona la relación con el estudiante.' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const student = await client.query(
        'SELECT id_alumno, activo FROM alumno WHERE id_alumno = $1 FOR SHARE',
        [studentId]
      );
      if (!student.rows.length || !student.rows[0].activo) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'El estudiante no está activo en el padrón.' });
      }
      const [reasonConfig, relationshipConfig] = await Promise.all([
        client.query(
          'SELECT nombre, requiere_detalle FROM retiro_motivos WHERE codigo = $1 AND activo = true',
          [reasonCode]
        ),
        client.query(
          'SELECT nombre, requiere_detalle FROM tipos_parentesco WHERE codigo = $1 AND activo = true',
          [relationshipCode]
        )
      ]);
      if (!reasonConfig.rows.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'El motivo seleccionado ya no está disponible.' });
      }
      if (!relationshipConfig.rows.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'La relación seleccionada ya no está disponible.' });
      }
      if (reasonConfig.rows[0].requiere_detalle && reasonDetail.length < 5) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Agrega una breve justificación para este motivo.' });
      }
      if (relationshipConfig.rows[0].requiere_detalle && relationshipDetail.length < 3) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Describe la relación con el estudiante.' });
      }
      const visitor = await findOrCreateVisitor(client, req.body?.visitante, req.user.id);
      const authorization = await client.query(
        `SELECT id, parentesco, origen_autorizacion
         FROM personas_autorizadas_retiro
         WHERE id_alumno = $1
           AND visitante_id = $2
           AND activo = true
           AND vigente_desde <= CURRENT_DATE
           AND (vigente_hasta IS NULL OR vigente_hasta >= CURRENT_DATE)
         LIMIT 1`,
        [studentId, visitor.id]
      );
      const result = await client.query(
        `INSERT INTO retiros_alumno
          (id_alumno, visitante_id, autorizacion_id, motivo, motivo_codigo,
           motivo_detalle, parentesco_declarado_codigo,
           parentesco_declarado_detalle, solicitado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          studentId,
          visitor.id,
          authorization.rows[0]?.id || null,
          reasonDetail || reasonConfig.rows[0].nombre,
          reasonCode,
          reasonDetail || null,
          relationshipCode,
          relationshipDetail || null,
          req.user.id
        ]
      );
      const withdrawalId = result.rows[0].id;
      await insertarAudit(client, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: 'SOLICITAR_RETIRO_ALUMNO',
        entidad: 'retiro_alumno',
        entidad_id: withdrawalId,
        detalle: {
          id_alumno: studentId,
          visitante_id: visitor.id,
          motivo_codigo: reasonCode,
          parentesco_declarado_codigo: relationshipCode,
          coincidencia_autorizada: Boolean(authorization.rows.length),
          requiere_decision: true
        },
        ip: getClientIp(req)
      });
      await client.query('COMMIT');
      const created = await pool.query(`${withdrawalSelect} WHERE r.id = $1`, [withdrawalId]);
      res.status(201).json(mapWithdrawal(created.rows[0]));
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[retiros:solicitar]', error.message);
      if (error.code === '23505') return res.status(409).json({ message: 'Este estudiante ya tiene un retiro pendiente.' });
      res.status(error.status || 500).json({ message: error.status ? error.message : 'No fue posible registrar la solicitud.' });
    } finally {
      client.release();
    }
  });

  router.post('/retiros/registrar-salida', verifyPermission('withdrawals.register'), async (req, res) => {
    const studentIds = [...new Set(
      (Array.isArray(req.body?.id_alumnos) ? req.body.id_alumnos : [])
        .map(parsePositiveId)
        .filter(Boolean)
    )];
    const reasonCode = sanitizeText(req.body?.motivo_codigo, 40).toUpperCase();
    const reasonDetail = sanitizeText(req.body?.motivo_detalle, 500);
    const relationshipCode = sanitizeText(req.body?.parentesco_declarado_codigo, 40).toUpperCase();
    const relationshipDetail = sanitizeText(req.body?.parentesco_declarado_detalle, 120);
    const exceptionalResponsible = sanitizeText(req.body?.validacion_excepcional?.responsable, 160);
    const exceptionalReason = sanitizeText(req.body?.validacion_excepcional?.motivo, 500);

    if (studentIds.length < 1) {
      return res.status(400).json({ message: 'Selecciona al menos un estudiante.' });
    }
    if (studentIds.length > 10) {
      return res.status(400).json({ message: 'No se pueden registrar más de 10 estudiantes en una misma salida.' });
    }
    if (!reasonCode) return res.status(400).json({ message: 'Selecciona el motivo del retiro.' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const reasonConfig = await client.query(
        'SELECT nombre, requiere_detalle FROM retiro_motivos WHERE codigo = $1 AND activo = true',
        [reasonCode]
      );
      if (!reasonConfig.rows.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'El motivo seleccionado ya no está disponible.' });
      }
      if (reasonConfig.rows[0].requiere_detalle && reasonDetail.length < 5) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Agrega una breve justificación para este motivo.' });
      }

      const students = await client.query(
        `SELECT id_alumno, nombres, paterno, materno
         FROM alumno
         WHERE id_alumno = ANY($1::int[]) AND activo = true
         FOR SHARE`,
        [studentIds]
      );
      if (students.rows.length !== studentIds.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Uno o más estudiantes ya no están activos en el padrón.' });
      }

      let visitor;
      const existingVisitorId = parsePositiveId(req.body?.visitante_id);
      if (existingVisitorId) {
        const visitorResult = await client.query(
          'SELECT * FROM visitantes WHERE id = $1 AND activo = true FOR SHARE',
          [existingVisitorId]
        );
        if (!visitorResult.rows.length) {
          await client.query('ROLLBACK');
          return res.status(404).json({ message: 'La persona seleccionada ya no está disponible.' });
        }
        visitor = visitorResult.rows[0];
      } else {
        visitor = await findOrCreateVisitor(client, req.body?.visitante, req.user.id);
      }

      const authorizations = await client.query(
        `SELECT pa.id, pa.id_alumno, pa.parentesco, pa.parentesco_codigo
         FROM personas_autorizadas_retiro pa
         WHERE pa.id_alumno = ANY($1::int[])
           AND pa.visitante_id = $2
           AND pa.activo = true
           AND pa.vigente_desde <= CURRENT_DATE
           AND (pa.vigente_hasta IS NULL OR pa.vigente_hasta >= CURRENT_DATE)`,
        [studentIds, visitor.id]
      );
      const authorizationByStudent = new Map(
        authorizations.rows.map((authorization) => [Number(authorization.id_alumno), authorization])
      );
      const studentsWithoutAuthorization = studentIds.filter((id) => !authorizationByStudent.has(id));

      let relationshipConfig = null;
      if (studentsWithoutAuthorization.length) {
        if (!relationshipCode) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            message: 'Indica la relación y la validación excepcional para los estudiantes que no están vinculados a esta persona.',
            estudiantes_sin_autorizacion: studentsWithoutAuthorization
          });
        }
        relationshipConfig = await client.query(
          'SELECT nombre, requiere_detalle FROM tipos_parentesco WHERE codigo = $1 AND activo = true',
          [relationshipCode]
        );
        if (!relationshipConfig.rows.length) {
          await client.query('ROLLBACK');
          return res.status(400).json({ message: 'La relación seleccionada ya no está disponible.' });
        }
        if (relationshipConfig.rows[0].requiere_detalle && relationshipDetail.length < 3) {
          await client.query('ROLLBACK');
          return res.status(400).json({ message: 'Describe la relación con los estudiantes.' });
        }
        if (exceptionalResponsible.length < 3 || exceptionalReason.length < 8) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            message: 'La salida excepcional requiere indicar quién la confirmó y el fundamento informado.',
            estudiantes_sin_autorizacion: studentsWithoutAuthorization
          });
        }
      }

      const active = await client.query(
        `SELECT id_alumno
         FROM retiros_alumno
         WHERE id_alumno = ANY($1::int[])
           AND estado IN ('SOLICITADO', 'AUTORIZADO')
         FOR UPDATE`,
        [studentIds]
      );
      if (active.rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          message: 'Uno de los estudiantes ya tiene un retiro pendiente.',
          estudiantes_con_retiro_pendiente: active.rows.map((row) => row.id_alumno)
        });
      }

      const createdIds = [];
      for (const studentId of studentIds) {
        const authorization = authorizationByStudent.get(studentId);
        const declaredRelationshipCode = authorization?.parentesco_codigo || relationshipCode;
        const decisionNote = authorization
          ? `Validación automática mediante ficha vigente: ${authorization.parentesco}.`
          : `Validación excepcional confirmada por ${exceptionalResponsible}: ${exceptionalReason}`;
        const inserted = await client.query(
          `INSERT INTO retiros_alumno
            (id_alumno, visitante_id, autorizacion_id, motivo, motivo_codigo,
             motivo_detalle, parentesco_declarado_codigo,
             parentesco_declarado_detalle, estado, solicitado_por,
             decidido_por, decidido_en, motivo_decision,
             entregado_por, entregado_en)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ENTREGADO', $9,
                   $9, CURRENT_TIMESTAMP, $10, $9, CURRENT_TIMESTAMP)
           RETURNING id`,
          [
            studentId,
            visitor.id,
            authorization?.id || null,
            reasonDetail || reasonConfig.rows[0].nombre,
            reasonCode,
            reasonDetail || null,
            declaredRelationshipCode,
            authorization ? null : relationshipDetail || null,
            req.user.id,
            decisionNote
          ]
        );
        createdIds.push(inserted.rows[0].id);
      }

      await insertarAudit(client, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: 'REGISTRAR_RETIRO_PORTERIA',
        entidad: 'retiro_alumno',
        detalle: {
          retiros: createdIds,
          estudiantes: studentIds,
          visitante_id: visitor.id,
          motivo_codigo: reasonCode,
          mediante_ficha: studentIds.filter((id) => authorizationByStudent.has(id)),
          mediante_excepcion: studentsWithoutAuthorization,
          responsable_excepcional: studentsWithoutAuthorization.length ? exceptionalResponsible : null
        },
        ip: getClientIp(req)
      });
      await client.query('COMMIT');

      const created = await pool.query(
        `${withdrawalSelect} WHERE r.id = ANY($1::bigint[]) ORDER BY r.id`,
        [createdIds]
      );
      res.status(201).json({
        message: createdIds.length === 1
          ? 'Retiro registrado y entregado con trazabilidad.'
          : `${createdIds.length} retiros registrados y entregados con trazabilidad.`,
        rows: created.rows.map(mapWithdrawal)
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[retiros:registrar-salida]', error.message);
      if (error.code === '23505') {
        return res.status(409).json({ message: 'Uno de los estudiantes ya tiene un retiro pendiente.' });
      }
      res.status(error.status || 500).json({
        message: error.status ? error.message : 'No fue posible registrar la salida de los estudiantes.'
      });
    } finally {
      client.release();
    }
  });

  router.patch('/retiros/:id/decision', verifyPermission('withdrawals.approve'), async (req, res) => {
    const id = parsePositiveId(req.params.id);
    const approved = req.body?.aprobar === true;
    const decisionReason = sanitizeText(req.body?.motivo, 500);
    if (!id) return res.status(400).json({ message: 'La solicitud indicada no es válida.' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query('SELECT * FROM retiros_alumno WHERE id = $1 FOR UPDATE', [id]);
      if (!locked.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'La solicitud indicada no existe.' });
      }
      const withdrawal = locked.rows[0];
      if (withdrawal.estado !== 'SOLICITADO') {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'La solicitud ya fue resuelta.' });
      }
      if (!approved && decisionReason.length < 8) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Explica el motivo del rechazo con al menos 8 caracteres.' });
      }
      if (approved && !withdrawal.autorizacion_id && decisionReason.length < 10) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Una autorización excepcional requiere una explicación de al menos 10 caracteres.' });
      }
      const nextState = approved ? 'AUTORIZADO' : 'RECHAZADO';
      await client.query(
        `UPDATE retiros_alumno
         SET estado = $2, decidido_por = $3, decidido_en = CURRENT_TIMESTAMP,
             motivo_decision = $4, actualizado_en = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [id, nextState, req.user.id, decisionReason || null]
      );
      await insertarAudit(client, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: approved ? 'AUTORIZAR_RETIRO_ALUMNO' : 'RECHAZAR_RETIRO_ALUMNO',
        entidad: 'retiro_alumno',
        entidad_id: id,
        detalle: {
          id_alumno: withdrawal.id_alumno,
          autorizacion_previa: Boolean(withdrawal.autorizacion_id),
          motivo_decision: decisionReason || null
        },
        ip: getClientIp(req)
      });
      await client.query('COMMIT');
      const updated = await pool.query(`${withdrawalSelect} WHERE r.id = $1`, [id]);
      res.json(mapWithdrawal(updated.rows[0]));
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[retiros:decision]', error.message);
      res.status(500).json({ message: 'No fue posible resolver la solicitud.' });
    } finally {
      client.release();
    }
  });

  router.patch('/retiros/:id/entregar', verifyPermission('withdrawals.approve'), async (req, res) => {
    const id = parsePositiveId(req.params.id);
    if (!id) return res.status(400).json({ message: 'La solicitud indicada no es válida.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query('SELECT * FROM retiros_alumno WHERE id = $1 FOR UPDATE', [id]);
      if (!locked.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'La solicitud indicada no existe.' });
      }
      if (locked.rows[0].estado !== 'AUTORIZADO') {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'Solo se puede entregar un estudiante con retiro autorizado.' });
      }
      await client.query(
        `UPDATE retiros_alumno
         SET estado = 'ENTREGADO', entregado_por = $2, entregado_en = CURRENT_TIMESTAMP,
             actualizado_en = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [id, req.user.id]
      );
      await insertarAudit(client, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: 'ENTREGAR_ALUMNO',
        entidad: 'retiro_alumno',
        entidad_id: id,
        detalle: { id_alumno: locked.rows[0].id_alumno, visitante_id: locked.rows[0].visitante_id },
        ip: getClientIp(req)
      });
      await client.query('COMMIT');
      const updated = await pool.query(`${withdrawalSelect} WHERE r.id = $1`, [id]);
      res.json(mapWithdrawal(updated.rows[0]));
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[retiros:entregar]', error.message);
      res.status(500).json({ message: 'No fue posible confirmar la entrega.' });
    } finally {
      client.release();
    }
  });

  router.patch('/retiros/:id/cancelar', verifyPermission('withdrawals.register'), async (req, res) => {
    const id = parsePositiveId(req.params.id);
    const reason = validateReason(req.body?.motivo, { min: 8, max: 500 });
    if (!id) return res.status(400).json({ message: 'La solicitud indicada no es válida.' });
    if (reason.error) return res.status(400).json({ message: reason.error });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query('SELECT * FROM retiros_alumno WHERE id = $1 FOR UPDATE', [id]);
      if (!locked.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'La solicitud indicada no existe.' });
      }
      if (!['SOLICITADO', 'AUTORIZADO'].includes(locked.rows[0].estado)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'La solicitud ya no puede cancelarse.' });
      }
      await client.query(
        `UPDATE retiros_alumno
         SET estado = 'CANCELADO', cancelado_por = $2, cancelado_en = CURRENT_TIMESTAMP,
             motivo_cancelacion = $3, actualizado_en = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [id, req.user.id, reason.value]
      );
      await insertarAudit(client, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: 'CANCELAR_RETIRO_ALUMNO',
        entidad: 'retiro_alumno',
        entidad_id: id,
        detalle: { motivo: reason.value, estado_anterior: locked.rows[0].estado },
        ip: getClientIp(req)
      });
      await client.query('COMMIT');
      res.json({ message: 'Solicitud cancelada con trazabilidad.' });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[retiros:cancelar]', error.message);
      res.status(500).json({ message: 'No fue posible cancelar la solicitud.' });
    } finally {
      client.release();
    }
  });
};

module.exports = { registerWithdrawalRoutes };
