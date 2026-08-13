const crypto = require('crypto');
const express = require('express');

const { maskDocument, validateVisitorInput } = require('../utils/visitors');

const clean = (value, max = 500) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
const positiveId = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const normalizeToken = (value) => clean(value, 300).replace(/^LDSM:VISITA:/i, '');
const randomToken = () => crypto.randomBytes(32).toString('base64url');
const enumValue = (value, allowed, fallback = null) => {
  const normalized = clean(value, 40).toUpperCase();
  return allowed.includes(normalized) ? normalized : fallback;
};

const findOrCreateVisitor = async (client, input, userId) => {
  const validation = validateVisitorInput(input || {});
  if (validation.error) {
    const error = new Error(validation.error);
    error.status = 400;
    throw error;
  }
  const value = validation.value;
  const result = await client.query(`
    INSERT INTO visitantes
      (tipo_documento, documento_numero, nombre_completo, telefono, creado_por, actualizado_por)
    VALUES ($1, $2, $3, $4, $5, $5)
    ON CONFLICT (tipo_documento, documento_numero) DO UPDATE SET
      nombre_completo = EXCLUDED.nombre_completo,
      telefono = COALESCE(EXCLUDED.telefono, visitantes.telefono),
      actualizado_por = EXCLUDED.actualizado_por,
      actualizado_en = CURRENT_TIMESTAMP
    RETURNING id, tipo_documento, documento_numero, nombre_completo, telefono, frecuente
  `, [value.tipo_documento, value.documento_numero, value.nombre_completo, value.telefono, userId]);
  return result.rows[0];
};

const audit = (insertarAudit, client, req, data) => insertarAudit(client, {
  usuario_id: req.user.id,
  usuario_correo: req.user.correo,
  ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
  ...data
});

