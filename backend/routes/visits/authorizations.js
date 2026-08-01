const registerAuthorizationRoutes = (context) => {
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

  router.get('/autorizaciones', verifyAnyPermission(['withdrawals.register', 'withdrawals.approve', 'withdrawals.authorizations']), async (req, res) => {
    const studentId = parsePositiveId(req.query.id_alumno);
    if (!studentId) return res.status(400).json({ message: 'Selecciona un estudiante válido.' });
    try {
      const result = await pool.query(
        `SELECT pa.id, pa.parentesco, pa.parentesco_codigo, pa.parentesco_detalle,
                pa.es_principal, pa.fuente_registro, pa.origen_autorizacion,
                pa.vigente_desde, pa.vigente_hasta, pa.activo,
                p.id AS visitante_id, p.tipo_documento, p.documento_numero,
                p.nombre_completo, p.telefono, p.email
         FROM personas_autorizadas_retiro pa
         JOIN visitantes p ON p.id = pa.visitante_id
         WHERE pa.id_alumno = $1 AND pa.activo = true
         ORDER BY p.nombre_completo`,
        [studentId]
      );
      res.json(result.rows.map((row) => ({
        id: row.id,
        parentesco: row.parentesco,
        parentesco_codigo: row.parentesco_codigo,
        parentesco_detalle: row.parentesco_detalle,
        es_principal: row.es_principal,
        fuente_registro: row.fuente_registro,
        origen_autorizacion: row.origen_autorizacion,
        vigente_desde: row.vigente_desde,
        vigente_hasta: row.vigente_hasta,
        visitante: visitorPayload(row, { revealDocument: true })
      })));
    } catch (error) {
      console.error('[retiros:autorizaciones]', error.message);
      res.status(500).json({ message: 'No fue posible consultar las autorizaciones.' });
    }
  });

  router.post('/autorizaciones', verifyPermission('withdrawals.authorizations'), async (req, res) => {
    const studentId = parsePositiveId(req.body?.id_alumno);
    const relationshipCode = sanitizeText(req.body?.parentesco_codigo, 40).toUpperCase();
    const relationshipDetail = sanitizeText(req.body?.parentesco_detalle, 120);
    const source = sanitizeText(req.body?.origen_autorizacion, 160);
    const from = String(req.body?.vigente_desde || '').trim();
    const to = String(req.body?.vigente_hasta || '').trim();
    if (!studentId) return res.status(400).json({ message: 'Selecciona un estudiante válido.' });
    if (!relationshipCode) return res.status(400).json({ message: 'Selecciona el parentesco o relación.' });
    if (source.length < 5) return res.status(400).json({ message: 'Indica el origen institucional de la autorización.' });
    if (from && !isIsoDate(from)) return res.status(400).json({ message: 'La fecha inicial no es válida.' });
    if (to && !isIsoDate(to)) return res.status(400).json({ message: 'La fecha final no es válida.' });
    if (from && to && from > to) return res.status(400).json({ message: 'La vigencia final no puede ser anterior a la inicial.' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const student = await client.query('SELECT id_alumno FROM alumno WHERE id_alumno = $1 AND activo = true FOR SHARE', [studentId]);
      if (!student.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'El estudiante no está activo en el padrón.' });
      }
      const relationshipConfig = await client.query(
        'SELECT nombre, requiere_detalle FROM tipos_parentesco WHERE codigo = $1 AND activo = true',
        [relationshipCode]
      );
      if (!relationshipConfig.rows.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'La relación seleccionada ya no está disponible.' });
      }
      if (relationshipConfig.rows[0].requiere_detalle && relationshipDetail.length < 3) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Describe la relación con la persona autorizada.' });
      }
      const relationship = relationshipConfig.rows[0].nombre;
      const visitor = await findOrCreateVisitor(client, req.body?.visitante, req.user.id);
      const existing = await client.query(
        `SELECT * FROM personas_autorizadas_retiro
         WHERE id_alumno = $1 AND visitante_id = $2 AND activo = true
         FOR UPDATE`,
        [studentId, visitor.id]
      );
      let authorizationId;
      const isPrimary = req.body?.es_principal === true;
      const responsibility = isPrimary
        ? 'PRINCIPAL'
        : relationshipCode === 'APODERADO_SUPLENTE' ? 'SUPLENTE' : 'AUTORIZADO';
      if (existing.rows.length) {
        authorizationId = existing.rows[0].id;
        await client.query(
          `UPDATE personas_autorizadas_retiro
           SET parentesco = $2, parentesco_codigo = $3, parentesco_detalle = $4,
               origen_autorizacion = $5, es_principal = $6,
               tipo_responsabilidad = $10,
               vigente_desde = COALESCE($7::date, CURRENT_DATE),
               vigente_hasta = $8::date, fuente_registro = 'MANUAL',
               actualizado_por = $9, actualizado_en = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [
            authorizationId,
            relationship,
            relationshipCode,
            relationshipDetail || null,
            source,
            req.body?.es_principal === true,
            from || null,
            to || null,
            req.user.id,
            responsibility
          ]
        );
      } else {
        const inserted = await client.query(
          `INSERT INTO personas_autorizadas_retiro
            (id_alumno, visitante_id, parentesco, parentesco_codigo, parentesco_detalle,
             origen_autorizacion, es_principal, vigente_desde, vigente_hasta,
             tipo_responsabilidad, fuente_registro, creado_por, actualizado_por)
           VALUES ($1, $2, $3, $4, $5, $6, $7,
                   COALESCE($8::date, CURRENT_DATE), $9::date, $11, 'MANUAL', $10, $10)
           RETURNING id`,
          [
            studentId,
            visitor.id,
            relationship,
            relationshipCode,
            relationshipDetail || null,
            source,
            req.body?.es_principal === true,
            from || null,
            to || null,
            req.user.id,
            responsibility
          ]
        );
        authorizationId = inserted.rows[0].id;
      }
      const authorizationAfter = await client.query(
        'SELECT * FROM personas_autorizadas_retiro WHERE id = $1',
        [authorizationId]
      );
      await client.query(`
        INSERT INTO autorizacion_retiro_eventos (
          autorizacion_id, accion, antes, despues, motivo, realizado_por
        ) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6)
      `, [
        authorizationId,
        existing.rows.length ? 'ACTUALIZAR' : 'CREAR',
        existing.rows.length ? JSON.stringify(existing.rows[0]) : null,
        JSON.stringify(authorizationAfter.rows[0]),
        source,
        req.user.id
      ]);
      await insertarAudit(client, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: existing.rows.length ? 'ACTUALIZAR_AUTORIZACION_RETIRO' : 'CREAR_AUTORIZACION_RETIRO',
        entidad: 'autorizacion_retiro',
        entidad_id: authorizationId,
        detalle: {
          id_alumno: studentId,
          visitante_id: visitor.id,
          parentesco_codigo: relationshipCode,
          es_principal: req.body?.es_principal === true,
          origen: source
        },
        ip: getClientIp(req)
      });
      await client.query('COMMIT');
      res.status(existing.rows.length ? 200 : 201).json({ id: authorizationId, message: 'Autorización guardada.' });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[retiros:guardar-autorizacion]', error.message);
      res.status(error.status || 500).json({ message: error.status ? error.message : 'No fue posible guardar la autorización.' });
    } finally {
      client.release();
    }
  });

  router.post('/apoderados/importar', verifyAnyPermission([
    'withdrawals.import_guardians',
    'students.import'
  ]), async (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const fileName = sanitizeText(req.body?.nombre_archivo, 255) || 'planilla-apoderados.xlsx';
    const fileHash = sanitizeText(req.body?.hash_archivo, 128) || null;
    if (!rows.length) return res.status(400).json({ message: 'No se recibieron filas de apoderados.' });
    if (rows.length > 5000) return res.status(400).json({ message: 'La planilla supera el máximo de 5.000 filas por carga.' });

    const summary = {
      total: rows.length,
      created: 0,
      updated: 0,
      errors: []
    };
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const batch = await client.query(
        `INSERT INTO importaciones_apoderados
          (nombre_archivo, hash_archivo, total_filas, importado_por)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [fileName, fileHash, rows.length, req.user.id]
      );
      const batchId = batch.rows[0].id;

      const relationshipRows = await client.query(
        'SELECT codigo, nombre, requiere_detalle FROM tipos_parentesco WHERE activo = true'
      );
      const relationships = new Map(relationshipRows.rows.map((row) => [row.codigo, row]));

      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index] || {};
        const rowNumber = Number(row.fila) || index + 2;
        const savepoint = `guardian_row_${index}`;
        await client.query(`SAVEPOINT ${savepoint}`);

        try {
          const studentRut = normalizeVisitorDocument('RUT', row.alumno_rut);
          if (studentRut.error) throw new Error(`RUT del estudiante inválido: ${studentRut.error}`);

          const student = await client.query(
            `SELECT id_alumno
             FROM alumno
             WHERE rut = $1 AND UPPER(COALESCE(dv, '')) = $2 AND activo = true
             LIMIT 1`,
            [studentRut.value.body, studentRut.value.dv]
          );
          if (!student.rows.length) throw new Error('No se encontró un estudiante activo con ese RUT.');

          const relationshipCode = sanitizeText(row.parentesco_codigo, 40).toUpperCase();
          const relationship = relationships.get(relationshipCode);
          if (!relationship) throw new Error('El parentesco indicado no es válido.');
          const relationshipDetail = sanitizeText(row.parentesco_detalle, 120);
          if (relationship.requiere_detalle && relationshipDetail.length < 3) {
            throw new Error('La relación “Otra” necesita una descripción.');
          }

          const from = sanitizeText(row.vigente_desde, 10);
          const to = sanitizeText(row.vigente_hasta, 10);
          if (from && !isIsoDate(from)) throw new Error('La fecha de inicio no es válida.');
          if (to && !isIsoDate(to)) throw new Error('La fecha de término no es válida.');
          if (from && to && from > to) throw new Error('La fecha final es anterior a la inicial.');

          const visitor = await findOrCreateVisitor(client, {
            tipo_documento: row.tipo_documento || 'RUT',
            documento: row.documento,
            nombre_completo: row.nombre_completo,
            telefono: row.telefono,
            email: row.email
          }, req.user.id);

          const existing = await client.query(
            `SELECT *
             FROM personas_autorizadas_retiro
             WHERE id_alumno = $1 AND visitante_id = $2 AND activo = true
             FOR UPDATE`,
            [student.rows[0].id_alumno, visitor.id]
          );
          const isPrimary = row.es_principal === true
            || ['SI', 'SÍ', 'TRUE', '1', 'PRINCIPAL'].includes(String(row.es_principal || '').trim().toUpperCase());
          const source = `Ficha importada: ${fileName}`.slice(0, 160);
          const responsibility = isPrimary
            ? 'PRINCIPAL'
            : relationship.codigo === 'APODERADO_SUPLENTE' ? 'SUPLENTE' : 'AUTORIZADO';
          let authorizationId;

          if (existing.rows.length) {
            await client.query(
              `UPDATE personas_autorizadas_retiro
               SET parentesco = $2, parentesco_codigo = $3, parentesco_detalle = $4,
                   es_principal = $5, origen_autorizacion = $6,
                   tipo_responsabilidad = $11,
                   vigente_desde = COALESCE($7::date, vigente_desde),
                   vigente_hasta = $8::date, fuente_registro = 'IMPORTACION',
                   importacion_id = $9, actualizado_por = $10,
                   actualizado_en = CURRENT_TIMESTAMP
               WHERE id = $1`,
              [
                existing.rows[0].id,
                relationship.nombre,
                relationship.codigo,
                relationshipDetail || null,
                isPrimary,
                source,
                from || null,
                to || null,
                batchId,
                req.user.id,
                responsibility
              ]
            );
            authorizationId = existing.rows[0].id;
            summary.updated += 1;
          } else {
            const inserted = await client.query(
              `INSERT INTO personas_autorizadas_retiro
                (id_alumno, visitante_id, parentesco, parentesco_codigo, parentesco_detalle,
                 es_principal, origen_autorizacion, vigente_desde, vigente_hasta,
                 tipo_responsabilidad, fuente_registro, importacion_id, creado_por, actualizado_por)
               VALUES ($1, $2, $3, $4, $5, $6, $7,
                       COALESCE($8::date, CURRENT_DATE), $9::date,
                       $12, 'IMPORTACION', $10, $11, $11)
               RETURNING id`,
              [
                student.rows[0].id_alumno,
                visitor.id,
                relationship.nombre,
                relationship.codigo,
                relationshipDetail || null,
                isPrimary,
                source,
                from || null,
                to || null,
                batchId,
                req.user.id,
                responsibility
              ]
            );
            authorizationId = inserted.rows[0].id;
            summary.created += 1;
          }
          const authorizationAfter = await client.query(
            'SELECT * FROM personas_autorizadas_retiro WHERE id = $1',
            [authorizationId]
          );
          await client.query(`
            INSERT INTO autorizacion_retiro_eventos (
              autorizacion_id, accion, antes, despues, motivo, realizado_por
            ) VALUES ($1, 'IMPORTAR', $2::jsonb, $3::jsonb, $4, $5)
          `, [
            authorizationId,
            existing.rows.length ? JSON.stringify(existing.rows[0]) : null,
            JSON.stringify(authorizationAfter.rows[0]),
            source,
            req.user.id
          ]);

          await client.query(`RELEASE SAVEPOINT ${savepoint}`);
        } catch (rowError) {
          await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          await client.query(`RELEASE SAVEPOINT ${savepoint}`);
          summary.errors.push({ row: rowNumber, message: rowError.message });
        }
      }

      await client.query(
        `UPDATE importaciones_apoderados
         SET filas_creadas = $2, filas_actualizadas = $3, filas_con_error = $4
         WHERE id = $1`,
        [batchId, summary.created, summary.updated, summary.errors.length]
      );
      await insertarAudit(client, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: 'IMPORTAR_APODERADOS',
        entidad: 'importacion_apoderados',
        entidad_id: batchId,
        detalle: {
          archivo: fileName,
          total: summary.total,
          creados: summary.created,
          actualizados: summary.updated,
          errores: summary.errors.length
        },
        ip: getClientIp(req)
      });
      await client.query('COMMIT');
      res.json({ ...summary, importacion_id: batchId });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[retiros:importar-apoderados]', error.message);
      res.status(500).json({ message: 'No fue posible importar la ficha de apoderados.' });
    } finally {
      client.release();
    }
  });
};

module.exports = { registerAuthorizationRoutes };
