const express = require('express');
const fs = require('fs');
const crypto = require('crypto');

const { calculateDelayMinutes, calculateStatusAndSeverity, normalizeClockTime } = require('../utils/punctuality');
const {
  asBoundedInteger,
  isIsoDate,
  validateDateRange,
  validatePunctualityConfig,
  validatePunctualityControl,
  validatePunctualityControlSet,
  validateReason
} = require('../utils/validation');
const {
  DocumentValidationError,
  createDocument,
  deleteDocumentIfUnreferenced,
  removeStoredFile,
  resolveDocumentPath
} = require('../services/documentService');
const { recordOperationalEvent } = require('../services/operationalEventService');
const { protectStudentRecord } = require('../utils/studentPrivacy');
const {
  canUseRegistrationMethod,
  getRegistrationMethodPermission,
  normalizeRegistrationMethod
} = require('../utils/registrationMethods');

const ACTIVE_ENTRY_FILTER = "r.tipo_registro = 'Entrada' AND r.anulado = false AND r.estado IN ('Presente', 'Atrasado')";

const registrationSnapshot = (row) => ({
  id_registro: row.id_registro,
  id_alumno: row.id_alumno,
  fecha: row.fecha,
  hora: row.hora,
  estado: row.estado,
  severidad: row.severidad,
  justificado: Boolean(row.justificado),
  tipo_justificacion: row.tipo_justificacion || null,
  comentario_justificacion: row.comentario_justificacion || null,
  documento_id: row.documento_id || null,
  anulado: Boolean(row.anulado),
  version: row.version,
  id_curso_registro: row.id_curso_registro || null,
  curso_registro: row.curso_registro || null,
  jornada_registro: row.jornada_registro,
  hora_entrada_aplicada: row.hora_entrada_aplicada,
  hora_limite_aplicada: row.hora_limite_aplicada,
  minutos_atraso_grave_aplicado: row.minutos_atraso_grave_aplicado,
  minutos_atraso: row.minutos_atraso,
  version_regla: row.version_regla,
  control_puntualidad_id: row.control_puntualidad_id,
  control_codigo: row.control_codigo,
  control_nombre: row.control_nombre,
  control_tipo: row.control_tipo,
  control_version: row.control_version
});

const getConfig = async (queryable, { forUpdate = false } = {}) => {
  const result = await queryable.query(`
    SELECT id, nombre_jornada, hora_entrada, hora_limite_atraso, minutos_atraso_grave,
           umbral_alerta, umbral_critico, version_regla, actualizado_por, actualizado_en
    FROM configuracion_asistencia
    LIMIT 1
    ${forUpdate ? 'FOR UPDATE' : ''}
  `);
  return result.rows[0] || null;
};

const controlSelect = `
  SELECT id, configuracion_id, codigo, nombre, tipo,
         TO_CHAR(hora_apertura, 'HH24:MI:SS') AS hora_apertura,
         TO_CHAR(hora_referencia, 'HH24:MI:SS') AS hora_referencia,
         TO_CHAR(hora_inicio_atraso, 'HH24:MI:SS') AS hora_inicio_atraso,
         TO_CHAR(hora_cierre, 'HH24:MI:SS') AS hora_cierre,
         minutos_atraso_grave, dias_semana, cursos_ids, cuenta_alertas,
         activo, orden, version, turno_id,
         (SELECT t.nombre FROM puntualidad_turnos t WHERE t.id = controles_puntualidad.turno_id) AS turno_nombre,
         creado_en, actualizado_en
  FROM controles_puntualidad
`;

const getControls = async (queryable, { activeOnly = false, forUpdate = false } = {}) => {
  const result = await queryable.query(`
    ${controlSelect}
    ${activeOnly ? 'WHERE activo = true' : ''}
    ORDER BY activo DESC, orden, hora_referencia, id
    ${forUpdate ? 'FOR UPDATE' : ''}
  `);
  return result.rows;
};

const controlSnapshot = (control) => ({
  codigo: control.codigo,
  nombre: control.nombre,
  tipo: control.tipo,
  hora_apertura: normalizeClockTime(control.hora_apertura),
  hora_referencia: normalizeClockTime(control.hora_referencia),
  hora_inicio_atraso: normalizeClockTime(control.hora_inicio_atraso),
  hora_cierre: normalizeClockTime(control.hora_cierre),
  minutos_atraso_grave: Number(control.minutos_atraso_grave),
  dias_semana: (control.dias_semana || []).map(Number),
  cursos_ids: (control.cursos_ids || []).map(Number),
  turno_id: control.turno_id ? Number(control.turno_id) : null,
  turno_nombre: control.turno_nombre || null,
  cuenta_alertas: Boolean(control.cuenta_alertas),
  activo: Boolean(control.activo)
});

const slugControlCode = (name) => {
  const slug = String(name || 'control')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 38);
  return `${slug || 'control'}-${crypto.randomUUID().slice(0, 8)}`;
};

const findCurrentControls = async (queryable, { date, time, courseId = null }) => {
  const exception = await queryable.query(`
    SELECT id, tipo, reemplaza_controles
    FROM puntualidad_calendario_excepciones
    WHERE fecha = $1::date AND activo = true
      AND (cardinality(cursos_ids) = 0 OR $2::int = ANY(cursos_ids))
    ORDER BY CASE WHEN cardinality(cursos_ids) > 0 THEN 0 ELSE 1 END, id DESC
    LIMIT 1
  `, [date, courseId]);

  if (exception.rows[0]?.tipo === 'SUSPENSION') return [];

  let exceptionalControls = [];
  if (exception.rows[0]) {
    const exceptional = await queryable.query(`
      SELECT b.id, b.configuracion_id, x.codigo, x.nombre, x.tipo,
             TO_CHAR(x.hora_apertura, 'HH24:MI:SS') AS hora_apertura,
             TO_CHAR(x.hora_referencia, 'HH24:MI:SS') AS hora_referencia,
             TO_CHAR(x.hora_inicio_atraso, 'HH24:MI:SS') AS hora_inicio_atraso,
             TO_CHAR(x.hora_cierre, 'HH24:MI:SS') AS hora_cierre,
             x.minutos_atraso_grave, ARRAY[EXTRACT(ISODOW FROM $2::date)::int]::smallint[] AS dias_semana,
             x.cursos_ids, x.cuenta_alertas, x.activo, x.orden, x.version,
             b.turno_id, t.nombre AS turno_nombre, x.creado_en, x.creado_en AS actualizado_en,
             x.excepcion_id AS calendario_excepcion_id, true AS control_excepcional
      FROM puntualidad_controles_excepcionales x
      JOIN controles_puntualidad b ON b.id = x.control_base_id
      LEFT JOIN puntualidad_turnos t ON t.id = b.turno_id
      WHERE x.excepcion_id = $1 AND x.activo = true
        AND $3::time BETWEEN x.hora_apertura AND x.hora_cierre
        AND (cardinality(x.cursos_ids) = 0 OR $4::int = ANY(x.cursos_ids))
      ORDER BY CASE WHEN cardinality(x.cursos_ids) > 0 THEN 0 ELSE 1 END,
               x.hora_referencia DESC, x.orden, x.id
    `, [exception.rows[0].id, date, time, courseId]);
    exceptionalControls = exceptional.rows;
    if (exception.rows[0].reemplaza_controles) return exceptionalControls;
  }

  const result = await queryable.query(`
    ${controlSelect}
    WHERE activo = true
      AND EXTRACT(ISODOW FROM $1::date)::int = ANY(dias_semana)
      AND $2::time BETWEEN hora_apertura AND hora_cierre
      AND (cardinality(cursos_ids) = 0 OR $3::int = ANY(cursos_ids))
    ORDER BY
      CASE WHEN cardinality(cursos_ids) > 0 THEN 0 ELSE 1 END,
      hora_referencia DESC,
      orden,
      id
  `, [date, time, courseId]);
  return [...exceptionalControls, ...result.rows];
};

const getInstitutionalNow = async (queryable) => {
  const result = await queryable.query(`
    SELECT CURRENT_DATE::text AS fecha, TO_CHAR(LOCALTIME, 'HH24:MI:SS') AS hora
  `);
  return result.rows[0];
};

const parseRegistrationId = (value) => asBoundedInteger(value, 1, 2147483647);

