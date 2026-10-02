const publishReminder = (realtimeHub, reminder) => {
  realtimeHub?.publishToUsers([reminder.usuario_id], 'institutional-notification', {
    notification_id: reminder.id_notificacion,
    title: reminder.titulo_notificacion,
    detail: reminder.detalle_notificacion,
    priority: 'NORMAL',
    link: `/agenda?evento=${reminder.id_evento}`,
    sender: 'Agenda interna',
    created_at: reminder.creada_en,
    notify: true
  });
};

const runAgendaReminders = async (pool, { realtimeHub } = {}) => {
  const client = await pool.connect();
  let acquired = false;
  try {
    const lock = await client.query("SELECT pg_try_advisory_lock(hashtext('ldsm_agenda_recordatorios')) AS adquirido");
    acquired = Boolean(lock.rows[0]?.adquirido);
    if (!acquired) return { sent: 0, expired: 0 };

    await client.query('BEGIN');
    const expired = await client.query(`
      UPDATE agenda_recordatorios r
      SET estado = 'FALLIDO',
          error_publico = 'El horario del evento ya pasó antes de que el recordatorio pudiera enviarse.',
          actualizado_en = CURRENT_TIMESTAMP
      FROM agenda_eventos e
      WHERE e.id_evento = r.id_evento
        AND r.estado = 'PENDIENTE'
        AND e.estado = 'PROGRAMADO'
        AND e.inicio < CURRENT_TIMESTAMP - INTERVAL '12 hours'
    `);
    const due = await client.query(`
      SELECT r.id_recordatorio, r.usuario_id, r.id_evento, r.minutos_antes,
             e.titulo, e.inicio
      FROM agenda_recordatorios r
      JOIN agenda_eventos e ON e.id_evento = r.id_evento
      JOIN agenda_evento_participantes p
        ON p.id_evento = r.id_evento AND p.usuario_id = r.usuario_id
      WHERE r.estado = 'PENDIENTE'
        AND e.estado = 'PROGRAMADO'
        AND p.respuesta <> 'RECHAZADA'
        AND e.inicio >= CURRENT_TIMESTAMP - INTERVAL '12 hours'
        AND e.inicio - (r.minutos_antes * INTERVAL '1 minute') <= CURRENT_TIMESTAMP
      ORDER BY e.inicio, r.id_recordatorio
      FOR UPDATE OF r SKIP LOCKED
      LIMIT 100
    `);

    const published = [];
    for (const reminder of due.rows) {
      const when = new Intl.DateTimeFormat('es-CL', {
        dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Santiago'
      }).format(new Date(reminder.inicio));
      const title = `Próximo evento: ${reminder.titulo}`;
      const detail = `Tu evento de agenda comienza el ${when}.`;
      const inserted = await client.query(`
        INSERT INTO notificaciones_internas
          (usuario_id, modulo, tipo, titulo, detalle, enlace, clave_dedupe, prioridad)
        VALUES ($1, 'AGENDA', 'RECORDATORIO_AGENDA', $2, $3, $4, $5, 'NORMAL')
        ON CONFLICT (usuario_id, clave_dedupe) WHERE clave_dedupe IS NOT NULL DO NOTHING
        RETURNING id_notificacion, creada_en
      `, [reminder.usuario_id, title, detail, `/agenda?evento=${reminder.id_evento}`,
        `agenda:recordatorio:${reminder.id_evento}:${reminder.usuario_id}`]);
      await client.query(`
        UPDATE agenda_recordatorios
        SET estado = 'ENVIADO', enviado_en = CURRENT_TIMESTAMP,
            error_publico = NULL, actualizado_en = CURRENT_TIMESTAMP
        WHERE id_recordatorio = $1
      `, [reminder.id_recordatorio]);
      if (inserted.rowCount) {
        published.push({
          ...reminder,
          ...inserted.rows[0],
          titulo_notificacion: title,
          detalle_notificacion: detail
        });
      }
    }
    await client.query('COMMIT');
    published.forEach((reminder) => publishReminder(realtimeHub, reminder));
    return { sent: published.length, expired: expired.rowCount };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (acquired) {
      await client.query("SELECT pg_advisory_unlock(hashtext('ldsm_agenda_recordatorios'))").catch(() => {});
    }
    client.release();
  }
};

const startAgendaReminderScheduler = (pool, options = {}) => {
  if (String(process.env.AGENDA_REMINDERS_ENABLED || 'true').toLowerCase() === 'false') return () => {};
  let running = false;
  const execute = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runAgendaReminders(pool, options);
      if (result.sent || result.expired) console.log(JSON.stringify({ event: 'agenda_recordatorios', ...result }));
    } catch (error) {
      console.error('[agenda recordatorios]', error.message);
    } finally {
      running = false;
    }
  };
  const initial = setTimeout(execute, 10_000);
  const timer = setInterval(execute, 60_000);
  initial.unref?.();
  timer.unref?.();
  return () => { clearTimeout(initial); clearInterval(timer); };
};

module.exports = { runAgendaReminders, startAgendaReminderScheduler };
