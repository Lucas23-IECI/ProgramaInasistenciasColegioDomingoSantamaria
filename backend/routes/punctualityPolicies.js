const express = require('express');

const { calculateDelayMinutes, calculateStatusAndSeverity } = require('../utils/punctuality');
const { isIsoDate, validateDateRange } = require('../utils/validation');

const clean = (value, max = 1000) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
const positiveId = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};
const ids = (value, limit = 600) => [...new Set((Array.isArray(value) ? value : [])
  .map(positiveId).filter(Boolean))].slice(0, limit);
const enumValue = (value, allowed, fallback = null) => {
  const normalized = clean(value, 40).toUpperCase();
  return allowed.includes(normalized) ? normalized : fallback;
};
const audit = (insertarAudit, queryable, req, data) => insertarAudit(queryable, {
  usuario_id: req.user.id,
  usuario_correo: req.user.correo,
  ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
  ...data
});

const createPunctualityPoliciesRouter = ({ pool, verifyToken, verifyPermission, verifyAnyPermission, insertarAudit }) => {
  const router = express.Router();
  router.use(verifyToken);

  router.get('/politicas', verifyAnyPermission([
    'punctuality.view', 'punctuality.register', 'punctuality.controls.manage',
    'punctuality.calendar.manage', 'punctuality.shifts.manage', 'punctuality.exceptions.manage',
    'punctuality.contingencies.manage', 'punctuality.commitments.manage', 'punctuality.improvements.view'
  ]), async (req, res) => {
    try {
      const [shifts, calendar, reasons] = await Promise.all([
        pool.query(`SELECT t.*, COUNT(c.id)::int AS controles
          FROM puntualidad_turnos t LEFT JOIN controles_puntualidad c ON c.turno_id=t.id
          GROUP BY t.id ORDER BY t.activo DESC,t.orden,t.nombre`),
        pool.query(`SELECT e.*, COUNT(x.id)::int AS controles_excepcionales
          FROM puntualidad_calendario_excepciones e
          LEFT JOIN puntualidad_controles_excepcionales x ON x.excepcion_id=e.id
          WHERE e.fecha >= CURRENT_DATE - interval '90 days'
          GROUP BY e.id ORDER BY e.fecha DESC,e.id DESC LIMIT 300`),
        pool.query('SELECT * FROM puntualidad_motivos_institucionales ORDER BY activo DESC,orden,nombre')
      ]);
      res.json({ turnos: shifts.rows, calendario: calendar.rows, motivos: reasons.rows });
    } catch (error) {
      console.error('[puntualidad:politicas]', error.message);
      res.status(500).json({ message: 'No fue posible obtener las políticas ampliadas de puntualidad.' });
    }
  });

  router.post('/turnos', verifyPermission('punctuality.shifts.manage'), async (req, res) => {
    const code = clean(req.body?.codigo, 50).toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const name = clean(req.body?.nombre, 100);
    const type = enumValue(req.body?.tipo, ['MANANA', 'TARDE', 'COMPLETA', 'OTRO'], 'OTRO');
    const days = ids(req.body?.dias_semana, 7).filter((day) => day <= 7);
    const courses = ids(req.body?.cursos_ids);
    if (code.length < 2 || name.length < 3 || !/^\d{2}:\d{2}$/.test(req.body?.hora_inicio || '')
        || !/^\d{2}:\d{2}$/.test(req.body?.hora_fin || '') || !days.length) {
      return res.status(400).json({ message: 'Completa el turno, horario y días de aplicación.' });
    }
    try {
      const result = await pool.query(`INSERT INTO puntualidad_turnos
        (codigo,nombre,tipo,hora_inicio,hora_fin,dias_semana,cursos_ids,orden,creado_por,actualizado_por)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING *`,
      [code, name, type, req.body.hora_inicio, req.body.hora_fin, days, courses,
        Number.isInteger(Number(req.body?.orden)) ? Number(req.body.orden) : 0, req.user.id]);
      await audit(insertarAudit, pool, req, { accion: 'CREAR_TURNO_PUNTUALIDAD', entidad: 'puntualidad_turno', entidad_id: result.rows[0].id, detalle: { codigo: code, nombre: name } });
      res.status(201).json(result.rows[0]);
    } catch (error) {
      if (error.code === '23505') return res.status(409).json({ message: 'Ya existe un turno con ese código.' });
      if (error.code === '23514') return res.status(400).json({ message: 'El horario de término debe ser posterior al inicio.' });
      res.status(500).json({ message: 'No fue posible crear el turno.' });
    }
  });

  router.patch('/turnos/:id', verifyPermission('punctuality.shifts.manage'), async (req, res) => {
    const id = positiveId(req.params.id);
    if (!id) return res.status(400).json({ message: 'El turno no es válido.' });
    try {
      const result = await pool.query(`UPDATE puntualidad_turnos SET
        nombre=COALESCE(NULLIF($2,''),nombre), tipo=COALESCE($3,tipo),
        hora_inicio=COALESCE($4::time,hora_inicio), hora_fin=COALESCE($5::time,hora_fin),
        dias_semana=COALESCE($6,dias_semana), cursos_ids=COALESCE($7,cursos_ids),
        activo=COALESCE($8,activo), orden=COALESCE($9,orden), actualizado_por=$10,
        actualizado_en=CURRENT_TIMESTAMP WHERE id=$1 RETURNING *`,
      [id, clean(req.body?.nombre, 100), enumValue(req.body?.tipo, ['MANANA', 'TARDE', 'COMPLETA', 'OTRO']),
        req.body?.hora_inicio || null, req.body?.hora_fin || null,
        Array.isArray(req.body?.dias_semana) ? ids(req.body.dias_semana, 7).filter((day) => day <= 7) : null,
        Array.isArray(req.body?.cursos_ids) ? ids(req.body.cursos_ids) : null,
        typeof req.body?.activo === 'boolean' ? req.body.activo : null,
        Number.isInteger(Number(req.body?.orden)) ? Number(req.body.orden) : null, req.user.id]);
      if (!result.rows.length) return res.status(404).json({ message: 'El turno no existe.' });
      await audit(insertarAudit, pool, req, { accion: 'ACTUALIZAR_TURNO_PUNTUALIDAD', entidad: 'puntualidad_turno', entidad_id: id, detalle: { activo: result.rows[0].activo } });
      res.json(result.rows[0]);
    } catch (error) {
      if (error.code === '23514') return res.status(400).json({ message: 'El horario configurado no es válido.' });
      res.status(500).json({ message: 'No fue posible actualizar el turno.' });
    }
  });

  router.post('/calendario-excepciones', verifyPermission('punctuality.calendar.manage'), async (req, res) => {
    const date = clean(req.body?.fecha, 10);
    const name = clean(req.body?.nombre, 160);
    const type = enumValue(req.body?.tipo, ['SUSPENSION', 'HORARIO_ESPECIAL', 'ACTIVIDAD', 'CONTINGENCIA']);
    const controls = Array.isArray(req.body?.controles) ? req.body.controles.slice(0, 20) : [];
    if (!isIsoDate(date) || name.length < 3 || !type) return res.status(400).json({ message: 'Completa la fecha, el nombre y el tipo de día excepcional.' });
    if (type !== 'SUSPENSION' && req.body?.reemplaza_controles !== false && !controls.length) {
      return res.status(400).json({ message: 'Agrega al menos un control para el horario especial, o indica que no reemplaza los controles normales.' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const event = await client.query(`INSERT INTO puntualidad_calendario_excepciones
        (fecha,nombre,tipo,reemplaza_controles,cursos_ids,turnos_ids,descripcion,creado_por,actualizado_por)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *`,
      [date, name, type, req.body?.reemplaza_controles !== false, ids(req.body?.cursos_ids), ids(req.body?.turnos_ids),
        clean(req.body?.descripcion, 1000) || null, req.user.id]);
      for (const control of controls) {
        const baseId = positiveId(control.control_base_id);
        if (!baseId || !/^\d{2}:\d{2}$/.test(control.hora_apertura || '')
            || !/^\d{2}:\d{2}$/.test(control.hora_referencia || '')
            || !/^\d{2}:\d{2}$/.test(control.hora_inicio_atraso || '')
            || !/^\d{2}:\d{2}$/.test(control.hora_cierre || '')) throw Object.assign(new Error('Control excepcional inválido.'), { status: 400 });
        const base = await client.query('SELECT codigo,nombre,tipo,minutos_atraso_grave,cuenta_alertas FROM controles_puntualidad WHERE id=$1 AND activo=true', [baseId]);
        if (!base.rows.length) throw Object.assign(new Error('El control base no existe.'), { status: 400 });
        await client.query(`INSERT INTO puntualidad_controles_excepcionales
          (excepcion_id,control_base_id,codigo,nombre,tipo,hora_apertura,hora_referencia,
           hora_inicio_atraso,hora_cierre,minutos_atraso_grave,cursos_ids,cuenta_alertas,orden,creado_por)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [event.rows[0].id, baseId, clean(control.codigo, 60) || base.rows[0].codigo,
          clean(control.nombre, 100) || base.rows[0].nombre, base.rows[0].tipo,
          control.hora_apertura, control.hora_referencia, control.hora_inicio_atraso, control.hora_cierre,
          Number(control.minutos_atraso_grave) || base.rows[0].minutos_atraso_grave,
          ids(control.cursos_ids), typeof control.cuenta_alertas === 'boolean' ? control.cuenta_alertas : base.rows[0].cuenta_alertas,
          Number(control.orden) || 0, req.user.id]);
      }
      await audit(insertarAudit, client, req, { accion: 'CREAR_EXCEPCION_CALENDARIO', entidad: 'puntualidad_calendario', entidad_id: event.rows[0].id, detalle: { fecha: date, tipo: type, controles: controls.length } });
      await client.query('COMMIT');
      res.status(201).json(event.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[puntualidad:calendario:crear]', error.message);
      res.status(error.status || 500).json({ message: error.status ? error.message : 'No fue posible crear la excepción de calendario.' });
    } finally { client.release(); }
  });

  router.patch('/calendario-excepciones/:id/desactivar', verifyPermission('punctuality.calendar.manage'), async (req, res) => {
    const id = positiveId(req.params.id);
    const reason = clean(req.body?.motivo, 500);
    if (!id || reason.length < 8) return res.status(400).json({ message: 'Explica por qué se desactivará esta excepción.' });
    try {
      const result = await pool.query(`UPDATE puntualidad_calendario_excepciones SET activo=false,
        version=version+1,actualizado_por=$2,actualizado_en=CURRENT_TIMESTAMP WHERE id=$1 AND activo=true RETURNING *`, [id, req.user.id]);
      if (!result.rows.length) return res.status(404).json({ message: 'La excepción no existe o ya está inactiva.' });
      await audit(insertarAudit, pool, req, { accion: 'DESACTIVAR_EXCEPCION_CALENDARIO', entidad: 'puntualidad_calendario', entidad_id: id, detalle: { motivo: reason } });
      res.json(result.rows[0]);
    } catch (error) { res.status(500).json({ message: 'No fue posible desactivar la excepción.' }); }
  });

  router.get('/excepciones-estudiantes', verifyPermission('punctuality.exceptions.manage'), async (req, res) => {
    const studentId = positiveId(req.query?.id_alumno);
    try {
      const result = await pool.query(`SELECT e.*,m.nombre AS motivo_nombre,m.categoria,m.excluye_alertas,
        concat_ws(' ',a.nombres,a.paterno,a.materno) AS estudiante,c.nombre_curso
        FROM puntualidad_excepciones_estudiante e
        JOIN puntualidad_motivos_institucionales m ON m.codigo=e.motivo_codigo
        JOIN alumno a ON a.id_alumno=e.id_alumno LEFT JOIN matricula_actual ma ON ma.id_alumno=a.id_alumno
        LEFT JOIN curso c ON c.id_curso=ma.id_curso
        WHERE ($1::int IS NULL OR e.id_alumno=$1) ORDER BY e.estado,e.fecha_desde DESC LIMIT 300`, [studentId]);
      res.json(result.rows);
    } catch (error) { res.status(500).json({ message: 'No fue posible listar las excepciones.' }); }
  });

  router.post('/excepciones-estudiantes', verifyPermission('punctuality.exceptions.manage'), async (req, res) => {
    const studentId = positiveId(req.body?.id_alumno);
    const from = clean(req.body?.fecha_desde, 10);
    const to = clean(req.body?.fecha_hasta, 10);
    const reason = clean(req.body?.motivo_codigo, 50).toUpperCase();
    const detail = clean(req.body?.detalle, 1000);
    if (!studentId || !isIsoDate(from) || !isIsoDate(to) || from > to || !reason || detail.length < 8) return res.status(400).json({ message: 'Completa estudiante, vigencia, motivo y detalle.' });
    try {
      const result = await pool.query(`INSERT INTO puntualidad_excepciones_estudiante
        (id_alumno,fecha_desde,fecha_hasta,motivo_codigo,detalle,creado_por)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [studentId, from, to, reason, detail, req.user.id]);
      await audit(insertarAudit, pool, req, { accion: 'CREAR_EXCEPCION_ESTUDIANTE', entidad: 'puntualidad_excepcion_estudiante', entidad_id: result.rows[0].id, detalle: { id_alumno: studentId, fecha_desde: from, fecha_hasta: to, motivo: reason } });
      res.status(201).json(result.rows[0]);
    } catch (error) {
      if (error.code === '23503') return res.status(400).json({ message: 'El estudiante o motivo indicado no existe.' });
      res.status(500).json({ message: 'No fue posible registrar la excepción.' });
    }
  });

  router.patch('/excepciones-estudiantes/:id/revocar', verifyPermission('punctuality.exceptions.manage'), async (req, res) => {
    const id = positiveId(req.params.id);
    const reason = clean(req.body?.motivo, 500);
    if (!id || reason.length < 8) return res.status(400).json({ message: 'Explica por qué se revoca la excepción.' });
    try {
      const result = await pool.query(`UPDATE puntualidad_excepciones_estudiante SET estado='REVOCADA',
        revocado_por=$2,revocado_en=CURRENT_TIMESTAMP,motivo_revocacion=$3 WHERE id=$1 AND estado='VIGENTE' RETURNING *`, [id, req.user.id, reason]);
      if (!result.rows.length) return res.status(409).json({ message: 'La excepción ya no está vigente.' });
      await audit(insertarAudit, pool, req, { accion: 'REVOCAR_EXCEPCION_ESTUDIANTE', entidad: 'puntualidad_excepcion_estudiante', entidad_id: id, detalle: { motivo: reason } });
      res.json(result.rows[0]);
    } catch (error) { res.status(500).json({ message: 'No fue posible revocar la excepción.' }); }
  });

  router.post('/contingencias', verifyPermission('punctuality.contingencies.manage'), async (req, res) => {
    const date = clean(req.body?.fecha, 10);
    const name = clean(req.body?.nombre, 160);
    const reason = clean(req.body?.motivo_codigo, 50).toUpperCase();
    const detail = clean(req.body?.detalle, 1000);
    const controlId = positiveId(req.body?.control_puntualidad_id);
    const students = ids(req.body?.estudiantes_ids);
    const recordedTime = /^\d{2}:\d{2}$/.test(req.body?.hora || '') ? req.body.hora : null;
    if (!isIsoDate(date) || name.length < 3 || !reason || detail.length < 8 || !controlId || !students.length || !recordedTime) {
      return res.status(400).json({ message: 'Completa la contingencia, hora, control y estudiantes afectados.' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const controlResult = await client.query(`SELECT c.*,cfg.nombre_jornada,cfg.version_regla
        FROM controles_puntualidad c JOIN configuracion_asistencia cfg ON cfg.id=c.configuracion_id
        WHERE c.id=$1 AND c.activo=true FOR SHARE`, [controlId]);
      if (!controlResult.rows.length) throw Object.assign(new Error('El control horario no está disponible.'), { status: 400 });
      const control = controlResult.rows[0];
      const contingency = await client.query(`INSERT INTO puntualidad_contingencias
        (fecha,nombre,motivo_codigo,detalle,control_puntualidad_id,creado_por)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [date, name, reason, detail, controlId, req.user.id]);
      const studentRows = await client.query(`SELECT a.id_alumno,m.id_matricula,m.id_curso,c.nombre_curso
        FROM alumno a LEFT JOIN matricula_actual m ON m.id_alumno=a.id_alumno
        LEFT JOIN curso c ON c.id_curso=m.id_curso WHERE a.id_alumno=ANY($1::int[]) AND a.activo=true`, [students]);
      const applied = { hora_entrada: control.hora_referencia, hora_limite_atraso: control.hora_inicio_atraso, minutos_atraso_grave: control.minutos_atraso_grave };
      const classification = calculateStatusAndSeverity('Entrada', recordedTime, applied);
      const delay = calculateDelayMinutes(recordedTime, control.hora_inicio_atraso);
      let created = 0;
      for (const student of studentRows.rows) {
        const inserted = await client.query(`INSERT INTO attendance_registrations
          (id_alumno,fecha,hora,estado,tipo_registro,severidad,origen,registrado_por,
           id_matricula_registro,id_curso_registro,curso_registro,jornada_registro,
           hora_entrada_aplicada,hora_limite_aplicada,minutos_atraso_grave_aplicado,minutos_atraso,
           version_regla,snapshot_migrado,control_puntualidad_id,control_codigo,control_nombre,control_tipo,
           hora_apertura_aplicada,hora_cierre_aplicada,control_version,cuenta_alertas_aplicado,
           motivo_institucional_codigo,contingencia_id)
          VALUES ($1,$2,$3,$4,'Entrada',$5,'manual',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,false,
            $16,$17,$18,$19,$20,$21,$22,false,$23,$24)
          ON CONFLICT (id_alumno,fecha,control_puntualidad_id)
            WHERE anulado=false AND tipo_registro='Entrada' DO NOTHING RETURNING id_registro`,
        [student.id_alumno,date,recordedTime,classification.status,classification.severidad,req.user.id,
          student.id_matricula,student.id_curso,student.nombre_curso || 'Sin curso informado',control.nombre_jornada,
          control.hora_referencia,control.hora_inicio_atraso,control.minutos_atraso_grave,delay,control.version_regla,
          control.id,control.codigo,control.nombre,control.tipo,control.hora_apertura,control.hora_cierre,control.version,
          reason,contingency.rows[0].id]);
        created += inserted.rowCount;
      }
      await audit(insertarAudit, client, req, { accion: 'REGISTRAR_CONTINGENCIA_PUNTUALIDAD', entidad: 'puntualidad_contingencia', entidad_id: contingency.rows[0].id, detalle: { fecha: date, solicitados: students.length, creados: created, omitidos_duplicados: students.length - created } });
      await client.query('COMMIT');
      res.status(201).json({ contingencia: contingency.rows[0], solicitados: students.length, creados: created, omitidos_duplicados: students.length - created });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[puntualidad:contingencias:crear]', error.message);
      res.status(error.status || 500).json({ message: error.status ? error.message : 'No fue posible registrar la contingencia.' });
    } finally { client.release(); }
  });

  router.get('/contingencias', verifyPermission('punctuality.contingencies.manage'), async (req, res) => {
    const state = enumValue(req.query?.estado, ['ABIERTA', 'CERRADA', 'ANULADA']);
    try {
      const result = await pool.query(`SELECT c.*,m.nombre AS motivo_nombre,p.nombre AS control_nombre,
        COUNT(r.id_registro)::int AS registros_generados,u.nombre AS creado_por_nombre
        FROM puntualidad_contingencias c JOIN puntualidad_motivos_institucionales m ON m.codigo=c.motivo_codigo
        LEFT JOIN controles_puntualidad p ON p.id=c.control_puntualidad_id
        LEFT JOIN attendance_registrations r ON r.contingencia_id=c.id AND r.anulado=false
        LEFT JOIN usuarios u ON u.id=c.creado_por WHERE ($1::text IS NULL OR c.estado=$1)
        GROUP BY c.id,m.nombre,p.nombre,u.nombre ORDER BY c.fecha DESC,c.creado_en DESC LIMIT 300`, [state]);
      res.json(result.rows);
    } catch (error) { res.status(500).json({ message: 'No fue posible listar las contingencias.' }); }
  });

  router.patch('/contingencias/:id/cerrar', verifyPermission('punctuality.contingencies.manage'), async (req, res) => {
    const id = positiveId(req.params.id);
    const state = enumValue(req.body?.estado, ['CERRADA', 'ANULADA']);
    const reason = clean(req.body?.motivo, 500);
    if (!id || !state || reason.length < 8) return res.status(400).json({ message: 'Indica el estado y fundamento del cierre.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(`UPDATE puntualidad_contingencias SET estado=$2,cerrado_por=$3,
        cerrado_en=CURRENT_TIMESTAMP,motivo_cierre=$4 WHERE id=$1 AND estado='ABIERTA' RETURNING *`, [id,state,req.user.id,reason]);
      if (!result.rows.length) { await client.query('ROLLBACK'); return res.status(409).json({ message: 'La contingencia ya no está abierta.' }); }
      if (state === 'ANULADA') await client.query('UPDATE attendance_registrations SET anulado=true,anulado_por=$2,anulado_en=CURRENT_TIMESTAMP,motivo_anulacion=$3 WHERE contingencia_id=$1 AND anulado=false', [id,req.user.id,reason]);
      await audit(insertarAudit, client, req, { accion: state === 'ANULADA' ? 'ANULAR_CONTINGENCIA_PUNTUALIDAD' : 'CERRAR_CONTINGENCIA_PUNTUALIDAD', entidad: 'puntualidad_contingencia', entidad_id: id, detalle: { motivo: reason } });
      await client.query('COMMIT');
      res.json(result.rows[0]);
    } catch (error) { await client.query('ROLLBACK').catch(()=>{}); res.status(500).json({ message: 'No fue posible cerrar la contingencia.' }); }
    finally { client.release(); }
  });

  router.post('/motivos-institucionales', verifyPermission('punctuality.exceptions.manage'), async (req, res) => {
    const code = clean(req.body?.codigo, 50).toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const name = clean(req.body?.nombre, 120);
    const category = enumValue(req.body?.categoria, ['TRANSPORTE','CONTINGENCIA','INSTITUCIONAL','FAMILIAR','OTRA']);
    if (code.length < 3 || name.length < 3 || !category) return res.status(400).json({ message: 'Completa código, nombre y categoría del motivo.' });
    try {
      const result = await pool.query(`INSERT INTO puntualidad_motivos_institucionales
        (codigo,nombre,categoria,requiere_detalle,excluye_alertas,orden,creado_por,actualizado_por)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING *`, [code,name,category,req.body?.requiere_detalle!==false,
        req.body?.excluye_alertas===true,Number(req.body?.orden)||0,req.user.id]);
      await audit(insertarAudit, pool, req, { accion: 'CREAR_MOTIVO_PUNTUALIDAD', entidad: 'puntualidad_motivo', entidad_id: code, detalle: { nombre: name, categoria: category } });
      res.status(201).json(result.rows[0]);
    } catch (error) {
      if (error.code === '23505') return res.status(409).json({ message: 'Ya existe un motivo con ese código.' });
      res.status(500).json({ message: 'No fue posible crear el motivo institucional.' });
    }
  });

  router.get('/compromisos', verifyPermission('punctuality.commitments.manage'), async (req, res) => {
    const studentId = positiveId(req.query?.id_alumno);
    try {
      const result = await pool.query(`SELECT c.*,concat_ws(' ',a.nombres,a.paterno,a.materno) AS estudiante,
        u.nombre AS responsable_nombre FROM puntualidad_compromisos c JOIN alumno a ON a.id_alumno=c.id_alumno
        LEFT JOIN usuarios u ON u.id=c.responsable_id WHERE ($1::int IS NULL OR c.id_alumno=$1)
        ORDER BY CASE WHEN c.estado='ACTIVO' THEN 0 ELSE 1 END,c.fecha_revision LIMIT 300`, [studentId]);
      res.json(result.rows);
    } catch (error) { res.status(500).json({ message: 'No fue posible listar los compromisos.' }); }
  });

  router.post('/compromisos', verifyPermission('punctuality.commitments.manage'), async (req, res) => {
    const studentId = positiveId(req.body?.id_alumno);
    const title = clean(req.body?.titulo, 160);
    const description = clean(req.body?.descripcion, 1000);
    const start = clean(req.body?.fecha_inicio, 10);
    const review = clean(req.body?.fecha_revision, 10);
    if (!studentId || title.length < 3 || description.length < 8 || !isIsoDate(start) || !isIsoDate(review) || review < start) return res.status(400).json({ message: 'Completa el estudiante, compromiso y fecha de revisión.' });
    try {
      const result = await pool.query(`INSERT INTO puntualidad_compromisos
        (id_alumno,titulo,descripcion,fecha_inicio,fecha_revision,fecha_fin,meta_atrasos_maxima,responsable_id,creado_por)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [studentId,title,description,start,review,isIsoDate(req.body?.fecha_fin) ? req.body.fecha_fin : null,
        Number.isInteger(Number(req.body?.meta_atrasos_maxima)) ? Number(req.body.meta_atrasos_maxima) : null,
        positiveId(req.body?.responsable_id) || req.user.id, req.user.id]);
      await audit(insertarAudit, pool, req, { accion: 'CREAR_COMPROMISO_PUNTUALIDAD', entidad: 'puntualidad_compromiso', entidad_id: result.rows[0].id, detalle: { id_alumno: studentId, fecha_revision: review } });
      res.status(201).json(result.rows[0]);
    } catch (error) { res.status(500).json({ message: 'No fue posible crear el compromiso.' }); }
  });

  router.patch('/compromisos/:id/cerrar', verifyPermission('punctuality.commitments.manage'), async (req, res) => {
    const id = positiveId(req.params.id);
    const state = enumValue(req.body?.estado, ['CUMPLIDO', 'INCUMPLIDO', 'CERRADO', 'CANCELADO']);
    const resultText = clean(req.body?.resultado, 1000);
    if (!id || !state || resultText.length < 8) return res.status(400).json({ message: 'Indica el resultado y estado final del compromiso.' });
    try {
      const result = await pool.query(`UPDATE puntualidad_compromisos SET estado=$2,resultado=$3,
        cerrado_por=$4,cerrado_en=CURRENT_TIMESTAMP,actualizado_en=CURRENT_TIMESTAMP WHERE id=$1 AND estado='ACTIVO' RETURNING *`,
      [id,state,resultText,req.user.id]);
      if (!result.rows.length) return res.status(409).json({ message: 'El compromiso ya no está activo.' });
      await audit(insertarAudit, pool, req, { accion: 'CERRAR_COMPROMISO_PUNTUALIDAD', entidad: 'puntualidad_compromiso', entidad_id: id, detalle: { estado: state, resultado: resultText } });
      res.json(result.rows[0]);
    } catch (error) { res.status(500).json({ message: 'No fue posible cerrar el compromiso.' }); }
  });

  router.get('/comparacion-periodos', verifyPermission('punctuality.improvements.view'), async (req, res) => {
    const ranges = [req.query?.desde_1, req.query?.hasta_1, req.query?.desde_2, req.query?.hasta_2];
    if (ranges.some((date) => !isIsoDate(date))) return res.status(400).json({ message: 'Completa los dos períodos de comparación.' });
    if (validateDateRange(ranges[0], ranges[1], 366).error || validateDateRange(ranges[2], ranges[3], 366).error) return res.status(400).json({ message: 'Los períodos no son válidos o exceden un año.' });
    const courseId = positiveId(req.query?.curso_id);
    try {
      const result = await pool.query(`WITH metrics AS (
        SELECT r.id_alumno,a.nombres,a.paterno,a.materno,COALESCE(r.id_curso_registro,m.id_curso) AS id_curso,
          SUM(CASE WHEN r.fecha BETWEEN $1 AND $2 AND r.estado='Atrasado' THEN 1 ELSE 0 END)::int AS atrasos_1,
          SUM(CASE WHEN r.fecha BETWEEN $3 AND $4 AND r.estado='Atrasado' THEN 1 ELSE 0 END)::int AS atrasos_2,
          SUM(CASE WHEN r.fecha BETWEEN $1 AND $2 AND r.estado='Atrasado' THEN COALESCE(r.minutos_atraso,0) ELSE 0 END)::int AS minutos_1,
          SUM(CASE WHEN r.fecha BETWEEN $3 AND $4 AND r.estado='Atrasado' THEN COALESCE(r.minutos_atraso,0) ELSE 0 END)::int AS minutos_2
        FROM attendance_registrations r JOIN alumno a ON a.id_alumno=r.id_alumno
        LEFT JOIN matricula_actual m ON m.id_alumno=a.id_alumno
        WHERE r.anulado=false AND r.tipo_registro='Entrada' AND r.fecha BETWEEN LEAST($1::date,$3::date) AND GREATEST($2::date,$4::date)
        GROUP BY r.id_alumno,a.nombres,a.paterno,a.materno,COALESCE(r.id_curso_registro,m.id_curso)
      ) SELECT *, (atrasos_1-atrasos_2) AS reduccion_atrasos,(minutos_1-minutos_2) AS reduccion_minutos,
        CASE WHEN atrasos_2 < atrasos_1 THEN true ELSE false END AS mejoro,
        CASE WHEN atrasos_2 < atrasos_1 THEN 'Registró menos atrasos en el segundo período.'
             WHEN atrasos_2 = atrasos_1 AND minutos_2 < minutos_1 THEN 'Mantuvo la cantidad y redujo los minutos acumulados.'
             WHEN atrasos_2 = atrasos_1 AND minutos_2 = minutos_1 THEN 'No presenta variación entre los períodos.'
             ELSE 'No presenta una mejora según atrasos y minutos registrados.' END AS explicacion
        FROM metrics WHERE ($5::int IS NULL OR id_curso=$5)
        ORDER BY mejoro DESC,reduccion_atrasos DESC,reduccion_minutos DESC,paterno,materno,nombres`,
      [ranges[0],ranges[1],ranges[2],ranges[3],courseId]);
      res.json({ periodos: { primero: { desde: ranges[0], hasta: ranges[1] }, segundo: { desde: ranges[2], hasta: ranges[3] } }, criterio: 'Se reconoce mejora cuando disminuye la cantidad de atrasos; si la cantidad es igual, se informa la reducción de minutos sin asignar un puntaje opaco.', resultados: result.rows });
    } catch (error) {
      console.error('[puntualidad:comparacion]', error.message);
      res.status(500).json({ message: 'No fue posible comparar los períodos.' });
    }
  });

  return router;
};

module.exports = { createPunctualityPoliciesRouter };
