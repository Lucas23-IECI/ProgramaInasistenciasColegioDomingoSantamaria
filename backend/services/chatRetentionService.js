const { removeStoredFile } = require('./documentService');

const eligibleMessagesQuery = `
  SELECT msg.id_mensaje, msg.id_conversacion, a.id_adjunto, d.id_documento, d.nombre_almacenado
  FROM chat_mensajes msg
  JOIN chat_conversaciones c ON c.id_conversacion = msg.id_conversacion
  JOIN chat_configuracion cfg ON cfg.id_configuracion = 1
  LEFT JOIN chat_adjuntos a ON a.id_mensaje = msg.id_mensaje
  LEFT JOIN justification_documents d ON d.id_documento = a.id_documento
  WHERE msg.eliminado_en IS NULL
    AND msg.enviado_en < CURRENT_TIMESTAMP -
      (COALESCE(c.retencion_dias, cfg.retencion_predeterminada_dias) * INTERVAL '1 day')
    AND (
      cfg.preservar_fijados = false OR NOT EXISTS (
        SELECT 1 FROM chat_mensajes_fijados f WHERE f.id_mensaje = msg.id_mensaje
      )
    )
`;

const previewChatRetention = async (queryable) => {
  const result = await queryable.query(`
    SELECT COUNT(DISTINCT eligible.id_mensaje)::int AS mensajes,
           COUNT(DISTINCT eligible.id_documento)::int AS archivos,
           COUNT(DISTINCT eligible.id_conversacion)::int AS conversaciones
    FROM (${eligibleMessagesQuery}) eligible
  `);
  return result.rows[0];
};

const runChatRetention = async (pool, { actorId = null } = {}) => {
  const client = await pool.connect();
  let storedFiles = [];
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('retencion-chat-institucional'))");
    const configuration = await client.query('SELECT * FROM chat_configuracion WHERE id_configuracion = 1 FOR UPDATE');
    if (!configuration.rows[0]?.retencion_activa) {
      await client.query('ROLLBACK');
      return { applied: false, reason: 'RETENTION_DISABLED', mensajes: 0, archivos: 0, conversaciones: 0 };
    }
    const eligible = await client.query(`${eligibleMessagesQuery} FOR UPDATE OF msg`);
    const messageIds = [...new Set(eligible.rows.map((row) => Number(row.id_mensaje)))];
    const documentIds = [...new Set(eligible.rows.map((row) => Number(row.id_documento)).filter(Boolean))];
    storedFiles = [...new Set(eligible.rows.map((row) => row.nombre_almacenado).filter(Boolean))];
    const conversationIds = [...new Set(eligible.rows.map((row) => Number(row.id_conversacion)))];
    if (messageIds.length) {
      await client.query('DELETE FROM chat_mensajes_fijados WHERE id_mensaje = ANY($1::bigint[])', [messageIds]);
      await client.query('DELETE FROM chat_adjuntos WHERE id_mensaje = ANY($1::bigint[])', [messageIds]);
      if (documentIds.length) {
        await client.query('DELETE FROM justification_documents WHERE id_documento = ANY($1::int[])', [documentIds]);
      }
      await client.query(`
        UPDATE chat_mensajes
        SET contenido = '[Mensaje retirado por política de retención]',
            eliminado_en = CURRENT_TIMESTAMP, eliminado_por = $2,
            motivo_eliminacion = 'Política institucional de retención'
        WHERE id_mensaje = ANY($1::bigint[])
      `, [messageIds, actorId]);
    }
    const summary = {
      applied: true,
      mensajes: messageIds.length,
      archivos: documentIds.length,
      conversaciones: conversationIds.length,
      applied_at: new Date().toISOString()
    };
    await client.query(`
      UPDATE chat_configuracion
      SET ultima_revision_en = CURRENT_TIMESTAMP, ultima_revision_resultado = $1::jsonb
      WHERE id_configuracion = 1
    `, [JSON.stringify(summary)]);
    await client.query('COMMIT');
    for (const storedName of storedFiles) {
      await removeStoredFile(storedName).catch((error) => {
        console.error('[retención chat archivo]', storedName, error.message);
      });
    }
    return summary;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const startChatRetentionScheduler = (pool) => {
  if (String(process.env.CHAT_RETENTION_SCHEDULER_ENABLED || 'true').toLowerCase() === 'false') return () => {};
  let running = false;
  const execute = async () => {
    if (running) return;
    running = true;
    try {
      const due = await pool.query(`
        SELECT retencion_activa,
               ultima_revision_en IS NULL OR ultima_revision_en < CURRENT_TIMESTAMP - INTERVAL '24 hours' AS corresponde
        FROM chat_configuracion WHERE id_configuracion = 1
      `);
      if (due.rows[0]?.retencion_activa && due.rows[0]?.corresponde) {
        const result = await runChatRetention(pool);
        console.log(JSON.stringify({ event: 'retencion_chat', ...result }));
      }
    } catch (error) {
      console.error('[retención automática de chat]', error.message);
    } finally {
      running = false;
    }
  };
  const initial = setTimeout(execute, 45_000);
  const timer = setInterval(execute, 15 * 60_000);
  initial.unref?.();
  timer.unref?.();
  return () => { clearTimeout(initial); clearInterval(timer); };
};

module.exports = { previewChatRetention, runChatRetention, startChatRetentionScheduler };