const createPunctualityRouter = ({ pool, verifyToken, verifyPermission, verifyAnyPermission, insertarAudit, getClientIp }) => {
  const router = express.Router();

  router.use(verifyToken);

  router.get('/config', async (req, res) => {
    try {
      const [config, controls] = await Promise.all([getConfig(pool), getControls(pool)]);
      if (!config) return res.status(503).json({ message: 'La jornada institucional no está configurada.' });
      res.json({ ...config, controles: controls });
    } catch (error) {
      console.error('[puntualidad/config]', error.message);
      res.status(500).json({ message: 'No fue posible obtener la configuración de puntualidad.' });
    }
  });

  router.get('/controles/estado', verifyAnyPermission(['punctuality.register', 'punctuality.view']), async (req, res) => {
    try {
      const now = await getInstitutionalNow(pool);
      const controls = await findCurrentControls(pool, {
        date: now.fecha,
        time: now.hora,
        courseId: asBoundedInteger(req.query?.curso_id, 1, 2147483647)
      });
      const upcoming = await pool.query(`
        ${controlSelect}
        WHERE activo = true
          AND EXTRACT(ISODOW FROM $1::date)::int = ANY(dias_semana)
          AND hora_apertura > $2::time
        ORDER BY hora_apertura, orden
        LIMIT 3
      `, [now.fecha, now.hora]);
      res.json({
        fecha: now.fecha,
        hora: now.hora,
        actual: controls[0] || null,
        actuales: controls,
        proximos: upcoming.rows,
        puede_cambiar: req.user.permissions.includes('punctuality.controls.override')
      });
    } catch (error) {
      console.error('[puntualidad/controles/estado]', error.message);
      res.status(500).json({ message: 'No fue posible determinar el control horario actual.' });
    }
  });

  router.put('/config', verifyAnyPermission(['settings.manage', 'punctuality.controls.manage']), async (req, res) => {
    const validation = validatePunctualityConfig(req.body);
    if (validation.error) return res.status(400).json({ message: validation.error });
    const controlsInput = req.body?.controles;
    if (controlsInput !== undefined && (!Array.isArray(controlsInput) || controlsInput.length < 1 || controlsInput.length > 30)) {
      return res.status(400).json({ message: 'La jornada debe contener entre 1 y 30 controles horarios.' });
    }
    const validatedControls = [];
    for (const control of controlsInput || []) {
      const checked = validatePunctualityControl(control);
      if (checked.error) return res.status(400).json({ message: checked.error });
      validatedControls.push(checked.value);
    }
    const controlsValidation = validatePunctualityControlSet(validatedControls);
    if (controlsValidation.error) return res.status(400).json({ message: controlsValidation.error });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const before = await getConfig(client, { forUpdate: true });
      const controlsBefore = await getControls(client, { forUpdate: true });
      if (!before) {
        await client.query('ROLLBACK');
        return res.status(503).json({ message: 'La jornada institucional no está inicializada.' });
      }

      const value = validation.value;
      const updated = await client.query(`
        UPDATE configuracion_asistencia
        SET nombre_jornada = $1,
            hora_entrada = $2,
            hora_limite_atraso = $3,
            minutos_atraso_grave = $4,
            umbral_alerta = $5,
            umbral_critico = $6,
            actualizado_por = $7,
            actualizado_en = CURRENT_TIMESTAMP,
            version_regla = version_regla + 1
        WHERE id = $8
        RETURNING id, nombre_jornada, hora_entrada, hora_limite_atraso, minutos_atraso_grave,
                  umbral_alerta, umbral_critico, version_regla, actualizado_por, actualizado_en
      `, [
        value.nombre_jornada,
        value.hora_entrada,
        value.hora_limite_atraso,
        value.minutos_atraso_grave,
        value.umbral_alerta,
        value.umbral_critico,
        req.user.id,
        before.id
      ]);
      const nextConfig = updated.rows[0];

      if (controlsInput !== undefined) {
        const requestedIds = new Set(validatedControls.filter((control) => control.id).map((control) => control.id));
        const knownIds = new Set(controlsBefore.map((control) => Number(control.id)));
        if ([...requestedIds].some((id) => !knownIds.has(id))) {
          await client.query('ROLLBACK');
          return res.status(400).json({ message: 'Uno de los controles horarios no pertenece a esta jornada.' });
        }

        const courseIds = [...new Set(validatedControls.flatMap((control) => control.cursos_ids))];
        if (courseIds.length > 0) {
          const courses = await client.query('SELECT id_curso FROM curso WHERE id_curso = ANY($1::int[])', [courseIds]);
          if (courses.rows.length !== courseIds.length) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Uno de los cursos seleccionados ya no existe.' });
          }
        }

        const shiftIds = [...new Set(validatedControls.map((control) => control.turno_id).filter(Boolean))];
        if (shiftIds.length > 0) {
          const shifts = await client.query('SELECT id FROM puntualidad_turnos WHERE id = ANY($1::bigint[]) AND activo = true', [shiftIds]);
          if (shifts.rows.length !== shiftIds.length) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Uno de los turnos seleccionados ya no está disponible.' });
          }
        }

        for (const control of validatedControls) {
          let saved;
          if (control.id) {
            const result = await client.query(`
              UPDATE controles_puntualidad
              SET nombre = $1, tipo = $2, hora_apertura = $3, hora_referencia = $4,
                  hora_inicio_atraso = $5, hora_cierre = $6, minutos_atraso_grave = $7,
                  dias_semana = $8::smallint[], cursos_ids = $9::int[],
                  turno_id = $10, cuenta_alertas = $11, activo = $12, orden = $13,
                  version = version + 1, actualizado_por = $14, actualizado_en = CURRENT_TIMESTAMP
              WHERE id = $15
              RETURNING *
            `, [
              control.nombre, control.tipo, control.hora_apertura, control.hora_referencia,
              control.hora_inicio_atraso, control.hora_cierre, control.minutos_atraso_grave,
              control.dias_semana, control.cursos_ids, control.turno_id, control.cuenta_alertas, control.activo,
              control.orden, req.user.id, control.id
            ]);
            saved = result.rows[0];
          } else {
            const result = await client.query(`
              INSERT INTO controles_puntualidad
                (configuracion_id, codigo, nombre, tipo, hora_apertura, hora_referencia,
                 hora_inicio_atraso, hora_cierre, minutos_atraso_grave, dias_semana,
                 cursos_ids, turno_id, cuenta_alertas, activo, orden, creado_por, actualizado_por)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::smallint[],
                      $11::int[], $12, $13, $14, $15, $16, $16)
              RETURNING *
            `, [
              before.id, slugControlCode(control.nombre), control.nombre, control.tipo,
              control.hora_apertura, control.hora_referencia, control.hora_inicio_atraso,
              control.hora_cierre, control.minutos_atraso_grave, control.dias_semana,
              control.cursos_ids, control.turno_id, control.cuenta_alertas, control.activo, control.orden,
              req.user.id
            ]);
            saved = result.rows[0];
          }
          await client.query(`
            INSERT INTO controles_puntualidad_versiones
              (control_id, version, snapshot, motivo, creado_por)
            VALUES ($1, $2, $3::jsonb, $4, $5)
          `, [
            saved.id,
            saved.version,
            JSON.stringify(controlSnapshot(saved)),
            String(req.body?.motivo_cambio || 'Actualización de controles horarios').trim().slice(0, 500),
            req.user.id
          ]);
        }

        const omitted = controlsBefore.filter((control) => !requestedIds.has(Number(control.id)) && control.activo);
        for (const control of omitted) {
          const result = await client.query(`
            UPDATE controles_puntualidad
            SET activo = false, version = version + 1, actualizado_por = $1, actualizado_en = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING *
          `, [req.user.id, control.id]);
          const saved = result.rows[0];
          await client.query(`
            INSERT INTO controles_puntualidad_versiones
              (control_id, version, snapshot, motivo, creado_por)
            VALUES ($1, $2, $3::jsonb, $4, $5)
          `, [
            saved.id,
            saved.version,
            JSON.stringify(controlSnapshot(saved)),
            'Control desactivado desde la configuración',
            req.user.id
          ]);
        }
      }

      await client.query(`
        INSERT INTO configuracion_puntualidad_versiones (
          version_regla, configuracion_id, nombre_jornada, hora_entrada,
          hora_limite_atraso, minutos_atraso_grave, umbral_alerta, umbral_critico,
          creado_por, motivo
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [
        nextConfig.version_regla,
        nextConfig.id,
        nextConfig.nombre_jornada,
        nextConfig.hora_entrada,
        nextConfig.hora_limite_atraso,
        nextConfig.minutos_atraso_grave,
        nextConfig.umbral_alerta,
        nextConfig.umbral_critico,
        req.user.id,
        String(req.body?.motivo_cambio || 'Actualización de la configuración institucional').trim().slice(0, 500)
      ]);

      await insertarAudit(client, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: 'ACTUALIZAR_CONFIG_PUNTUALIDAD',
        entidad: 'configuracion_puntualidad',
        entidad_id: before.id,
        detalle: {
          antes: { configuracion: before, controles: controlsBefore.map(controlSnapshot) },
          despues: {
            configuracion: updated.rows[0],
            controles: (await getControls(client)).map(controlSnapshot)
          }
        },
        ip: getClientIp(req)
      });
      await client.query('COMMIT');
      res.json({
        message: 'Configuración y controles horarios actualizados.',
        config: { ...updated.rows[0], controles: await getControls(client) }
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[puntualidad/config:update]', error.message);
      res.status(500).json({ message: 'No fue posible actualizar la configuración.' });
    } finally {
      client.release();
    }
  });

  router.get('/offline-roster', verifyPermission('punctuality.register'), async (_req, res) => {
    try {
      const result = await pool.query(`
        SELECT a.id_alumno, a.nombres, a.paterno, a.materno,
               COALESCE(c.nombre_curso, 'Sin curso') AS curso,
               ARRAY_REMOVE(ARRAY_AGG(DISTINCT ai.valor_original), NULL) ||
                 ARRAY_REMOVE(ARRAY[a.codigo_barra, a.nombres, a.paterno, a.materno,
                   concat_ws(' ', a.nombres, a.paterno, a.materno)], NULL) AS search_tokens
        FROM alumno a
        LEFT JOIN matricula_actual m ON m.id_alumno = a.id_alumno
        LEFT JOIN curso c ON c.id_curso = m.id_curso
        LEFT JOIN alumno_identificador ai ON ai.id_alumno = a.id_alumno AND ai.estado <> 'REVOCADO'
        WHERE a.activo = true AND a.rol = 'Estudiante'
        GROUP BY a.id_alumno, c.nombre_curso
        ORDER BY a.paterno, a.materno, a.nombres
      `);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ generado_en: new Date().toISOString(), estudiantes: result.rows });
    } catch (error) {
      console.error('[puntualidad/offline-roster]', error.message);
      res.status(500).json({ message: 'No fue posible preparar el padrón operativo sin conexión.' });
    }
  });

  router.post('/registros', verifyPermission('punctuality.register'), async (req, res) => {
    const studentId = asBoundedInteger(req.body?.id_alumno, 1, 2147483647);
    if (!studentId) return res.status(400).json({ message: 'El identificador del alumno no es válido.' });

    const registrationMethod = normalizeRegistrationMethod(req.body?.metodo_registro, req.body?.origen);
    if (!canUseRegistrationMethod(req.user, registrationMethod)) {
      return res.status(403).json({
        code: 'METODO_REGISTRO_NO_AUTORIZADO',
        message: 'Tu cuenta no tiene habilitado este método de registro.',
        permiso_requerido: getRegistrationMethodPermission(registrationMethod)
      });
    }

    const offlineOperationId = String(req.body?.offline_operation_id || '').trim();
    const isOfflineReplay = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(offlineOperationId);
    if (offlineOperationId && !isOfflineReplay) return res.status(400).json({ message: 'El identificador de sincronización no es válido.' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (isOfflineReplay) {
        const previous = await client.query('SELECT * FROM attendance_registrations WHERE offline_operation_id = $1 LIMIT 1', [offlineOperationId]);
        if (previous.rows[0]) {
          await client.query('ROLLBACK');
          return res.status(200).json({ ...previous.rows[0], sincronizacion_repetida: true });
        }
      }
      const studentResult = await client.query(
        `SELECT a.id_alumno, a.nombres, a.paterno, a.materno, a.activo,
                m.id_matricula, m.id_curso, c.nombre_curso
         FROM alumno a
         LEFT JOIN matricula_actual m ON m.id_alumno = a.id_alumno
         LEFT JOIN curso c ON c.id_curso = m.id_curso
         WHERE a.id_alumno = $1
         FOR SHARE OF a`,
        [studentId]
      );
      if (studentResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Alumno no encontrado.' });
      }
      if (!studentResult.rows[0].activo) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'El alumno se encuentra inactivo.' });
      }

      const config = await getConfig(client);
      let now = await getInstitutionalNow(client);
      if (isOfflineReplay && req.body?.capturado_en) {
        const captured = await client.query(`
          SELECT ($1::timestamptz AT TIME ZONE 'America/Santiago')::date AS fecha,
                 ($1::timestamptz AT TIME ZONE 'America/Santiago')::time AS hora,
                 $1::timestamptz BETWEEN CURRENT_TIMESTAMP - interval '24 hours' AND CURRENT_TIMESTAMP + interval '5 minutes' AS valido
        `, [req.body.capturado_en]);
        if (!captured.rows[0]?.valido) {
          await client.query('ROLLBACK');
          return res.status(409).json({ message: 'El registro pendiente excedió la ventana segura de sincronización de 24 horas.' });
        }
        now = { fecha: captured.rows[0].fecha, hora: captured.rows[0].hora };
      }
      const origen = registrationMethod === 'manual' ? 'manual' : 'lector';
      const student = studentResult.rows[0];
      const currentControls = await findCurrentControls(client, {
        date: now.fecha,
        time: now.hora,
        courseId: student.id_curso || null
      });
      const automaticControl = currentControls[0] || null;
      const requestedControlId = asBoundedInteger(req.body?.control_id, 1, 2147483647);
      let control = automaticControl;
      let overrideReason = null;

      if (requestedControlId && Number(automaticControl?.id) !== requestedControlId) {
        if (!req.user.permissions.includes('punctuality.controls.override')) {
          await client.query('ROLLBACK');
          return res.status(403).json({ message: 'Tu cuenta no puede cambiar el control horario sugerido.' });
        }
        const reasonValidation = validateReason(req.body?.motivo_override, { min: 8, max: 500 });
        if (reasonValidation.error) {
          await client.query('ROLLBACK');
          return res.status(400).json({ message: 'Explica por qué se utilizará un control distinto al sugerido.' });
        }
        const requested = await client.query(`
          ${controlSelect}
          WHERE id = $1
            AND activo = true
            AND EXTRACT(ISODOW FROM $2::date)::int = ANY(dias_semana)
            AND (cardinality(cursos_ids) = 0 OR $3::int = ANY(cursos_ids))
          LIMIT 1
        `, [requestedControlId, now.fecha, student.id_curso || null]);
        control = requested.rows[0] || null;
        overrideReason = reasonValidation.value;
      } else if (requestedControlId && automaticControl) {
        control = automaticControl;
      }

      if (!control) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          code: 'SIN_CONTROL_HORARIO',
          message: 'No hay un control de puntualidad activo para este curso y horario.'
        });
      }

      const appliedConfig = {
        hora_entrada: control.hora_referencia,
        hora_limite_atraso: control.hora_inicio_atraso,
        minutos_atraso_grave: control.minutos_atraso_grave
      };
      const { status, severidad } = calculateStatusAndSeverity('Entrada', now.hora, appliedConfig);
      const delayMinutes = calculateDelayMinutes(now.hora, control.hora_inicio_atraso);
      const institutionalException = await client.query(`
        SELECT e.id, e.motivo_codigo, m.nombre, m.excluye_alertas
        FROM puntualidad_excepciones_estudiante e
        JOIN puntualidad_motivos_institucionales m ON m.codigo = e.motivo_codigo
        WHERE e.id_alumno = $1 AND e.estado = 'VIGENTE'
          AND $2::date BETWEEN e.fecha_desde AND e.fecha_hasta
        ORDER BY e.creado_en DESC LIMIT 1
      `, [studentId, now.fecha]);
      const appliedException = institutionalException.rows[0] || null;
      const effectiveCountsAlerts = appliedException?.excluye_alertas === true ? false : control.cuenta_alertas;

      const inserted = await client.query(`
        INSERT INTO attendance_registrations
          (id_alumno, fecha, hora, estado, tipo_registro, severidad, origen, registrado_por, creado_en,
           id_matricula_registro, id_curso_registro, curso_registro, jornada_registro,
           hora_entrada_aplicada, hora_limite_aplicada, minutos_atraso_grave_aplicado,
           minutos_atraso, version_regla, snapshot_migrado,
           control_puntualidad_id, control_codigo, control_nombre, control_tipo,
           hora_apertura_aplicada, hora_cierre_aplicada, control_version, cuenta_alertas_aplicado,
           offline_operation_id, registrado_dispositivo, registrado_sin_conexion,
           turno_id_aplicado, turno_nombre_aplicado, calendario_excepcion_id,
           motivo_institucional_codigo, excepcion_estudiante_id)
        VALUES ($1, $2, $3, $4, 'Entrada', $5, $6, $7, CURRENT_TIMESTAMP,
                $8, $9, $10, $11, $12, $13, $14, $15, $16, false,
                $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27,
                $28, $29, $30, $31, $32)
        ON CONFLICT (id_alumno, fecha, control_puntualidad_id)
          WHERE anulado = false AND tipo_registro = 'Entrada'
        DO NOTHING
        RETURNING *
      `, [
        studentId,
        now.fecha,
        now.hora,
        status,
        severidad,
        origen,
        req.user.id,
        student.id_matricula || null,
        student.id_curso || null,
        student.nombre_curso || 'Sin curso informado',
        config?.nombre_jornada || 'Jornada principal',
        control.hora_referencia,
        control.hora_inicio_atraso,
        control.minutos_atraso_grave,
        delayMinutes,
        config?.version_regla || 1,
        control.id,
        control.codigo,
        control.nombre,
        control.tipo,
        control.hora_apertura,
        control.hora_cierre,
        control.version,
        effectiveCountsAlerts,
        isOfflineReplay ? offlineOperationId : null,
        isOfflineReplay ? String(req.body?.dispositivo || '').trim().slice(0, 120) || null : null,
        isOfflineReplay,
        control.turno_id || null,
        control.turno_nombre || null,
        control.calendario_excepcion_id || null,
        appliedException?.motivo_codigo || null,
        appliedException?.id || null
      ]);

      if (inserted.rows.length === 0) {
        await client.query('ROLLBACK');
        await recordOperationalEvent(pool, {
          type: 'INGRESO_DUPLICADO',
          entity: 'alumno',
          entityId: studentId,
          detail: { fecha: now.fecha, origen, metodo_registro: registrationMethod, control_id: control.id, control_nombre: control.nombre },
          userId: req.user.id
        });
        return res.status(409).json({
          code: 'REGISTRO_DUPLICADO',
          message: `Esta persona ya fue registrada en “${control.nombre}”.`
        });
      }

      const registration = inserted.rows[0];
      await insertarAudit(client, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: 'REGISTRAR_INGRESO',
        entidad: 'registro_puntualidad',
        entidad_id: registration.id_registro,
        detalle: {
          id_alumno: studentId,
          fecha: now.fecha,
          hora: now.hora,
          estado: status,
          severidad,
          origen,
          metodo_registro: registrationMethod,
          curso: student.nombre_curso || null,
          jornada: config?.nombre_jornada || 'Jornada principal',
          control_id: control.id,
          control_nombre: control.nombre,
          control_tipo: control.tipo,
          control_version: control.version,
          seleccion_manual: Boolean(overrideReason),
          motivo_override: overrideReason,
          hora_limite_aplicada: control.hora_inicio_atraso,
          minutos_atraso: delayMinutes,
          version_regla: config?.version_regla || 1
          ,sin_conexion: isOfflineReplay,
          turno: control.turno_nombre || null,
          calendario_excepcion_id: control.calendario_excepcion_id || null,
          motivo_institucional: appliedException?.motivo_codigo || null,
          excluido_alertas: Boolean(appliedException?.excluye_alertas)
        },
        ip: getClientIp(req)
      });
      await client.query('COMMIT');

      res.status(201).json({
        ...registration,
        metodo_registro: registrationMethod,
        minutos_atraso: delayMinutes
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[puntualidad/registros:create]', error.message);
      if (error.code === '23505') {
        return res.status(409).json({
          code: 'REGISTRO_DUPLICADO',
          message: 'La persona ya fue registrada en este control horario.'
        });
      }
      res.status(500).json({ message: 'No fue posible registrar el ingreso.' });
    } finally {
      client.release();
    }
  });

  router.get('/hoy', verifyAnyPermission(['punctuality.register', 'punctuality.view']), async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT r.id_registro, r.fecha, r.hora, r.estado, r.severidad, r.justificado,
               r.tipo_justificacion, r.comentario_justificacion, r.documento_id,
               d.nombre_original AS documento_nombre, d.mime_type AS documento_mime_type,
               r.origen, r.registrado_por, r.creado_en,
               r.version, r.corregido_en, r.motivo_correccion,
               a.id_alumno, a.nombres, a.paterno, a.materno, a.rut, a.dv,
               a.documento_erp, a.uuid_erp,
               COALESCE(r.id_curso_registro, c.id_curso) AS id_curso,
                COALESCE(r.curso_registro, c.nombre_curso, 'Sin curso informado') AS curso,
                r.jornada_registro, r.hora_limite_aplicada, r.minutos_atraso,
                r.version_regla, r.snapshot_migrado, r.control_puntualidad_id,
                r.control_codigo, r.control_nombre, r.control_tipo, r.control_version,
                u.nombre AS registrado_por_nombre
        FROM attendance_registrations r
        JOIN alumno a ON a.id_alumno = r.id_alumno
        LEFT JOIN matricula_actual m ON m.id_alumno = a.id_alumno
        LEFT JOIN curso c ON c.id_curso = m.id_curso
        LEFT JOIN usuarios u ON u.id = r.registrado_por
        LEFT JOIN justification_documents d ON d.id_documento = r.documento_id
        WHERE r.fecha = CURRENT_DATE AND ${ACTIVE_ENTRY_FILTER}
        ORDER BY r.hora DESC, r.id_registro DESC
      `);
      res.json(result.rows.map((row) => protectStudentRecord(row)));
    } catch (error) {
      console.error('[puntualidad/hoy]', error.message);
      res.status(500).json({ message: 'No fue posible obtener los ingresos del día.' });
    }
  });

  router.get('/registros', verifyAnyPermission(['punctuality.register', 'punctuality.view']), async (req, res) => {
    const {
      desde,
      hasta,
      q: rawQuery = '',
      curso_id: rawCourseId = '',
      estado: rawStatus = '',
      severidad: rawSeverity = '',
      justificado: rawJustified = '',
      control_id: rawControlId = '',
      pagina: rawPage = '1',
      limite: rawLimit = '12'
    } = req.query;
    const range = validateDateRange(desde, hasta);
    if (range.error) return res.status(400).json({ message: range.error });

    const query = String(rawQuery || '').trim();
    if (query.length > 120) return res.status(400).json({ message: 'La búsqueda no puede superar 120 caracteres.' });
    if (rawStatus && !['Presente', 'Atrasado', 'justificado'].includes(rawStatus)) {
      return res.status(400).json({ message: 'El estado seleccionado no es válido.' });
    }
    if (rawSeverity && !['Leve', 'Grave'].includes(rawSeverity)) {
      return res.status(400).json({ message: 'La severidad seleccionada no es válida.' });
    }
    if (rawJustified && !['true', 'false'].includes(String(rawJustified))) {
      return res.status(400).json({ message: 'El filtro de justificación no es válido.' });
    }

    const withoutCourse = rawCourseId === 'sin_curso';
    const courseId = rawCourseId === '' || withoutCourse ? null : asBoundedInteger(rawCourseId, 1, 2147483647);
    if (rawCourseId !== '' && !withoutCourse && !courseId) {
      return res.status(400).json({ message: 'El curso seleccionado no es válido.' });
    }
    const controlId = rawControlId === '' ? null : asBoundedInteger(rawControlId, 1, 2147483647);
    if (rawControlId !== '' && !controlId) return res.status(400).json({ message: 'El control horario no es válido.' });
    const requestedPage = asBoundedInteger(rawPage, 1, 1000000);
    const limit = asBoundedInteger(rawLimit, 1, 100);
    if (!requestedPage || !limit) return res.status(400).json({ message: 'La paginación solicitada no es válida.' });

    const conditions = ['r.fecha BETWEEN $1 AND $2', ACTIVE_ENTRY_FILTER];
    const params = [desde, hasta];
    let index = 3;
    if (withoutCourse) {
      conditions.push('COALESCE(r.id_curso_registro, m.id_curso) IS NULL');
    } else if (courseId) {
      conditions.push(`COALESCE(r.id_curso_registro, m.id_curso) = $${index++}`);
      params.push(courseId);
    }
    if (rawStatus === 'justificado') {
      conditions.push("r.estado = 'Atrasado' AND r.justificado = true");
    } else if (rawStatus) {
      conditions.push(`r.estado = $${index++}`);
      params.push(rawStatus);
    }
    if (rawSeverity) {
      conditions.push(`r.estado = 'Atrasado' AND r.severidad = $${index++}`);
      params.push(rawSeverity);
    }
    if (rawJustified) {
      conditions.push(`r.estado = 'Atrasado' AND r.justificado = $${index++}`);
      params.push(String(rawJustified) === 'true');
    }
    if (controlId) {
      conditions.push(`r.control_puntualidad_id = $${index++}`);
      params.push(controlId);
    }
    if (query) {
      conditions.push(`(
        CONCAT_WS(' ', a.nombres, a.paterno, a.materno) ILIKE $${index}
        OR COALESCE(r.curso_registro, c.nombre_curso, '') ILIKE $${index}
        OR CONCAT_WS('-', a.rut::text, a.dv) ILIKE $${index}
        OR REGEXP_REPLACE(COALESCE(a.documento_erp, ''), '[^0-9A-Za-z]', '', 'g') ILIKE $${index + 1}
        OR COALESCE(a.uuid_erp::text, '') ILIKE $${index}
      )`);
      params.push(`%${query}%`, `%${query.replace(/[^0-9A-Za-z]/g, '')}%`);
      index += 2;
    }

    const where = conditions.join(' AND ');
    try {
      const countResult = await pool.query(`
        SELECT COUNT(*)::int AS total
        FROM attendance_registrations r
        JOIN alumno a ON a.id_alumno = r.id_alumno
        LEFT JOIN matricula_actual m ON m.id_alumno = a.id_alumno
        LEFT JOIN curso c ON c.id_curso = COALESCE(r.id_curso_registro, m.id_curso)
        WHERE ${where}
      `, params);
      const total = countResult.rows[0]?.total || 0;
      const pages = Math.max(1, Math.ceil(total / limit));
      const page = Math.min(requestedPage, pages);
      const queryParams = [...params, limit, (page - 1) * limit];
      const result = await pool.query(`
        SELECT r.id_registro, r.fecha::text AS fecha, TO_CHAR(r.hora, 'HH24:MI:SS') AS hora,
               r.estado, r.severidad, r.justificado, r.tipo_justificacion,
               r.comentario_justificacion, r.documento_id,
               d.nombre_original AS documento_nombre, d.mime_type AS documento_mime_type,
               r.origen, r.registrado_por, r.creado_en, r.version, r.corregido_en,
               r.motivo_correccion, a.id_alumno, a.nombres, a.paterno, a.materno,
               a.rut, a.dv, a.documento_erp, a.uuid_erp,
               COALESCE(r.id_curso_registro, m.id_curso) AS id_curso,
               COALESCE(r.curso_registro, c.nombre_curso, 'Sin curso informado') AS curso,
               r.jornada_registro, r.hora_limite_aplicada, r.minutos_atraso,
               r.version_regla, r.snapshot_migrado, r.control_puntualidad_id,
               r.control_codigo, r.control_nombre, r.control_tipo, r.control_version,
               u.nombre AS registrado_por_nombre
        FROM attendance_registrations r
        JOIN alumno a ON a.id_alumno = r.id_alumno
        LEFT JOIN matricula_actual m ON m.id_alumno = a.id_alumno
        LEFT JOIN curso c ON c.id_curso = COALESCE(r.id_curso_registro, m.id_curso)
        LEFT JOIN usuarios u ON u.id = r.registrado_por
        LEFT JOIN justification_documents d ON d.id_documento = r.documento_id
        WHERE ${where}
        ORDER BY r.fecha DESC, r.hora DESC, r.id_registro DESC
        LIMIT $${index} OFFSET $${index + 1}
      `, queryParams);
      res.json({
        periodo: range,
        pagina: page,
        limite: limit,
        total,
        paginas: pages,
        registros: result.rows.map((row) => protectStudentRecord(row))
      });
    } catch (error) {
      console.error('[puntualidad/registros:list]', error.message);
      res.status(500).json({ message: 'No fue posible obtener el detalle de ingresos.' });
    }
  });

  router.get('/justificaciones-pendientes', verifyPermission('punctuality.justify'), async (req, res) => {
    const {
      desde,
      hasta,
      q: rawQuery = '',
      curso_id: rawCourseId = '',
      pagina: rawPage = '1',
      limite: rawLimit = '12'
    } = req.query;
    const range = validateDateRange(desde, hasta);
    if (range.error) return res.status(400).json({ message: range.error });

    const query = String(rawQuery || '').trim();
    if (query.length > 120) {
      return res.status(400).json({ message: 'La búsqueda no puede superar 120 caracteres.' });
    }
    const courseId = rawCourseId === '' ? null : asBoundedInteger(rawCourseId, 1, 2147483647);
    if (rawCourseId !== '' && !courseId) {
      return res.status(400).json({ message: 'El curso seleccionado no es válido.' });
    }
    const requestedPage = asBoundedInteger(rawPage, 1, 1000000);
    const limit = asBoundedInteger(rawLimit, 1, 100);
    if (!requestedPage || !limit) {
      return res.status(400).json({ message: 'La paginación solicitada no es válida.' });
    }

    const conditions = [
      'r.fecha BETWEEN $1 AND $2',
      "r.tipo_registro = 'Entrada'",
      "r.estado = 'Atrasado'",
      'r.anulado = false',
      'r.justificado = false'
    ];
    const params = [desde, hasta];
    let index = 3;

    if (courseId) {
      conditions.push(`COALESCE(r.id_curso_registro, m.id_curso) = $${index++}`);
      params.push(courseId);
    }
    if (query) {
      conditions.push(`(
        CONCAT_WS(' ', a.nombres, a.paterno, a.materno) ILIKE $${index}
        OR COALESCE(r.curso_registro, c.nombre_curso, '') ILIKE $${index}
        OR CONCAT_WS('-', a.rut::text, a.dv) ILIKE $${index}
        OR REGEXP_REPLACE(COALESCE(a.documento_erp, ''), '[^0-9A-Za-z]', '', 'g') ILIKE $${index + 1}
        OR COALESCE(a.uuid_erp::text, '') ILIKE $${index}
      )`);
      params.push(`%${query}%`, `%${query.replace(/[^0-9A-Za-z]/g, '')}%`);
      index += 2;
    }

    const where = conditions.join(' AND ');
    try {
      const countResult = await pool.query(`
        SELECT COUNT(*)::int AS total
        FROM attendance_registrations r
        JOIN alumno a ON a.id_alumno = r.id_alumno
        LEFT JOIN matricula_actual m ON m.id_alumno = a.id_alumno
        LEFT JOIN curso c ON c.id_curso = COALESCE(r.id_curso_registro, m.id_curso)
        WHERE ${where}
      `, params);
      const total = countResult.rows[0]?.total || 0;
      const pages = Math.max(1, Math.ceil(total / limit));
      const page = Math.min(requestedPage, pages);
      const queryParams = [...params, limit, (page - 1) * limit];
      const result = await pool.query(`
        SELECT r.id_registro, r.fecha::text AS fecha, TO_CHAR(r.hora, 'HH24:MI:SS') AS hora,
               r.estado, r.severidad, r.justificado, r.tipo_justificacion,
               r.comentario_justificacion, r.documento_id,
               d.nombre_original AS documento_nombre, d.mime_type AS documento_mime_type,
               r.origen, r.registrado_por, r.creado_en, r.version, r.corregido_en,
               r.motivo_correccion, a.id_alumno, a.nombres, a.paterno, a.materno,
               a.rut, a.dv, a.documento_erp, a.uuid_erp,
               COALESCE(r.id_curso_registro, m.id_curso) AS id_curso,
               COALESCE(r.curso_registro, c.nombre_curso, 'Sin curso informado') AS curso,
               r.jornada_registro, r.hora_limite_aplicada, r.minutos_atraso,
               r.version_regla, r.snapshot_migrado, r.control_puntualidad_id,
               r.control_codigo, r.control_nombre, r.control_tipo, r.control_version,
               u.nombre AS registrado_por_nombre
        FROM attendance_registrations r
        JOIN alumno a ON a.id_alumno = r.id_alumno
        LEFT JOIN matricula_actual m ON m.id_alumno = a.id_alumno
        LEFT JOIN curso c ON c.id_curso = COALESCE(r.id_curso_registro, m.id_curso)
        LEFT JOIN usuarios u ON u.id = r.registrado_por
        LEFT JOIN justification_documents d ON d.id_documento = r.documento_id
        WHERE ${where}
        ORDER BY r.fecha DESC, r.hora DESC, r.id_registro DESC
        LIMIT $${index} OFFSET $${index + 1}
      `, queryParams);

      res.json({
        periodo: range,
        pagina: page,
        limite: limit,
        total,
        paginas: pages,
        registros: result.rows.map((row) => protectStudentRecord(row))
      });
    } catch (error) {
      console.error('[puntualidad/justificaciones-pendientes]', error.message);
      res.status(500).json({ message: 'No fue posible obtener las justificaciones pendientes.' });
    }
  });

  router.get('/resumen-hoy', verifyAnyPermission(['punctuality.register', 'punctuality.view']), async (req, res) => {
    const controlId = asBoundedInteger(req.query?.control_id, 1, 2147483647);
    try {
      const result = await pool.query(`
        SELECT
          COUNT(*)::int AS ingresos_registrados,
          COUNT(*) FILTER (WHERE r.estado = 'Presente')::int AS a_tiempo,
          COUNT(*) FILTER (WHERE r.estado = 'Atrasado')::int AS atrasos,
          COUNT(*) FILTER (WHERE r.estado = 'Atrasado' AND r.severidad = 'Leve')::int AS atrasos_leves,
          COUNT(*) FILTER (WHERE r.estado = 'Atrasado' AND r.severidad = 'Grave')::int AS atrasos_graves,
          COUNT(*) FILTER (WHERE r.estado = 'Atrasado' AND r.justificado = true)::int AS justificados,
          (SELECT COUNT(*)::int FROM alumno WHERE activo = true AND rol = 'Estudiante') AS matricula_activa
        FROM attendance_registrations r
        WHERE r.fecha = CURRENT_DATE
          AND ${ACTIVE_ENTRY_FILTER}
          AND ($1::bigint IS NULL OR r.control_puntualidad_id = $1)
      `, [controlId]);
      const summary = result.rows[0];
      const registered = summary.ingresos_registrados || 0;
      const onTime = summary.a_tiempo || 0;
      res.json({
        ...summary,
        puntualidad_registrada: registered > 0 ? Number(((onTime / registered) * 100).toFixed(1)) : null
      });
    } catch (error) {
      console.error('[puntualidad/resumen-hoy]', error.message);
      res.status(500).json({ message: 'No fue posible obtener el resumen del día.' });
    }
  });

  router.patch('/registros/:id/corregir', verifyPermission('punctuality.correct'), async (req, res) => {
    const registrationId = parseRegistrationId(req.params.id);
    const reasonValidation = validateReason(req.body?.motivo);
    if (!registrationId) return res.status(400).json({ message: 'El registro no es válido.' });
    if (reasonValidation.error) return res.status(400).json({ message: reasonValidation.error });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const targetResult = await client.query(`
        SELECT * FROM attendance_registrations
        WHERE id_registro = $1 AND anulado = false
        FOR UPDATE
      `, [registrationId]);
      if (targetResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Registro activo no encontrado.' });
      }
      const target = targetResult.rows[0];
      if (target.tipo_registro !== 'Entrada' || !['Presente', 'Atrasado'].includes(target.estado)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'Este registro no pertenece al control de puntualidad.' });
      }

      const correctedDate = req.body?.fecha || String(target.fecha).slice(0, 10);
      const correctedTime = normalizeClockTime(req.body?.hora || target.hora);
      if (!isIsoDate(correctedDate) || !correctedTime) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'La fecha o la hora corregida no es válida.' });
      }

      const historicalConfig = {
        hora_entrada: target.hora_entrada_aplicada,
        hora_limite_atraso: target.hora_limite_aplicada,
        minutos_atraso_grave: target.minutos_atraso_grave_aplicado
      };
      const classification = calculateStatusAndSeverity('Entrada', correctedTime, historicalConfig);
      const correctedDelayMinutes = calculateDelayMinutes(correctedTime, target.hora_limite_aplicada);
      const before = registrationSnapshot(target);
      const updatedResult = await client.query(`
        UPDATE attendance_registrations
        SET fecha = $1,
            hora = $2,
            estado = $3,
            severidad = $4,
            corregido_por = $5,
            corregido_en = CURRENT_TIMESTAMP,
            motivo_correccion = $6,
            minutos_atraso = $7,
            version = version + 1
        WHERE id_registro = $8
        RETURNING *
      `, [
        correctedDate,
        correctedTime,
        classification.status,
        classification.severidad,
        req.user.id,
        reasonValidation.value,
        correctedDelayMinutes,
        registrationId
      ]);
      const after = registrationSnapshot(updatedResult.rows[0]);

      await client.query(`
        INSERT INTO puntualidad_correcciones (id_registro, accion, motivo, antes, despues, realizado_por)
        VALUES ($1, 'CORREGIR', $2, $3, $4, $5)
      `, [registrationId, reasonValidation.value, JSON.stringify(before), JSON.stringify(after), req.user.id]);
      await insertarAudit(client, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: 'CORREGIR_REGISTRO_PUNTUALIDAD',
        entidad: 'registro_puntualidad',
        entidad_id: registrationId,
        detalle: { motivo: reasonValidation.value, antes: before, despues: after },
        ip: getClientIp(req)
      });
      await client.query('COMMIT');
      res.json({ message: 'Registro corregido con trazabilidad.', registro: updatedResult.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[puntualidad/registros:corregir]', error.message);
      if (error.code === '23505') return res.status(409).json({ message: 'Ya existe un ingreso activo para esa persona y fecha.' });
      res.status(500).json({ message: 'No fue posible corregir el registro.' });
    } finally {
      client.release();
    }
  });

  router.patch('/registros/:id/anular', verifyPermission('punctuality.cancel'), async (req, res) => {
    const registrationId = parseRegistrationId(req.params.id);
    const reasonValidation = validateReason(req.body?.motivo);
    if (!registrationId) return res.status(400).json({ message: 'El registro no es válido.' });
    if (reasonValidation.error) return res.status(400).json({ message: reasonValidation.error });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const targetResult = await client.query(
        'SELECT * FROM attendance_registrations WHERE id_registro = $1 AND anulado = false FOR UPDATE',
        [registrationId]
      );
      if (targetResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Registro activo no encontrado.' });
      }
      const target = targetResult.rows[0];
      if (target.tipo_registro !== 'Entrada' || !['Presente', 'Atrasado'].includes(target.estado)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'Este registro no pertenece al control de puntualidad.' });
      }

      const before = registrationSnapshot(target);
      const updatedResult = await client.query(`
        UPDATE attendance_registrations
        SET anulado = true,
            anulado_por = $1,
            anulado_en = CURRENT_TIMESTAMP,
            motivo_anulacion = $2,
            version = version + 1
        WHERE id_registro = $3
        RETURNING *
      `, [req.user.id, reasonValidation.value, registrationId]);
      const after = registrationSnapshot(updatedResult.rows[0]);

      await client.query(`
        INSERT INTO puntualidad_correcciones (id_registro, accion, motivo, antes, despues, realizado_por)
        VALUES ($1, 'ANULAR', $2, $3, $4, $5)
      `, [registrationId, reasonValidation.value, JSON.stringify(before), JSON.stringify(after), req.user.id]);
      await insertarAudit(client, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: 'ANULAR_REGISTRO_PUNTUALIDAD',
        entidad: 'registro_puntualidad',
        entidad_id: registrationId,
        detalle: { motivo: reasonValidation.value, antes: before, despues: after },
        ip: getClientIp(req)
      });
      await client.query('COMMIT');
      res.json({ message: 'Registro anulado sin eliminar su historial.' });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[puntualidad/registros:anular]', error.message);
      res.status(500).json({ message: 'No fue posible anular el registro.' });
    } finally {
      client.release();
    }
  });

  router.post('/registros/:id/justificar', verifyPermission('punctuality.justify'), async (req, res) => {
    const registrationId = parseRegistrationId(req.params.id);
    const reasonValidation = validateReason(req.body?.comentario, { min: 5, max: 500 });
    const justificationType = String(req.body?.tipo || 'apoderado').trim().toLowerCase();
    const fileName = req.body?.fileName;
    const fileData = req.body?.fileData;

    if (!registrationId) return res.status(400).json({ message: 'El registro no es válido.' });
    if (reasonValidation.error) return res.status(400).json({ message: reasonValidation.error });
    if (!['apoderado', 'medica', 'institucional'].includes(justificationType)) {
      return res.status(400).json({ message: 'El tipo de justificación no es válido.' });
    }
    if (Boolean(fileName) !== Boolean(fileData)) {
      return res.status(400).json({ message: 'El archivo adjunto está incompleto.' });
    }
    if (justificationType === 'medica' && (!fileName || !fileData)) {
      return res.status(400).json({ message: 'Una justificación médica requiere un certificado adjunto.' });
    }

    const client = await pool.connect();
    let createdDocument = null;
    let obsoleteStoredName = null;
    try {
      await client.query('BEGIN');
      const targetResult = await client.query(
        "SELECT * FROM attendance_registrations WHERE id_registro = $1 AND anulado = false AND estado = 'Atrasado' AND justificado = false FOR UPDATE",
        [registrationId]
      );
      if (targetResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'El atraso no está disponible para una nueva justificación.' });
      }

      if (fileName && fileData) {
        createdDocument = await createDocument(client, {
          fileData,
          fileName,
          userId: req.user.id
        });
      }

      const before = registrationSnapshot(targetResult.rows[0]);
      const updatedResult = await client.query(`
        UPDATE attendance_registrations
        SET justificado = true,
            tipo_justificacion = $1,
            comentario_justificacion = $2,
            documento_id = $3,
            archivo_justificacion = NULL,
            regularizado_por = $4,
            regularizado_en = CURRENT_TIMESTAMP,
            version = version + 1
        WHERE id_registro = $5
        RETURNING *
      `, [
        justificationType,
        reasonValidation.value,
        createdDocument?.id_documento || null,
        req.user.id,
        registrationId
      ]);
      const after = registrationSnapshot(updatedResult.rows[0]);

      if (targetResult.rows[0].documento_id && targetResult.rows[0].documento_id !== createdDocument?.id_documento) {
        obsoleteStoredName = await deleteDocumentIfUnreferenced(client, targetResult.rows[0].documento_id);
      }

      await client.query(`
        INSERT INTO puntualidad_correcciones (id_registro, accion, motivo, antes, despues, realizado_por)
        VALUES ($1, 'JUSTIFICAR', $2, $3, $4, $5)
      `, [registrationId, reasonValidation.value, JSON.stringify(before), JSON.stringify(after), req.user.id]);
      await insertarAudit(client, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: 'JUSTIFICAR_ATRASO',
        entidad: 'registro_puntualidad',
        entidad_id: registrationId,
        detalle: {
          tipo: justificationType,
          comentario: reasonValidation.value,
          documento_id: createdDocument?.id_documento || null,
          antes: before,
          despues: after
        },
        ip: getClientIp(req)
      });
      await client.query('COMMIT');

      if (obsoleteStoredName) await removeStoredFile(obsoleteStoredName).catch(() => {});
      res.json({
        message: 'Justificación registrada con trazabilidad.',
        registro: {
          ...updatedResult.rows[0],
          documento_nombre: createdDocument?.nombre_original || null,
          documento_mime_type: createdDocument?.mime_type || null
        }
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (createdDocument?.nombre_almacenado) {
        await removeStoredFile(createdDocument.nombre_almacenado).catch(() => {});
      }
      console.error('[puntualidad/registros:justificar]', error.message);
      const status = error instanceof DocumentValidationError ? error.statusCode : 500;
      res.status(status).json({
        message: status === 400 ? error.message : 'No fue posible justificar el atraso.'
      });
    } finally {
      client.release();
    }
  });

  router.patch('/registros/:id/revocar-justificacion', verifyPermission('punctuality.justify'), async (req, res) => {
    const registrationId = parseRegistrationId(req.params.id);
    const reasonValidation = validateReason(req.body?.motivo);
    if (!registrationId) return res.status(400).json({ message: 'El registro no es válido.' });
    if (reasonValidation.error) return res.status(400).json({ message: reasonValidation.error });

    const client = await pool.connect();
    let obsoleteStoredName = null;
    try {
      await client.query('BEGIN');
      const targetResult = await client.query(
        "SELECT * FROM attendance_registrations WHERE id_registro = $1 AND anulado = false AND estado = 'Atrasado' AND justificado = true FOR UPDATE",
        [registrationId]
      );
      if (targetResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Justificación activa no encontrada.' });
      }

      const before = registrationSnapshot(targetResult.rows[0]);
      const updatedResult = await client.query(`
        UPDATE attendance_registrations
        SET justificado = false,
            tipo_justificacion = NULL,
            comentario_justificacion = NULL,
            documento_id = NULL,
            archivo_justificacion = NULL,
            regularizado_por = NULL,
            regularizado_en = NULL,
            version = version + 1
        WHERE id_registro = $1
        RETURNING *
      `, [registrationId]);
      const after = registrationSnapshot(updatedResult.rows[0]);

      if (targetResult.rows[0].documento_id) {
        obsoleteStoredName = await deleteDocumentIfUnreferenced(client, targetResult.rows[0].documento_id);
      }

      await client.query(`
        INSERT INTO puntualidad_correcciones (id_registro, accion, motivo, antes, despues, realizado_por)
        VALUES ($1, 'REVOCAR_JUSTIFICACION', $2, $3, $4, $5)
      `, [registrationId, reasonValidation.value, JSON.stringify(before), JSON.stringify(after), req.user.id]);
      await insertarAudit(client, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: 'REVOCAR_JUSTIFICACION_ATRASO',
        entidad: 'registro_puntualidad',
        entidad_id: registrationId,
        detalle: {
          motivo: reasonValidation.value,
          documento_id_eliminado: targetResult.rows[0].documento_id || null,
          antes: before,
          despues: after
        },
        ip: getClientIp(req)
      });
      await client.query('COMMIT');

      if (obsoleteStoredName) await removeStoredFile(obsoleteStoredName).catch(() => {});
      res.json({ message: 'Justificación revocada con trazabilidad.', registro: updatedResult.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[puntualidad/registros:revocar]', error.message);
      res.status(500).json({ message: 'No fue posible revocar la justificación.' });
    } finally {
      client.release();
    }
  });

  router.get('/registros/:id/historial', verifyAnyPermission(['punctuality.view', 'punctuality.correct', 'punctuality.cancel', 'punctuality.justify']), async (req, res) => {
    const registrationId = parseRegistrationId(req.params.id);
    if (!registrationId) return res.status(400).json({ message: 'El registro no es válido.' });
    try {
      const result = await pool.query(`
        SELECT c.id, c.accion, c.motivo, c.antes, c.despues, c.realizado_en,
               c.realizado_por, u.nombre AS realizado_por_nombre, u.correo AS realizado_por_correo
        FROM puntualidad_correcciones c
        LEFT JOIN usuarios u ON u.id = c.realizado_por
        WHERE c.id_registro = $1
        ORDER BY c.realizado_en DESC, c.id DESC
      `, [registrationId]);
      res.json(result.rows);
    } catch (error) {
      console.error('[puntualidad/registros:historial]', error.message);
      res.status(500).json({ message: 'No fue posible obtener el historial del registro.' });
    }
  });

  router.get('/registros/:id/documento', verifyAnyPermission(['punctuality.view', 'punctuality.justify']), async (req, res) => {
    const registrationId = parseRegistrationId(req.params.id);
    if (!registrationId) return res.status(400).json({ message: 'El registro no es válido.' });

    try {
      const result = await pool.query(`
        SELECT d.nombre_original, d.nombre_almacenado, d.mime_type
        FROM attendance_registrations r
        JOIN justification_documents d ON d.id_documento = r.documento_id
        WHERE r.id_registro = $1
          AND r.anulado = false
          AND r.estado = 'Atrasado'
          AND r.justificado = true
      `, [registrationId]);
      if (result.rows.length === 0) {
        return res.status(404).json({ message: 'Este atraso no tiene un documento vigente.' });
      }

      const document = result.rows[0];
      const filePath = resolveDocumentPath(document.nombre_almacenado);
      if (!filePath) return res.status(404).json({ message: 'El documento no es válido o ya no existe.' });

      await fs.promises.access(filePath, fs.constants.R_OK);
      res.setHeader('Cache-Control', 'private, no-store, max-age=0');
      res.type(document.mime_type);
      return res.download(filePath, document.nombre_original);
    } catch (error) {
      if (error.code === 'ENOENT') return res.status(404).json({ message: 'El documento no fue encontrado en el servidor.' });
      console.error('[puntualidad/registros:documento]', error.message);
      return res.status(500).json({ message: 'No fue posible descargar el documento.' });
    }
  });

  router.get('/analitica', verifyPermission('analytics.view'), async (req, res) => {
    const { desde, hasta, id_curso: courseIdRaw, control_id: controlIdRaw, justificado, severidad } = req.query;
    const range = validateDateRange(desde, hasta);
    if (range.error) return res.status(400).json({ message: range.error });

    const params = [desde, hasta];
    const conditions = [`r.fecha BETWEEN $1 AND $2`, ACTIVE_ENTRY_FILTER];
    let index = 3;
    if (courseIdRaw) {
      const courseId = asBoundedInteger(courseIdRaw, 1, 2147483647);
      if (!courseId) return res.status(400).json({ message: 'El curso seleccionado no es válido.' });
      conditions.push(`COALESCE(r.id_curso_registro, m.id_curso) = $${index++}`);
      params.push(courseId);
    }
    if (controlIdRaw) {
      const controlId = asBoundedInteger(controlIdRaw, 1, 2147483647);
      if (!controlId) return res.status(400).json({ message: 'El control horario no es válido.' });
      conditions.push(`r.control_puntualidad_id = $${index++}`);
      params.push(controlId);
    }
    if (justificado !== undefined && justificado !== '') {
      if (!['true', 'false'].includes(String(justificado))) return res.status(400).json({ message: 'El filtro de justificación no es válido.' });
      conditions.push(`r.estado = 'Atrasado' AND r.justificado = $${index++}`);
      params.push(String(justificado) === 'true');
    }
    if (severidad) {
      if (!['Leve', 'Grave'].includes(severidad)) return res.status(400).json({ message: 'La severidad no es válida.' });
      conditions.push(`r.estado = 'Atrasado' AND r.severidad = $${index++}`);
      params.push(severidad);
    }
    const where = conditions.join(' AND ');

    try {
      const [metrics, daily, courses, slots, recurrent, controls] = await Promise.all([
        pool.query(`
          SELECT
            COUNT(*)::int AS ingresos,
            COUNT(*) FILTER (WHERE r.estado = 'Presente')::int AS a_tiempo,
            COUNT(*) FILTER (WHERE r.estado = 'Atrasado')::int AS atrasos,
            COUNT(*) FILTER (WHERE r.estado = 'Atrasado' AND r.severidad = 'Leve')::int AS leves,
            COUNT(*) FILTER (WHERE r.estado = 'Atrasado' AND r.severidad = 'Grave')::int AS graves,
            COUNT(*) FILTER (WHERE r.estado = 'Atrasado' AND r.justificado = true)::int AS justificados,
            ROUND(AVG(CASE WHEN r.estado = 'Atrasado' THEN r.minutos_atraso END)::numeric, 1)
              AS promedio_minutos_atraso
          FROM attendance_registrations r
          JOIN alumno a ON a.id_alumno = r.id_alumno
          LEFT JOIN matricula_actual m ON m.id_alumno = a.id_alumno
          WHERE ${where}
        `, params),
        pool.query(`
          SELECT r.fecha::text AS fecha,
                 COUNT(*)::int AS ingresos,
                 COUNT(*) FILTER (WHERE r.estado = 'Presente')::int AS a_tiempo,
                 COUNT(*) FILTER (WHERE r.estado = 'Atrasado')::int AS atrasos
          FROM attendance_registrations r
          JOIN alumno a ON a.id_alumno = r.id_alumno
          LEFT JOIN matricula_actual m ON m.id_alumno = a.id_alumno
          WHERE ${where}
          GROUP BY r.fecha
          ORDER BY r.fecha
        `, params),
        pool.query(`
          SELECT COALESCE(r.id_curso_registro, m.id_curso) AS id_curso,
                 COALESCE(r.curso_registro, c.nombre_curso, 'Sin curso') AS curso,
                 COUNT(*)::int AS ingresos,
                 COUNT(*) FILTER (WHERE r.estado = 'Atrasado')::int AS atrasos,
                 COUNT(*) FILTER (WHERE r.estado = 'Atrasado' AND r.severidad = 'Grave')::int AS graves
          FROM attendance_registrations r
          JOIN alumno a ON a.id_alumno = r.id_alumno
          LEFT JOIN matricula_actual m ON m.id_alumno = a.id_alumno
          LEFT JOIN curso c ON c.id_curso = COALESCE(r.id_curso_registro, m.id_curso)
          WHERE ${where}
          GROUP BY COALESCE(r.id_curso_registro, m.id_curso),
                   COALESCE(r.curso_registro, c.nombre_curso, 'Sin curso')
          ORDER BY atrasos DESC, ingresos DESC, curso
        `, params),
        pool.query(`
          SELECT CASE
                   WHEN delay_minutes <= 5 THEN '1 a 5 min'
                   WHEN delay_minutes <= 10 THEN '6 a 10 min'
                   WHEN delay_minutes <= 15 THEN '11 a 15 min'
                   WHEN delay_minutes <= 30 THEN '16 a 30 min'
                   ELSE 'Más de 30 min'
                 END AS tramo,
                 COUNT(*)::int AS atrasos
          FROM (
            SELECT r.minutos_atraso AS delay_minutes
            FROM attendance_registrations r
            JOIN alumno a ON a.id_alumno = r.id_alumno
            LEFT JOIN matricula_actual m ON m.id_alumno = a.id_alumno
            WHERE ${where} AND r.estado = 'Atrasado'
          ) delays
          GROUP BY tramo
          ORDER BY MIN(delay_minutes)
        `, params),
        pool.query(`
          SELECT a.id_alumno, a.nombres, a.paterno, a.materno,
                 COALESCE(r.curso_registro, c.nombre_curso, 'Sin curso') AS curso,
                 COUNT(*) FILTER (WHERE r.estado = 'Atrasado')::int AS atrasos,
                 COUNT(*) FILTER (WHERE r.estado = 'Atrasado' AND r.severidad = 'Grave')::int AS graves
          FROM attendance_registrations r
          JOIN alumno a ON a.id_alumno = r.id_alumno
          LEFT JOIN matricula_actual m ON m.id_alumno = a.id_alumno
          LEFT JOIN curso c ON c.id_curso = COALESCE(r.id_curso_registro, m.id_curso)
          WHERE ${where}
          GROUP BY a.id_alumno, a.nombres, a.paterno, a.materno,
                   COALESCE(r.curso_registro, c.nombre_curso, 'Sin curso')
          HAVING COUNT(*) FILTER (WHERE r.estado = 'Atrasado') > 0
          ORDER BY atrasos DESC, graves DESC, a.paterno
          LIMIT 10
        `, params),
        pool.query(`
          SELECT r.control_puntualidad_id AS id,
                 r.control_nombre AS nombre,
                 r.control_tipo AS tipo,
                 COUNT(*)::int AS ingresos,
                 COUNT(*) FILTER (WHERE r.estado = 'Atrasado')::int AS atrasos,
                 COUNT(*) FILTER (WHERE r.estado = 'Atrasado' AND r.severidad = 'Grave')::int AS graves,
                 ROUND(AVG(CASE WHEN r.estado = 'Atrasado' THEN r.minutos_atraso END)::numeric, 1)
                   AS promedio_minutos
          FROM attendance_registrations r
          JOIN alumno a ON a.id_alumno = r.id_alumno
          LEFT JOIN matricula_actual m ON m.id_alumno = a.id_alumno
          WHERE ${where}
          GROUP BY r.control_puntualidad_id, r.control_nombre, r.control_tipo
          ORDER BY atrasos DESC, ingresos DESC, nombre
        `, params)
      ]);

      const summary = metrics.rows[0];
      const total = summary.ingresos || 0;
      const onTime = summary.a_tiempo || 0;
      res.json({
        resumen: {
          ...summary,
          puntualidad_registrada: total > 0 ? Number(((onTime / total) * 100).toFixed(1)) : null
        },
        por_dia: daily.rows.map((row) => ({
          ...row,
          puntualidad: row.ingresos > 0 ? Number(((row.a_tiempo / row.ingresos) * 100).toFixed(1)) : null
        })),
        por_curso: courses.rows.map((row) => ({
          ...row,
          tasa_atraso: row.ingresos > 0 ? Number(((row.atrasos / row.ingresos) * 100).toFixed(1)) : null
        })),
        por_tramo: slots.rows,
        por_control: controls.rows.map((row) => ({
          ...row,
          tasa_atraso: row.ingresos > 0 ? Number(((row.atrasos / row.ingresos) * 100).toFixed(1)) : null
        })),
        recurrentes: recurrent.rows,
        periodo: range
      });
    } catch (error) {
      console.error('[puntualidad/analitica]', error.message);
      res.status(500).json({ message: 'No fue posible calcular la analítica de puntualidad.' });
    }
  });

  router.get('/reporte', verifyPermission('reports.generate'), async (req, res) => {
    const {
      desde, hasta, curso_id: courseIdRaw, alumno_id: studentIdRaw,
      alumnos_ids: studentIdsRaw, control_id: controlIdRaw
    } = req.query;
    const range = validateDateRange(desde, hasta);
    if (range.error) return res.status(400).json({ message: range.error });

    const params = [desde, hasta];
    const conditions = [
      'r.fecha BETWEEN $1 AND $2',
      "r.tipo_registro = 'Entrada'",
      "r.estado = 'Atrasado'",
      'r.anulado = false'
    ];
    let index = 3;

    if (courseIdRaw) {
      const courseId = asBoundedInteger(courseIdRaw, 1, 2147483647);
      if (!courseId) return res.status(400).json({ message: 'El curso seleccionado no es válido.' });
      conditions.push(`COALESCE(r.id_curso_registro, m.id_curso) = $${index++}`);
      params.push(courseId);
    }
    if (studentIdRaw) {
      const studentId = asBoundedInteger(studentIdRaw, 1, 2147483647);
      if (!studentId) return res.status(400).json({ message: 'El alumno seleccionado no es válido.' });
      conditions.push(`a.id_alumno = $${index++}`);
      params.push(studentId);
    }
    if (studentIdsRaw) {
      const ids = [...new Set(String(studentIdsRaw).split(',').map((value) => asBoundedInteger(value.trim(), 1, 2147483647)).filter(Boolean))];
      if (ids.length === 0 || ids.length > 200) return res.status(400).json({ message: 'La selección personalizada debe contener entre 1 y 200 alumnos.' });
      conditions.push(`a.id_alumno = ANY($${index++}::int[])`);
      params.push(ids);
    }
    if (controlIdRaw) {
      const controlId = asBoundedInteger(controlIdRaw, 1, 2147483647);
      if (!controlId) return res.status(400).json({ message: 'El control horario seleccionado no es válido.' });
      conditions.push(`r.control_puntualidad_id = $${index++}`);
      params.push(controlId);
    }

    try {
      const result = await pool.query(`
        SELECT r.id_registro, r.fecha::text AS fecha, TO_CHAR(r.hora, 'HH24:MI:SS') AS hora,
               r.severidad, r.justificado, r.tipo_justificacion, r.comentario_justificacion,
               r.documento_id, d.nombre_original AS documento_nombre, r.origen,
               a.id_alumno, a.rut, a.dv, a.documento_erp, a.uuid_erp,
               a.nombres, a.paterno, a.materno,
               COALESCE(r.curso_registro, c.nombre_curso, 'Sin curso') AS curso,
               r.jornada_registro, r.hora_entrada_aplicada, r.hora_limite_aplicada,
               r.minutos_atraso, r.version_regla, r.snapshot_migrado,
               r.control_puntualidad_id, r.control_codigo, r.control_nombre,
               r.control_tipo, r.control_version
        FROM attendance_registrations r
        JOIN alumno a ON a.id_alumno = r.id_alumno
        LEFT JOIN matricula_actual m ON m.id_alumno = a.id_alumno
        LEFT JOIN curso c ON c.id_curso = COALESCE(r.id_curso_registro, m.id_curso)
        LEFT JOIN justification_documents d ON d.id_documento = r.documento_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY r.fecha, r.hora, c.nombre_curso, a.paterno, a.nombres
      `, params);
      res.json({
        periodo: range,
        total: result.rows.length,
        registros: result.rows.map((row) => protectStudentRecord(row))
      });
    } catch (error) {
      console.error('[puntualidad/reporte]', error.message);
      res.status(500).json({ message: 'No fue posible generar los datos del reporte.' });
    }
  });

  router.get('/alertas', verifyPermission('analytics.view'), async (req, res) => {
    const days = asBoundedInteger(req.query?.dias || 30, 7, 180);
    if (!days) return res.status(400).json({ message: 'El período de alertas debe estar entre 7 y 180 días.' });

    try {
      const result = await pool.query(`
        WITH cfg AS (
          SELECT umbral_alerta, umbral_critico FROM configuracion_asistencia LIMIT 1
        ), recent AS (
          SELECT r.id_alumno, r.fecha, r.estado, r.severidad,
                 r.id_curso_registro, r.curso_registro
          FROM attendance_registrations r
          WHERE r.fecha >= CURRENT_DATE - ($1::int - 1)
            AND ${ACTIVE_ENTRY_FILTER}
            AND r.cuenta_alertas_aplicado = true
        ), aggregates AS (
          SELECT a.id_alumno, a.nombres, a.paterno, a.materno,
                 COALESCE(recent.curso_registro, c.nombre_curso, 'Sin curso') AS curso,
                 COUNT(*) FILTER (WHERE recent.estado = 'Atrasado')::int AS atrasos,
                 COUNT(*) FILTER (WHERE recent.estado = 'Atrasado' AND recent.severidad = 'Grave')::int AS graves,
                 COUNT(*) FILTER (
                   WHERE recent.estado = 'Atrasado'
                     AND recent.fecha > COALESCE((
                       SELECT MAX(r2.fecha) FROM recent r2
                       WHERE r2.id_alumno = a.id_alumno AND r2.estado = 'Presente'
                     ), DATE '1900-01-01')
                 )::int AS racha_atrasos,
                 MAX(recent.fecha) FILTER (WHERE recent.estado = 'Atrasado')::text AS ultimo_atraso
          FROM alumno a
          JOIN recent ON recent.id_alumno = a.id_alumno
          LEFT JOIN matricula_actual m ON m.id_alumno = a.id_alumno
          LEFT JOIN curso c ON c.id_curso = COALESCE(recent.id_curso_registro, m.id_curso)
          WHERE a.activo = true
          GROUP BY a.id_alumno, a.nombres, a.paterno, a.materno,
                   COALESCE(recent.curso_registro, c.nombre_curso, 'Sin curso')
        )
        SELECT aggregates.*,
               CASE
                 WHEN atrasos >= cfg.umbral_critico OR graves >= 3 THEN 'critica'
                 WHEN atrasos >= cfg.umbral_alerta OR racha_atrasos >= cfg.umbral_alerta THEN 'preventiva'
                 ELSE 'observacion'
               END AS nivel
        FROM aggregates
        CROSS JOIN cfg
        WHERE atrasos >= cfg.umbral_alerta OR graves >= 2 OR racha_atrasos >= cfg.umbral_alerta
        ORDER BY
          CASE WHEN atrasos >= cfg.umbral_critico OR graves >= 3 THEN 0 ELSE 1 END,
          atrasos DESC, graves DESC, paterno
      `, [days]);
      res.json({ dias: days, total: result.rows.length, alertas: result.rows });
    } catch (error) {
      console.error('[puntualidad/alertas]', error.message);
      res.status(500).json({ message: 'No fue posible calcular las alertas de atrasos.' });
    }
  });

  return router;
};

module.exports = { createPunctualityRouter, registrationSnapshot };
