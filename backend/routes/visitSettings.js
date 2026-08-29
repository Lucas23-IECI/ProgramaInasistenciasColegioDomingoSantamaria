const express = require('express');

const CATALOGS = {
  'motivos-visita': {
    table: 'visita_motivos',
    extraColumn: 'requiere_detalle',
    extraDefault: false
  },
  destinos: {
    table: 'visita_destinos',
    extraColumn: 'requiere_contacto',
    extraDefault: false
  },
  'motivos-retiro': {
    table: 'retiro_motivos',
    extraColumn: 'requiere_detalle',
    extraDefault: false
  },
  parentescos: {
    table: 'tipos_parentesco',
    extraColumn: 'requiere_detalle',
    extraDefault: false
  }
};

const normalizeCode = (value) => String(value || '')
  .trim()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toUpperCase()
  .replace(/[^A-Z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, 40);

const parseCatalogPayload = (body = {}) => ({
  code: normalizeCode(body.codigo || body.nombre),
  name: String(body.nombre || '').trim().replace(/\s+/g, ' ').slice(0, 120),
  active: body.activo !== false,
  order: Number.isInteger(Number(body.orden)) ? Math.max(0, Math.min(9999, Number(body.orden))) : 0,
  extra: Boolean(body.requiere_detalle ?? body.requiere_contacto)
});

const createVisitSettingsRouter = ({
  pool,
  verifyToken,
  verifyPermission,
  insertarAudit,
  getClientIp
}) => {
  const router = express.Router();
  router.use(verifyToken, verifyPermission('visits.settings'));

  router.get('/', async (req, res) => {
    try {
      const [general, ...catalogResults] = await Promise.all([
        pool.query('SELECT * FROM configuracion_visitas ORDER BY id LIMIT 1'),
        ...Object.values(CATALOGS).map((catalog) => pool.query(
          `SELECT codigo, nombre, activo, orden, ${catalog.extraColumn} AS requisito_adicional
           FROM ${catalog.table}
           ORDER BY activo DESC, orden, nombre`
        ))
      ]);
      const catalogs = {};
      Object.keys(CATALOGS).forEach((key, index) => {
        catalogs[key] = catalogResults[index].rows;
      });
      res.json({ general: general.rows[0], catalogs });
    } catch (error) {
      console.error('[configuracion-visitas:consulta]', error.message);
      res.status(500).json({ message: 'No fue posible cargar la configuración de visitas.' });
    }
  });

  router.put('/general', async (req, res) => {
    const closingTime = String(req.body?.hora_cierre || '').trim();
    const maxHours = Number(req.body?.max_horas_visita);
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(closingTime) || !Number.isInteger(maxHours) || maxHours < 1 || maxHours > 24) {
      return res.status(400).json({ message: 'Revisa la hora de cierre y el máximo de horas.' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const before = await client.query('SELECT * FROM configuracion_visitas ORDER BY id LIMIT 1 FOR UPDATE');
      const result = await client.query(`
        UPDATE configuracion_visitas
        SET hora_cierre = $1, max_horas_visita = $2,
            exigir_documento_fisico = $3, permitir_retiro_excepcional = $4,
            actualizado_por = $5, actualizado_en = CURRENT_TIMESTAMP
        WHERE id = $6
        RETURNING *
      `, [
        closingTime,
        maxHours,
        req.body.exigir_documento_fisico !== false,
        req.body.permitir_retiro_excepcional !== false,
        req.user.id,
        before.rows[0].id
      ]);
      await insertarAudit(client, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: 'CONFIGURAR_VISITAS',
        entidad: 'configuracion_visitas',
        entidad_id: result.rows[0].id,
        detalle: { antes: before.rows[0], despues: result.rows[0] },
        ip: getClientIp(req)
      });
      await client.query('COMMIT');
      res.json(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[configuracion-visitas:actualizar]', error.message);
      res.status(500).json({ message: 'No fue posible guardar la configuración.' });
    } finally {
      client.release();
    }
  });

  router.post('/catalogos/:catalogo', async (req, res) => {
    const catalog = CATALOGS[req.params.catalogo];
    const payload = parseCatalogPayload(req.body);
    if (!catalog || payload.code.length < 2 || payload.name.length < 2) {
      return res.status(400).json({ message: 'Selecciona un catálogo válido y completa el código y nombre del elemento.' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(`
        INSERT INTO ${catalog.table} (
          codigo, nombre, activo, orden, ${catalog.extraColumn}, actualizado_por, actualizado_en
        ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
        RETURNING codigo, nombre, activo, orden, ${catalog.extraColumn} AS requisito_adicional
      `, [payload.code, payload.name, payload.active, payload.order, payload.extra, req.user.id]);
      await insertarAudit(client, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: 'CREAR_CATALOGO_VISITAS',
        entidad: req.params.catalogo,
        entidad_id: null,
        detalle: result.rows[0],
        ip: getClientIp(req)
      });
      await client.query('COMMIT');
      res.status(201).json(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') return res.status(409).json({ message: 'Ya existe un elemento con ese código.' });
      console.error('[configuracion-visitas:catalogo:crear]', error.message);
      res.status(500).json({ message: 'No fue posible crear el elemento.' });
    } finally {
      client.release();
    }
  });

  router.put('/catalogos/:catalogo/:codigo', async (req, res) => {
    const catalog = CATALOGS[req.params.catalogo];
    const code = normalizeCode(req.params.codigo);
    const payload = parseCatalogPayload({ ...req.body, codigo: code });
    if (!catalog || !code || payload.name.length < 2) {
      return res.status(400).json({ message: 'Selecciona un elemento válido y completa su código y nombre.' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const before = await client.query(`SELECT * FROM ${catalog.table} WHERE codigo = $1 FOR UPDATE`, [code]);
      if (!before.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'El elemento no existe.' });
      }
      const result = await client.query(`
        UPDATE ${catalog.table}
        SET nombre = $1, activo = $2, orden = $3, ${catalog.extraColumn} = $4,
            actualizado_por = $5, actualizado_en = CURRENT_TIMESTAMP
        WHERE codigo = $6
        RETURNING codigo, nombre, activo, orden, ${catalog.extraColumn} AS requisito_adicional
      `, [payload.name, payload.active, payload.order, payload.extra, req.user.id, code]);
      await insertarAudit(client, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: 'EDITAR_CATALOGO_VISITAS',
        entidad: req.params.catalogo,
        entidad_id: null,
        detalle: { codigo: code, antes: before.rows[0], despues: result.rows[0] },
        ip: getClientIp(req)
      });
      await client.query('COMMIT');
      res.json(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[configuracion-visitas:catalogo:editar]', error.message);
      res.status(500).json({ message: 'No fue posible actualizar el elemento.' });
    } finally {
      client.release();
    }
  });

  return router;
};

module.exports = { CATALOGS, createVisitSettingsRouter, normalizeCode };
