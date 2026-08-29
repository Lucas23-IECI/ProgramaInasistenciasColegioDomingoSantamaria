const registerAuditRoutes = ({ app, pool, verifyToken, verifyPermission, isIsoDate, validateDateRange }) => {
  app.get('/api/audit', verifyToken, verifyPermission('audit.view'), async (req, res) => {
    const {
      accion,
      usuario_correo,
      cuenta_id,
      perfil_codigo,
      cuenta_perfil_id,
      relacion = 'todas',
      desde,
      hasta,
      page = '1',
      limit = '20',
      exportar = '0'
    } = req.query;

    if ((desde && !isIsoDate(desde)) || (hasta && !isIsoDate(hasta))) {
      return res.status(400).json({ message: 'Las fechas de auditoría no son válidas.' });
    }
    if (desde && hasta) {
      const dateRange = validateDateRange(desde, hasta, { maxDays: 3650 });
      if (dateRange.error) return res.status(400).json({ message: dateRange.error });
    }
    if (!['todas', 'realizada', 'sobre_cuenta'].includes(relacion)) {
      return res.status(400).json({ message: 'El tipo de actividad solicitado no es válido.' });
    }
    if (cuenta_id && perfil_codigo) {
      return res.status(400).json({ message: 'Selecciona una cuenta o un perfil, no ambos a la vez.' });
    }
    if (!cuenta_id && relacion !== 'todas') {
      return res.status(400).json({ message: 'El filtro de relación requiere una cuenta seleccionada.' });
    }
    if (cuenta_perfil_id && !perfil_codigo) {
      return res.status(400).json({ message: 'El filtro de cuenta requiere un perfil seleccionado.' });
    }

    const pageNum = Math.max(1, Number.parseInt(page, 10) || 1);
    const isExport = exportar === '1';
    const requestedLimit = Number.parseInt(limit, 10) || 20;
    const limitNum = isExport ? Math.min(10000, Math.max(1, requestedLimit)) : Math.min(100, Math.max(1, requestedLimit));
    const offset = isExport ? 0 : (pageNum - 1) * limitNum;
    const conditions = [];
    const params = [];
    let idx = 1;
    let subject = null;
    let profileSubject = null;
    let profileAccounts = [];
    let relationshipSelection = 'NULL::text';

    try {
      if (cuenta_id) {
        const accountId = Number.parseInt(cuenta_id, 10);
        if (!Number.isInteger(accountId) || accountId <= 0) return res.status(400).json({ message: 'La cuenta indicada no es válida.' });
        const subjectRes = await pool.query(`
          SELECT u.id, u.correo, u.nombre, u.cargo, u.rol, u.activo, u.eliminado_en,
                 p.nombre AS profile_name
          FROM usuarios u
          LEFT JOIN perfiles_acceso p ON p.codigo = u.rol
          WHERE u.id = $1
        `, [accountId]);
        if (!subjectRes.rows.length) return res.status(404).json({ message: 'La cuenta indicada no existe.' });
        subject = subjectRes.rows[0];
        const accountParam = idx;
        if (relacion === 'realizada') {
          conditions.push(`a.usuario_id = $${idx}`);
        } else if (relacion === 'sobre_cuenta') {
          conditions.push(`(a.entidad = 'usuario' AND a.entidad_id = $${idx} AND a.usuario_id IS DISTINCT FROM $${idx})`);
        } else {
          conditions.push(`(a.usuario_id = $${idx} OR (a.entidad = 'usuario' AND a.entidad_id = $${idx}))`);
        }
        params.push(accountId);
        idx += 1;
        relationshipSelection = `CASE WHEN a.usuario_id = $${accountParam} THEN 'realizada' ELSE 'sobre_cuenta' END`;
      }

      if (perfil_codigo) {
        const profileCode = String(perfil_codigo).trim();
        const profileRes = await pool.query(`
          SELECT p.codigo, p.nombre, p.descripcion, p.activo, p.sistema,
                 COUNT(DISTINCT u.id) FILTER (WHERE u.eliminado_en IS NULL)::int AS account_count,
                 COUNT(DISTINCT u.id) FILTER (WHERE u.eliminado_en IS NULL AND u.activo)::int AS active_account_count,
                 COUNT(DISTINCT pr.permiso_codigo)::int AS permission_count
          FROM perfiles_acceso p
          LEFT JOIN usuarios u ON u.rol = p.codigo
          LEFT JOIN permisos_rol pr ON pr.rol = p.codigo
          WHERE p.codigo = $1
          GROUP BY p.codigo, p.nombre, p.descripcion, p.activo, p.sistema
        `, [profileCode]);
        if (!profileRes.rows.length) return res.status(404).json({ message: 'El perfil indicado no existe.' });
        profileSubject = profileRes.rows[0];
        const accountsRes = await pool.query(`
          SELECT id, nombre, correo, cargo, activo
          FROM usuarios
          WHERE rol = $1 AND eliminado_en IS NULL
          ORDER BY activo DESC, LOWER(COALESCE(nombre, correo)), id
        `, [profileCode]);
        profileAccounts = accountsRes.rows;

        const profileParam = idx;
        conditions.push(`(
          a.perfil_codigo_snapshot = $${idx}
          OR (a.entidad = 'perfil_acceso' AND a.detalle->>'codigo' = $${idx})
        )`);
        params.push(profileCode);
        idx += 1;
        relationshipSelection = `CASE
          WHEN a.entidad = 'perfil_acceso' AND a.detalle->>'codigo' = $${profileParam} THEN 'sobre_perfil'
          ELSE 'realizada_por_cuenta'
        END`;

        if (cuenta_perfil_id) {
          const profileAccountId = Number.parseInt(cuenta_perfil_id, 10);
          if (!Number.isInteger(profileAccountId) || profileAccountId <= 0) return res.status(400).json({ message: 'La cuenta indicada no es válida.' });
          if (!profileAccounts.some((account) => account.id === profileAccountId)) {
            return res.status(400).json({ message: 'La cuenta seleccionada no pertenece a este perfil.' });
          }
          conditions.push(`a.usuario_id = $${idx++}`);
          params.push(profileAccountId);
        }
      }

      if (accion) { conditions.push(`a.accion = $${idx++}`); params.push(String(accion).trim()); }
      if (usuario_correo) { conditions.push(`a.usuario_correo ILIKE $${idx++}`); params.push(`%${String(usuario_correo).trim()}%`); }
      if (desde) { conditions.push(`a.fecha >= $${idx++}`); params.push(desde); }
      if (hasta) { conditions.push(`a.fecha < ($${idx++}::date + interval '1 day')`); params.push(hasta); }

      const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const countRes = await pool.query(`SELECT COUNT(*) FROM audit_log a ${whereClause}`, params);
      const total = Number.parseInt(countRes.rows[0].count, 10);
      const dataRes = await pool.query(`
        SELECT a.id, a.usuario_id, a.usuario_correo,
               COALESCE(u.nombre, a.usuario_correo) AS usuario_nombre,
               a.accion, a.entidad, a.entidad_id, a.detalle, a.ip, a.fecha,
               a.perfil_codigo_snapshot, a.perfil_nombre_snapshot,
               ${relationshipSelection} AS relacion_cuenta
        FROM audit_log a
        LEFT JOIN usuarios u ON u.id = a.usuario_id
        ${whereClause}
        ORDER BY a.fecha DESC, a.id DESC
        LIMIT $${idx++} OFFSET $${idx++}
      `, [...params, limitNum, offset]);

      res.json({
        total,
        page: isExport ? 1 : pageNum,
        pages: isExport ? 1 : Math.ceil(total / limitNum) || 1,
        rows: dataRes.rows,
        subject,
        profile: profileSubject,
        profile_accounts: profileAccounts,
        truncated: isExport && total > limitNum
      });
    } catch (err) {
      console.error('[audit:list]', err.message);
      res.status(500).json({ message: 'No fue posible cargar la actividad de auditoría.' });
    }
  });
};

module.exports = { registerAuditRoutes };