const createVisitsExtendedRouter = ({ pool, verifyToken, verifyPermission, verifyAnyPermission, insertarAudit }) => {
  const router = express.Router();
  router.use(verifyToken);

  router.get('/operacion-ampliada/resumen', verifyAnyPermission([
    'visits.view', 'visits.register', 'visits.preregistrations.manage',
    'visits.deliveries.manage', 'visits.vehicles.manage', 'visits.restrictions.manage',
    'visits.emergency.view', 'visits.emergency.manage', 'visits.settings'
  ]), async (req, res) => {
    try {
      await pool.query(`UPDATE visita_preinscripciones SET estado = 'VENCIDA'
        WHERE estado = 'ESPERADA' AND valida_hasta < CURRENT_TIMESTAMP`);
      const result = await pool.query(`
        SELECT
          (SELECT COUNT(*)::int FROM visita_preinscripciones WHERE estado = 'ESPERADA'
            AND CURRENT_TIMESTAMP <= valida_hasta) AS visitas_esperadas,
          (SELECT COUNT(*)::int FROM visitas WHERE estado = 'DENTRO'
            AND salida_esperada_en IS NOT NULL AND salida_esperada_en < CURRENT_TIMESTAMP) AS permanencias_excedidas,
          (SELECT COUNT(*)::int FROM visita_encomiendas WHERE estado = 'RECIBIDA') AS encomiendas_pendientes,
          (SELECT COUNT(*)::int FROM visita_restricciones_acceso WHERE activo = true
            AND vigente_desde <= CURRENT_TIMESTAMP
            AND (vigente_hasta IS NULL OR vigente_hasta >= CURRENT_TIMESTAMP)) AS restricciones_vigentes,
          (SELECT COUNT(*)::int FROM visitas WHERE estado = 'DENTRO') AS personas_dentro,
          (SELECT id FROM visita_emergencias WHERE estado = 'ACTIVA' LIMIT 1) AS emergencia_activa_id
      `);
      res.json(result.rows[0]);
    } catch (error) {
      console.error('[visitas:operacion-ampliada:resumen]', error.message);
      res.status(500).json({ message: 'No fue posible obtener el resumen ampliado de Portería.' });
    }
  });

  router.get('/entidades-externas', verifyAnyPermission([
    'visits.preregistrations.manage', 'visits.deliveries.manage', 'visits.vehicles.manage', 'visits.settings'
  ]), async (req, res) => {
    const query = clean(req.query?.q, 120);
    try {
      const result = await pool.query(`
        SELECT id, tipo, identificador, nombre, contacto, telefono, email, activo, actualizado_en
        FROM visita_entidades_externas
        WHERE ($1 = '' OR nombre ILIKE '%' || $1 || '%' OR COALESCE(identificador, '') ILIKE '%' || $1 || '%')
        ORDER BY activo DESC, nombre LIMIT 200
      `, [query]);
      res.json(result.rows);
    } catch (error) {
      console.error('[visitas:entidades:listar]', error.message);
      res.status(500).json({ message: 'No fue posible listar proveedores y contratistas.' });
    }
  });

  router.post('/entidades-externas', verifyPermission('visits.settings'), async (req, res) => {
    const type = enumValue(req.body?.tipo, ['PROVEEDOR', 'CONTRATISTA', 'OTRA']);
    const name = clean(req.body?.nombre, 160);
    if (!type || name.length < 3) return res.status(400).json({ message: 'Indica un tipo y un nombre válido.' });
    try {
      const result = await pool.query(`
        INSERT INTO visita_entidades_externas
          (tipo, identificador, nombre, contacto, telefono, email, creado_por, actualizado_por)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
        RETURNING *
      `, [type, clean(req.body?.identificador, 40) || null, name, clean(req.body?.contacto, 160) || null,
        clean(req.body?.telefono, 40) || null, clean(req.body?.email, 160).toLowerCase() || null, req.user.id]);
      await audit(insertarAudit, pool, req, { accion: 'CREAR_ENTIDAD_VISITA', entidad: 'visita_entidad_externa', entidad_id: result.rows[0].id, detalle: { tipo: type, nombre: name } });
      res.status(201).json(result.rows[0]);
    } catch (error) {
      if (error.code === '23505') return res.status(409).json({ message: 'Ya existe una entidad con ese identificador.' });
      console.error('[visitas:entidades:crear]', error.message);
      res.status(500).json({ message: 'No fue posible crear la entidad externa.' });
    }
  });

  router.get('/preinscripciones', verifyAnyPermission(['visits.view', 'visits.register', 'visits.preregistrations.manage']), async (req, res) => {
    const state = enumValue(req.query?.estado, ['ESPERADA', 'UTILIZADA', 'VENCIDA', 'CANCELADA']);
    try {
      await pool.query(`UPDATE visita_preinscripciones SET estado = 'VENCIDA'
        WHERE estado = 'ESPERADA' AND valida_hasta < CURRENT_TIMESTAMP`);
      const result = await pool.query(`
        SELECT p.id, p.estado, p.categoria, p.valida_desde, p.valida_hasta, p.usos_maximos,
               p.usos_realizados, p.motivo_codigo, vm.nombre AS motivo_nombre,
               p.destino_codigo, vd.nombre AS destino_nombre, p.persona_contactada,
               p.observaciones, v.id AS visitante_id, v.nombre_completo,
               v.tipo_documento, v.documento_numero, e.nombre AS entidad_nombre
        FROM visita_preinscripciones p
        JOIN visitantes v ON v.id = p.visitante_id
        JOIN visita_motivos vm ON vm.codigo = p.motivo_codigo
        JOIN visita_destinos vd ON vd.codigo = p.destino_codigo
        LEFT JOIN visita_entidades_externas e ON e.id = p.entidad_externa_id
        WHERE ($1::text IS NULL OR p.estado = $1)
        ORDER BY CASE WHEN p.estado = 'ESPERADA' THEN 0 ELSE 1 END, p.valida_desde DESC
        LIMIT 300
      `, [state]);
      res.json(result.rows.map((row) => ({ ...row, documento_numero: undefined, documento_mostrado: maskDocument(row.tipo_documento, row.documento_numero) })));
    } catch (error) {
      console.error('[visitas:preinscripciones:listar]', error.message);
      res.status(500).json({ message: 'No fue posible listar las visitas esperadas.' });
    }
  });

  router.post('/preinscripciones', verifyPermission('visits.preregistrations.manage'), async (req, res) => {
    const start = new Date(req.body?.valida_desde);
    const end = new Date(req.body?.valida_hasta);
    const motive = clean(req.body?.motivo_codigo, 40).toUpperCase();
    const destination = clean(req.body?.destino_codigo, 40).toUpperCase();
    const host = clean(req.body?.persona_contactada, 160);
    const category = enumValue(req.body?.categoria, ['VISITA', 'PROVEEDOR', 'CONTRATISTA'], 'VISITA');
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
      return res.status(400).json({ message: 'La vigencia de la preinscripción no es válida.' });
    }
    if (end.getTime() - start.getTime() > 7 * 24 * 60 * 60 * 1000) {
      return res.status(400).json({ message: 'Una preinscripción no puede tener más de siete días de vigencia.' });
    }
    if (!motive || !destination || host.length < 3) return res.status(400).json({ message: 'Completa el motivo, destino y persona anfitriona.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const catalogs = await client.query(`
        SELECT
          EXISTS(SELECT 1 FROM visita_motivos WHERE codigo = $1 AND activo = true) AS motivo,
          EXISTS(SELECT 1 FROM visita_destinos WHERE codigo = $2 AND activo = true) AS destino
      `, [motive, destination]);
      if (!catalogs.rows[0].motivo || !catalogs.rows[0].destino) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'El motivo o destino ya no está disponible.' });
      }
      const visitor = await findOrCreateVisitor(client, req.body?.visitante, req.user.id);
      const restriction = await client.query(`
        SELECT tipo, motivo FROM visita_restricciones_acceso
        WHERE visitante_id = $1 AND activo = true AND vigente_desde <= CURRENT_TIMESTAMP
          AND (vigente_hasta IS NULL OR vigente_hasta >= CURRENT_TIMESTAMP)
        ORDER BY CASE tipo WHEN 'BLOQUEO' THEN 0 WHEN 'REQUIERE_AUTORIZACION' THEN 1 ELSE 2 END
        LIMIT 1
      `, [visitor.id]);
      if (restriction.rows[0]?.tipo === 'BLOQUEO') {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'La persona tiene una restricción de acceso activa. Inspectoría debe revisarla.' });
      }
      const token = randomToken();
      const inserted = await client.query(`
        INSERT INTO visita_preinscripciones
          (visitante_id, token_hash, motivo_codigo, motivo_detalle, destino_codigo,
           persona_contactada, entidad_externa_id, categoria, valida_desde, valida_hasta,
           usos_maximos, observaciones, creado_por)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        RETURNING id, estado, categoria, valida_desde, valida_hasta, usos_maximos
      `, [visitor.id, hashToken(token), motive, clean(req.body?.motivo_detalle, 500) || null,
        destination, host, positiveId(req.body?.entidad_externa_id), category, start.toISOString(), end.toISOString(),
        Math.min(Math.max(Number(req.body?.usos_maximos) || 1, 1), 10), clean(req.body?.observaciones, 500) || null, req.user.id]);
      await audit(insertarAudit, client, req, { accion: 'CREAR_PREINSCRIPCION_VISITA', entidad: 'visita_preinscripcion', entidad_id: inserted.rows[0].id, detalle: { categoria: category, valida_desde: start.toISOString(), valida_hasta: end.toISOString(), visitante_id: visitor.id } });
      await client.query('COMMIT');
      res.status(201).json({ ...inserted.rows[0], qr_payload: `LDSM:VISITA:${token}` });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[visitas:preinscripciones:crear]', error.message);
      res.status(error.status || 500).json({ message: error.status ? error.message : 'No fue posible crear la preinscripción.' });
    } finally {
      client.release();
    }
  });

  router.post('/preinscripciones/validar', verifyAnyPermission(['visits.register', 'visits.preregistrations.manage']), async (req, res) => {
    const token = normalizeToken(req.body?.token);
    if (token.length < 20) return res.status(400).json({ message: 'El código de visita no es válido.' });
    try {
      const result = await pool.query(`
        SELECT p.id, p.estado, p.categoria, p.valida_desde, p.valida_hasta, p.usos_maximos,
               p.usos_realizados, p.motivo_codigo, p.destino_codigo, p.persona_contactada,
               p.observaciones, v.id AS visitante_id, v.nombre_completo, v.tipo_documento,
               v.documento_numero,
               COALESCE(jsonb_agg(jsonb_build_object('tipo', r.tipo, 'motivo', r.motivo))
                 FILTER (WHERE r.id IS NOT NULL), '[]'::jsonb) AS restricciones
        FROM visita_preinscripciones p
        JOIN visitantes v ON v.id = p.visitante_id
        LEFT JOIN visita_restricciones_acceso r ON r.visitante_id = v.id AND r.activo = true
          AND r.vigente_desde <= CURRENT_TIMESTAMP
          AND (r.vigente_hasta IS NULL OR r.vigente_hasta >= CURRENT_TIMESTAMP)
        WHERE p.token_hash = $1
        GROUP BY p.id, v.id
      `, [hashToken(token)]);
      if (!result.rows.length) return res.status(404).json({ message: 'El código no existe o no pertenece a este sistema.' });
      const row = result.rows[0];
      const now = Date.now();
      const usable = row.estado === 'ESPERADA' && new Date(row.valida_desde).getTime() <= now
        && new Date(row.valida_hasta).getTime() >= now && Number(row.usos_realizados) < Number(row.usos_maximos);
      res.json({ ...row, token_hash: undefined, documento_numero: undefined,
        documento_mostrado: maskDocument(row.tipo_documento, row.documento_numero), utilizable: usable });
    } catch (error) {
      console.error('[visitas:preinscripciones:validar]', error.message);
      res.status(500).json({ message: 'No fue posible validar el código de visita.' });
    }
  });

  router.post('/preinscripciones/ingresar', verifyPermission('visits.register'), async (req, res) => {
    const token = normalizeToken(req.body?.token);
    if (token.length < 20) return res.status(400).json({ message: 'El código de visita no es válido.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(`
        SELECT * FROM visita_preinscripciones WHERE token_hash = $1 FOR UPDATE
      `, [hashToken(token)]);
      if (!result.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'El código no existe o ya no está disponible.' });
      }
      const pre = result.rows[0];
      if (pre.estado !== 'ESPERADA' || new Date(pre.valida_desde) > new Date()
          || new Date(pre.valida_hasta) < new Date() || pre.usos_realizados >= pre.usos_maximos) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'La preinscripción todavía no está vigente, venció o ya fue utilizada.' });
      }
      const blocked = await client.query(`SELECT 1 FROM visita_restricciones_acceso
        WHERE visitante_id = $1 AND tipo = 'BLOQUEO' AND activo = true
          AND vigente_desde <= CURRENT_TIMESTAMP AND (vigente_hasta IS NULL OR vigente_hasta >= CURRENT_TIMESTAMP)`, [pre.visitante_id]);
      if (blocked.rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'Existe una restricción de acceso. Inspectoría debe resolverla.' });
      }
      const active = await client.query("SELECT id FROM visitas WHERE visitante_id = $1 AND estado = 'DENTRO' FOR UPDATE", [pre.visitante_id]);
      if (active.rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'La persona ya se encuentra dentro del establecimiento.' });
      }
      const inserted = await client.query(`
        INSERT INTO visitas
          (visitante_id, motivo_codigo, motivo_detalle, destino_codigo, persona_contactada,
           observaciones, origen, registrado_por, preinscripcion_id, entidad_externa_id,
           categoria, salida_esperada_en)
        VALUES ($1,$2,$3,$4,$5,$6,'LECTOR',$7,$8,$9,$10,$11)
        RETURNING id, ingreso_en
      `, [pre.visitante_id, pre.motivo_codigo, pre.motivo_detalle, pre.destino_codigo,
        pre.persona_contactada, pre.observaciones, req.user.id, pre.id, pre.entidad_externa_id,
        pre.categoria, pre.valida_hasta]);
      await client.query(`UPDATE visita_preinscripciones SET usos_realizados = usos_realizados + 1,
        estado = CASE WHEN usos_realizados + 1 >= usos_maximos THEN 'UTILIZADA' ELSE estado END,
        visita_id = $2 WHERE id = $1`, [pre.id, inserted.rows[0].id]);
      await client.query(`INSERT INTO visita_eventos (visita_id, accion, detalle, realizado_por)
        VALUES ($1, 'REGISTRAR_ENTRADA', $2, $3)`, [inserted.rows[0].id, JSON.stringify({ origen: 'PREINSCRIPCION', preinscripcion_id: pre.id }), req.user.id]);
      await audit(insertarAudit, client, req, { accion: 'INGRESAR_VISITA_PREINSCRITA', entidad: 'visita', entidad_id: inserted.rows[0].id, detalle: { preinscripcion_id: pre.id } });
      await client.query('COMMIT');
      res.status(201).json({ id: inserted.rows[0].id, ingreso_en: inserted.rows[0].ingreso_en, estado: 'DENTRO' });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[visitas:preinscripciones:ingresar]', error.message);
      res.status(500).json({ message: 'No fue posible registrar la entrada preinscrita.' });
    } finally {
      client.release();
    }
  });

  router.patch('/preinscripciones/:id/cancelar', verifyPermission('visits.preregistrations.manage'), async (req, res) => {
    const id = positiveId(req.params.id);
    if (!id) return res.status(400).json({ message: 'La preinscripción indicada no es válida.' });
    try {
      const result = await pool.query(`UPDATE visita_preinscripciones SET estado = 'CANCELADA',
        cancelado_por = $2, cancelado_en = CURRENT_TIMESTAMP
        WHERE id = $1 AND estado = 'ESPERADA' RETURNING id`, [id, req.user.id]);
      if (!result.rows.length) return res.status(409).json({ message: 'La preinscripción ya no puede cancelarse.' });
      await audit(insertarAudit, pool, req, { accion: 'CANCELAR_PREINSCRIPCION_VISITA', entidad: 'visita_preinscripcion', entidad_id: id, detalle: {} });
      res.json({ message: 'Preinscripción cancelada con trazabilidad.' });
    } catch (error) {
      console.error('[visitas:preinscripciones:cancelar]', error.message);
      res.status(500).json({ message: 'No fue posible cancelar la preinscripción.' });
    }
  });

  router.get('/restricciones-acceso', verifyPermission('visits.restrictions.manage'), async (req, res) => {
    const query = clean(req.query?.q, 120);
    try {
      const result = await pool.query(`
        SELECT r.*, v.nombre_completo, v.tipo_documento, v.documento_numero
        FROM visita_restricciones_acceso r JOIN visitantes v ON v.id = r.visitante_id
        WHERE ($1 = '' OR v.nombre_completo ILIKE '%' || $1 || '%' OR v.documento_numero ILIKE '%' || $1 || '%')
        ORDER BY r.activo DESC, r.creado_en DESC LIMIT 300
      `, [query]);
      res.json(result.rows.map((row) => ({ ...row, documento_numero: undefined, documento_mostrado: maskDocument(row.tipo_documento, row.documento_numero) })));
    } catch (error) {
      console.error('[visitas:restricciones:listar]', error.message);
      res.status(500).json({ message: 'No fue posible listar las restricciones.' });
    }
  });

  router.post('/restricciones-acceso', verifyPermission('visits.restrictions.manage'), async (req, res) => {
    const visitorId = positiveId(req.body?.visitante_id);
    const type = enumValue(req.body?.tipo, ['ALERTA', 'REQUIERE_AUTORIZACION', 'BLOQUEO']);
    const reason = clean(req.body?.motivo, 500);
    if (!visitorId || !type || reason.length < 8) return res.status(400).json({ message: 'Completa la persona, tipo y motivo de la restricción.' });
    try {
      const result = await pool.query(`INSERT INTO visita_restricciones_acceso
        (visitante_id, tipo, motivo, vigente_desde, vigente_hasta, creado_por)
        VALUES ($1,$2,$3,COALESCE($4::timestamptz,CURRENT_TIMESTAMP),$5,$6) RETURNING *`,
      [visitorId, type, reason, req.body?.vigente_desde || null, req.body?.vigente_hasta || null, req.user.id]);
      await audit(insertarAudit, pool, req, { accion: 'CREAR_RESTRICCION_VISITA', entidad: 'visita_restriccion', entidad_id: result.rows[0].id, detalle: { visitante_id: visitorId, tipo: type, motivo: reason } });
      res.status(201).json(result.rows[0]);
    } catch (error) {
      if (error.code === '23503') return res.status(404).json({ message: 'La persona visitante no existe.' });
      console.error('[visitas:restricciones:crear]', error.message);
      res.status(500).json({ message: 'No fue posible registrar la restricción.' });
    }
  });

  router.patch('/restricciones-acceso/:id/desactivar', verifyPermission('visits.restrictions.manage'), async (req, res) => {
    const id = positiveId(req.params.id);
    const reason = clean(req.body?.motivo, 500);
    if (!id || reason.length < 8) return res.status(400).json({ message: 'Indica el motivo de la desactivación.' });
    try {
      const result = await pool.query(`UPDATE visita_restricciones_acceso SET activo = false,
        desactivado_por = $2, desactivado_en = CURRENT_TIMESTAMP WHERE id = $1 AND activo = true RETURNING id`, [id, req.user.id]);
      if (!result.rows.length) return res.status(404).json({ message: 'La restricción no existe o ya está desactivada.' });
      await audit(insertarAudit, pool, req, { accion: 'DESACTIVAR_RESTRICCION_VISITA', entidad: 'visita_restriccion', entidad_id: id, detalle: { motivo: reason } });
      res.json({ message: 'Restricción desactivada con trazabilidad.' });
    } catch (error) {
      console.error('[visitas:restricciones:desactivar]', error.message);
      res.status(500).json({ message: 'No fue posible desactivar la restricción.' });
    }
  });

  router.get('/encomiendas', verifyPermission('visits.deliveries.manage'), async (req, res) => {
    const state = enumValue(req.query?.estado, ['RECIBIDA', 'ENTREGADA', 'RECHAZADA', 'CANCELADA']);
    try {
      const result = await pool.query(`SELECT e.*, x.nombre AS entidad_nombre,
        ur.nombre AS recibido_por_nombre, ue.nombre AS entregado_por_nombre
        FROM visita_encomiendas e
        LEFT JOIN visita_entidades_externas x ON x.id = e.entidad_externa_id
        LEFT JOIN usuarios ur ON ur.id = e.recibido_por LEFT JOIN usuarios ue ON ue.id = e.entregado_por
        WHERE ($1::text IS NULL OR e.estado = $1) ORDER BY e.recibido_en DESC LIMIT 300`, [state]);
      res.json(result.rows);
    } catch (error) {
      console.error('[visitas:encomiendas:listar]', error.message);
      res.status(500).json({ message: 'No fue posible listar las entregas.' });
    }
  });

  router.post('/encomiendas', verifyPermission('visits.deliveries.manage'), async (req, res) => {
    const sender = clean(req.body?.remitente, 160);
    const recipient = clean(req.body?.destinatario, 160);
    const description = clean(req.body?.descripcion, 500);
    if (sender.length < 3 || recipient.length < 3 || description.length < 3) return res.status(400).json({ message: 'Completa remitente, destinatario y descripción.' });
    try {
      const result = await pool.query(`INSERT INTO visita_encomiendas
        (tipo, entidad_externa_id, remitente, destinatario, descripcion, referencia, recibido_por, observaciones)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [enumValue(req.body?.tipo, ['ENCOMIENDA', 'ENTREGA'], 'ENCOMIENDA'), positiveId(req.body?.entidad_externa_id),
        sender, recipient, description, clean(req.body?.referencia, 100) || null, req.user.id, clean(req.body?.observaciones, 500) || null]);
      await audit(insertarAudit, pool, req, { accion: 'RECIBIR_ENCOMIENDA', entidad: 'visita_encomienda', entidad_id: result.rows[0].id, detalle: { destinatario: recipient } });
      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error('[visitas:encomiendas:crear]', error.message);
      res.status(500).json({ message: 'No fue posible registrar la entrega.' });
    }
  });

  router.patch('/encomiendas/:id/entregar', verifyPermission('visits.deliveries.manage'), async (req, res) => {
    const id = positiveId(req.params.id);
    if (!id) return res.status(400).json({ message: 'La entrega indicada no es válida.' });
    try {
      const result = await pool.query(`UPDATE visita_encomiendas SET estado = 'ENTREGADA',
        entregado_por = $2, entregado_en = CURRENT_TIMESTAMP,
        observaciones = COALESCE($3, observaciones) WHERE id = $1 AND estado = 'RECIBIDA' RETURNING *`,
      [id, req.user.id, clean(req.body?.observaciones, 500) || null]);
      if (!result.rows.length) return res.status(409).json({ message: 'La encomienda ya no está pendiente.' });
      await audit(insertarAudit, pool, req, { accion: 'ENTREGAR_ENCOMIENDA', entidad: 'visita_encomienda', entidad_id: id, detalle: {} });
      res.json(result.rows[0]);
    } catch (error) {
      console.error('[visitas:encomiendas:entregar]', error.message);
      res.status(500).json({ message: 'No fue posible confirmar la entrega.' });
    }
  });

  router.get('/permanencias-excedidas', verifyAnyPermission(['visits.view', 'visits.register', 'visits.preregistrations.manage']), async (req, res) => {
    try {
      const result = await pool.query(`SELECT v.id, v.ingreso_en, v.salida_esperada_en, v.categoria,
        x.id AS visitante_id, x.nombre_completo, x.tipo_documento, x.documento_numero,
        m.nombre AS motivo_nombre, d.nombre AS destino_nombre, v.persona_contactada,
        GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP-v.salida_esperada_en))/60))::int AS minutos_excedidos
        FROM visitas v JOIN visitantes x ON x.id=v.visitante_id
        JOIN visita_motivos m ON m.codigo=v.motivo_codigo
        JOIN visita_destinos d ON d.codigo=v.destino_codigo
        WHERE v.estado='DENTRO' AND v.salida_esperada_en IS NOT NULL
          AND v.salida_esperada_en<CURRENT_TIMESTAMP
        ORDER BY v.salida_esperada_en, x.nombre_completo LIMIT 300`);
      res.json(result.rows.map((row) => ({
        ...row,
        documento_numero: undefined,
        documento_mostrado: maskDocument(row.tipo_documento, row.documento_numero)
      })));
    } catch (error) {
      console.error('[visitas:permanencias-excedidas]', error.message);
      res.status(500).json({ message: 'No fue posible listar las permanencias excedidas.' });
    }
  });

  router.get('/visitantes-frecuentes', verifyAnyPermission(['visits.view', 'visits.register', 'visits.settings']), async (req, res) => {
    const query = clean(req.query?.q, 120);
    try {
      const result = await pool.query(`SELECT v.id,v.tipo_documento,v.documento_numero,v.nombre_completo,
        v.telefono,v.frecuente,e.nombre AS entidad_nombre,COUNT(x.id)::int AS total_visitas,MAX(x.ingreso_en) AS ultima_visita
        FROM visitantes v LEFT JOIN visita_entidades_externas e ON e.id=v.entidad_externa_id
        LEFT JOIN visitas x ON x.visitante_id=v.id
        WHERE v.frecuente=true AND ($1='' OR v.nombre_completo ILIKE '%'||$1||'%'
          OR v.documento_numero ILIKE '%'||$1||'%')
        GROUP BY v.id,e.nombre ORDER BY v.nombre_completo LIMIT 200`, [query]);
      res.json(result.rows.map((row) => ({ ...row, documento_mostrado: maskDocument(row.tipo_documento, row.documento_numero) })));
    } catch (error) {
      res.status(500).json({ message: 'No fue posible listar las personas frecuentes.' });
    }
  });

  router.get('/visitantes-operativos', verifyAnyPermission(['visits.restrictions.manage', 'visits.settings']), async (req, res) => {
    const query = clean(req.query?.q, 120);
    if (query.length < 2) return res.json([]);
    try {
      const result = await pool.query(`SELECT v.id,v.tipo_documento,v.documento_numero,v.nombre_completo,
        v.telefono,v.frecuente,e.nombre AS entidad_nombre,COUNT(x.id)::int AS total_visitas
        FROM visitantes v LEFT JOIN visita_entidades_externas e ON e.id=v.entidad_externa_id
        LEFT JOIN visitas x ON x.visitante_id=v.id
        WHERE v.nombre_completo ILIKE '%'||$1||'%' OR v.documento_numero ILIKE '%'||$1||'%'
        GROUP BY v.id,e.nombre ORDER BY v.nombre_completo LIMIT 30`, [query]);
      res.json(result.rows.map((row) => ({ ...row, documento_mostrado: maskDocument(row.tipo_documento, row.documento_numero) })));
    } catch (error) {
      res.status(500).json({ message: 'No fue posible buscar a la persona visitante.' });
    }
  });

  router.patch('/visitantes/:id/operacion', verifyPermission('visits.settings'), async (req, res) => {
    const id = positiveId(req.params.id);
    if (!id) return res.status(400).json({ message: 'La persona indicada no es válida.' });
    try {
      const result = await pool.query(`UPDATE visitantes SET frecuente=COALESCE($2,frecuente),
        entidad_externa_id=$3,actualizado_por=$4,actualizado_en=CURRENT_TIMESTAMP WHERE id=$1
        RETURNING id,nombre_completo,frecuente,entidad_externa_id`, [id,
        typeof req.body?.frecuente === 'boolean' ? req.body.frecuente : null,
        positiveId(req.body?.entidad_externa_id), req.user.id]);
      if (!result.rows.length) return res.status(404).json({ message: 'La persona visitante no existe.' });
      await audit(insertarAudit, pool, req, { accion: 'ACTUALIZAR_VISITANTE_OPERATIVO', entidad: 'visitante', entidad_id: id, detalle: { frecuente: result.rows[0].frecuente, entidad_externa_id: result.rows[0].entidad_externa_id } });
      res.json(result.rows[0]);
    } catch (error) {
      res.status(500).json({ message: 'No fue posible actualizar la ficha operativa.' });
    }
  });

  router.get('/vehiculos', verifyPermission('visits.vehicles.manage'), async (req, res) => {
    const query = clean(req.query?.q, 80);
    try {
      const result = await pool.query(`SELECT v.*,x.nombre_completo AS visitante_nombre,e.nombre AS entidad_nombre,
        COUNT(m.visita_id)::int AS total_movimientos,MAX(m.registrado_en) AS ultimo_movimiento
        FROM visita_vehiculos v LEFT JOIN visitantes x ON x.id=v.visitante_id
        LEFT JOIN visita_entidades_externas e ON e.id=v.entidad_externa_id
        LEFT JOIN visita_vehiculo_movimientos m ON m.vehiculo_id=v.id
        WHERE ($1='' OR v.patente ILIKE '%'||$1||'%' OR COALESCE(v.marca,'') ILIKE '%'||$1||'%'
          OR COALESCE(e.nombre,'') ILIKE '%'||$1||'%')
        GROUP BY v.id,x.nombre_completo,e.nombre ORDER BY v.activo DESC,v.patente LIMIT 250`, [query]);
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ message: 'No fue posible listar los vehículos.' });
    }
  });

  router.post('/vehiculos', verifyPermission('visits.vehicles.manage'), async (req, res) => {
    const license = clean(req.body?.patente, 16).toUpperCase().replace(/[^A-Z0-9-]/g, '');
    const type = enumValue(req.body?.tipo, ['AUTOMOVIL', 'CAMIONETA', 'CAMION', 'MOTOCICLETA', 'OTRO'], 'OTRO');
    if (license.length < 4) return res.status(400).json({ message: 'Indica una patente válida.' });
    try {
      const result = await pool.query(`INSERT INTO visita_vehiculos
        (patente,tipo,marca,modelo,color,visitante_id,entidad_externa_id,creado_por)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [license,type,
        clean(req.body?.marca,60)||null,clean(req.body?.modelo,60)||null,clean(req.body?.color,40)||null,
        positiveId(req.body?.visitante_id),positiveId(req.body?.entidad_externa_id),req.user.id]);
      await audit(insertarAudit, pool, req, { accion: 'CREAR_VEHICULO_VISITA', entidad: 'visita_vehiculo', entidad_id: result.rows[0].id, detalle: { patente: license, tipo: type } });
      res.status(201).json(result.rows[0]);
    } catch (error) {
      if (error.code === '23505') return res.status(409).json({ message: 'Ya existe un vehículo con esa patente.' });
      if (error.code === '23503') return res.status(400).json({ message: 'La persona o entidad vinculada no existe.' });
      res.status(500).json({ message: 'No fue posible registrar el vehículo.' });
    }
  });

  router.post('/visitas/:id/vehiculos/:vehiculoId', verifyPermission('visits.vehicles.manage'), async (req, res) => {
    const visitId = positiveId(req.params.id);
    const vehicleId = positiveId(req.params.vehiculoId);
    if (!visitId || !vehicleId) return res.status(400).json({ message: 'La visita o vehículo no es válido.' });
    try {
      const result = await pool.query(`INSERT INTO visita_vehiculo_movimientos (visita_id,vehiculo_id,registrado_por)
        VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING *`, [visitId,vehicleId,req.user.id]);
      if (!result.rows.length) return res.status(409).json({ message: 'El vehículo ya está vinculado con esta visita.' });
      await audit(insertarAudit, pool, req, { accion: 'VINCULAR_VEHICULO_VISITA', entidad: 'visita', entidad_id: visitId, detalle: { vehiculo_id: vehicleId } });
      res.status(201).json(result.rows[0]);
    } catch (error) {
      if (error.code === '23503') return res.status(404).json({ message: 'La visita o vehículo no existe.' });
      res.status(500).json({ message: 'No fue posible vincular el vehículo.' });
    }
  });

  router.get('/emergencias/actual', verifyPermission('visits.emergency.view'), async (req, res) => {
    try {
      const event = await pool.query(`SELECT e.*, p.nombre AS punto_reunion_nombre
        FROM visita_emergencias e LEFT JOIN visita_puntos_reunion p ON p.id = e.punto_reunion_id
        WHERE e.estado = 'ACTIVA' LIMIT 1`);
      if (!event.rows.length) return res.json({ emergencia: null, personas: [] });
      const people = await pool.query(`SELECT ep.estado, ep.verificado_en, ep.observaciones,
        v.id AS visita_id, v.ingreso_en, x.nombre_completo, x.tipo_documento, x.documento_numero,
        d.nombre AS destino_nombre, v.persona_contactada, p.nombre AS punto_reunion_nombre
        FROM visita_emergencia_presentes ep JOIN visitas v ON v.id = ep.visita_id
        JOIN visitantes x ON x.id = v.visitante_id JOIN visita_destinos d ON d.codigo = v.destino_codigo
        LEFT JOIN visita_puntos_reunion p ON p.id = ep.punto_reunion_id
        WHERE ep.emergencia_id = $1 ORDER BY ep.estado, x.nombre_completo`, [event.rows[0].id]);
      res.json({ emergencia: event.rows[0], personas: people.rows.map((row) => ({ ...row, documento_numero: undefined, documento_mostrado: maskDocument(row.tipo_documento, row.documento_numero) })) });
    } catch (error) {
      console.error('[visitas:emergencias:actual]', error.message);
      res.status(500).json({ message: 'No fue posible obtener la ocupación de emergencia.' });
    }
  });

  router.get('/puntos-reunion', verifyPermission('visits.emergency.view'), async (req, res) => {
    try {
      const result = await pool.query('SELECT * FROM visita_puntos_reunion WHERE activo = true ORDER BY nombre');
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ message: 'No fue posible listar los puntos de reunión.' });
    }
  });

  router.post('/puntos-reunion', verifyPermission('visits.emergency.manage'), async (req, res) => {
    const code = clean(req.body?.codigo, 40).toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
    const name = clean(req.body?.nombre, 120);
    if (code.length < 2 || name.length < 3) return res.status(400).json({ message: 'Completa el código y nombre del punto de reunión.' });
    try {
      const result = await pool.query(`INSERT INTO visita_puntos_reunion (codigo,nombre,descripcion,creado_por)
        VALUES ($1,$2,$3,$4) ON CONFLICT (codigo) DO UPDATE SET nombre=EXCLUDED.nombre,
        descripcion=EXCLUDED.descripcion, activo=true RETURNING *`, [code, name, clean(req.body?.descripcion, 500) || null, req.user.id]);
      res.status(201).json(result.rows[0]);
    } catch (error) {
      res.status(500).json({ message: 'No fue posible guardar el punto de reunión.' });
    }
  });

  router.post('/emergencias', verifyPermission('visits.emergency.manage'), async (req, res) => {
    const type = enumValue(req.body?.tipo, ['EVACUACION', 'SIMULACRO', 'OTRA']);
    const description = clean(req.body?.descripcion, 500);
    if (!type || description.length < 8) return res.status(400).json({ message: 'Indica el tipo y una descripción de la emergencia.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const active = await client.query("SELECT id FROM visita_emergencias WHERE estado = 'ACTIVA' FOR UPDATE");
      if (active.rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'Ya existe una emergencia activa.' });
      }
      const event = await client.query(`INSERT INTO visita_emergencias
        (tipo,descripcion,punto_reunion_id,iniciada_por) VALUES ($1,$2,$3,$4) RETURNING *`,
      [type, description, positiveId(req.body?.punto_reunion_id), req.user.id]);
      await client.query(`INSERT INTO visita_emergencia_presentes (emergencia_id,visita_id,punto_reunion_id)
        SELECT $1,id,$2 FROM visitas WHERE estado='DENTRO'`, [event.rows[0].id, positiveId(req.body?.punto_reunion_id)]);
      await audit(insertarAudit, client, req, { accion: 'INICIAR_EMERGENCIA_VISITAS', entidad: 'visita_emergencia', entidad_id: event.rows[0].id, detalle: { tipo: type } });
      await client.query('COMMIT');
      res.status(201).json(event.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[visitas:emergencias:crear]', error.message);
      res.status(500).json({ message: 'No fue posible iniciar la emergencia.' });
    } finally { client.release(); }
  });

  router.patch('/emergencias/:id/personas/:visitaId', verifyPermission('visits.emergency.manage'), async (req, res) => {
    const id = positiveId(req.params.id);
    const visitId = positiveId(req.params.visitaId);
    const state = enumValue(req.body?.estado, ['PENDIENTE', 'CONFIRMADO', 'NO_UBICADO', 'SALIO']);
    if (!id || !visitId || !state) return res.status(400).json({ message: 'La verificación indicada no es válida.' });
    try {
      const result = await pool.query(`UPDATE visita_emergencia_presentes SET estado=$3,
        punto_reunion_id=COALESCE($4,punto_reunion_id),verificado_por=$5,verificado_en=CURRENT_TIMESTAMP,
        observaciones=$6 WHERE emergencia_id=$1 AND visita_id=$2 RETURNING *`,
      [id, visitId, state, positiveId(req.body?.punto_reunion_id), req.user.id, clean(req.body?.observaciones, 500) || null]);
      if (!result.rows.length) return res.status(404).json({ message: 'La persona no forma parte del registro de emergencia.' });
      await audit(insertarAudit, pool, req, { accion: 'VERIFICAR_PERSONA_EMERGENCIA', entidad: 'visita_emergencia', entidad_id: id, detalle: { visita_id: visitId, estado: state } });
      res.json(result.rows[0]);
    } catch (error) {
      res.status(500).json({ message: 'No fue posible actualizar la verificación.' });
    }
  });

  router.patch('/emergencias/:id/cerrar', verifyPermission('visits.emergency.manage'), async (req, res) => {
    const id = positiveId(req.params.id);
    const observations = clean(req.body?.observaciones, 500);
    if (!id || observations.length < 8) return res.status(400).json({ message: 'Agrega una observación de cierre.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const pending = await client.query(`SELECT COUNT(*)::int AS total FROM visita_emergencia_presentes
        WHERE emergencia_id=$1 AND estado IN ('PENDIENTE','NO_UBICADO')`, [id]);
      if (pending.rows[0].total > 0 && req.body?.confirmar_pendientes !== true) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: `Todavía hay ${pending.rows[0].total} personas pendientes o no ubicadas. Confirma expresamente el cierre.` });
      }
      const result = await client.query(`UPDATE visita_emergencias SET estado='CERRADA',cerrada_por=$2,
        cerrada_en=CURRENT_TIMESTAMP,observaciones_cierre=$3 WHERE id=$1 AND estado='ACTIVA' RETURNING *`,
      [id, req.user.id, observations]);
      if (!result.rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'La emergencia ya no está activa.' });
      }
      await audit(insertarAudit, client, req, { accion: 'CERRAR_EMERGENCIA_VISITAS', entidad: 'visita_emergencia', entidad_id: id, detalle: { pendientes: pending.rows[0].total, observaciones } });
      await client.query('COMMIT');
      res.json(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(500).json({ message: 'No fue posible cerrar la emergencia.' });
    } finally { client.release(); }
  });

  return router;
};

module.exports = { createVisitsExtendedRouter, hashToken, normalizeToken };
