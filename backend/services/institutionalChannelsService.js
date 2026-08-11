const syncInstitutionalChannels = async (pool, { actorId = null } = {}) => {
  const client = await pool.connect();
  const summary = { channels: 0, memberships: 0, skipped: 0 };
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('canales-institucionales'))");
    const groups = await client.query(`
      SELECT g.codigo, g.nombre, g.descripcion
      FROM seguimiento_grupos_notificacion g
      WHERE g.activo = true
      ORDER BY g.orden, g.nombre
    `);
    for (const group of groups.rows) {
      const members = await client.query(`
        SELECT DISTINCT u.id
        FROM seguimiento_grupo_perfiles gp
        JOIN usuarios u ON u.rol = gp.perfil_codigo
        WHERE gp.grupo_codigo = $1
          AND u.activo = true AND u.eliminado_en IS NULL
        ORDER BY u.id
      `, [group.codigo]);
      if (!members.rowCount) {
        await client.query(`
          UPDATE chat_miembros m
          SET activo = false, retirado_en = CURRENT_TIMESTAMP
          FROM chat_conversaciones c
          WHERE c.id_conversacion = m.id_conversacion
            AND c.codigo_institucional = $1
            AND m.activo = true
        `, [`SEGUIMIENTO_${group.codigo}`]);
        summary.skipped += 1;
        continue;
      }
      const memberIds = members.rows.map((row) => row.id);
      const creatorId = memberIds.includes(Number(actorId)) ? Number(actorId) : memberIds[0];
      const institutionalCode = `SEGUIMIENTO_${group.codigo}`;
      const channel = await client.query(`
        INSERT INTO chat_conversaciones (
          tipo, nombre, descripcion, retencion_dias, creada_por,
          codigo_institucional, grupo_notificacion_codigo
        ) VALUES ('CANAL', $1, $2, 365, $3, $4, $5)
        ON CONFLICT (codigo_institucional)
          WHERE codigo_institucional IS NOT NULL AND activa = true
        DO UPDATE SET nombre = EXCLUDED.nombre,
          descripcion = EXCLUDED.descripcion,
          retencion_dias = 365,
          grupo_notificacion_codigo = EXCLUDED.grupo_notificacion_codigo,
          actualizada_en = CURRENT_TIMESTAMP
        RETURNING id_conversacion, creada_por
      `, [group.nombre, group.descripcion, creatorId, institutionalCode, group.codigo]);
      const conversationId = channel.rows[0].id_conversacion;
      summary.channels += 1;
      await client.query(`
        UPDATE chat_miembros
        SET activo = false, retirado_en = CURRENT_TIMESTAMP
        WHERE id_conversacion = $1 AND activo = true
          AND NOT (usuario_id = ANY($2::int[]))
      `, [conversationId, memberIds]);
      for (const userId of memberIds) {
        const membership = await client.query(`
          INSERT INTO chat_miembros (
            id_conversacion, usuario_id, rol, activo, incorporado_por
          ) VALUES ($1, $2, $3, true, $4)
          ON CONFLICT (id_conversacion, usuario_id) DO UPDATE SET
            activo = true,
            retirado_en = NULL,
            rol = EXCLUDED.rol
          RETURNING usuario_id
        `, [conversationId, userId, userId === creatorId ? 'PROPIETARIO' : 'MIEMBRO', actorId || creatorId]);
        summary.memberships += membership.rowCount;
      }
    }
    await client.query('COMMIT');
    return summary;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const startInstitutionalChannelSyncScheduler = (pool) => {
  const minutes = Math.max(1, Number(process.env.INSTITUTIONAL_CHANNEL_SYNC_MINUTES) || 5);
  const timer = setInterval(() => {
    syncInstitutionalChannels(pool).catch((error) => {
      console.error('[canales-institucionales]', error.message);
    });
  }, minutes * 60 * 1000);
  timer.unref?.();
  return () => clearInterval(timer);
};

module.exports = { syncInstitutionalChannels, startInstitutionalChannelSyncScheduler };
