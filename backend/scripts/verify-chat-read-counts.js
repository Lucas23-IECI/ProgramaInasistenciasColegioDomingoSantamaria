/* Read-only integration check, restricted to the local QA database. */
'use strict';
const assert = require('node:assert/strict');
const pool = require('../db');

async function run() {
  assert.equal(process.env.DB_NAME, 'ldsm_codex_manual_019ffb95', 'Requires the isolated QA database');
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const { rows } = await client.query(`
      SELECT msg.id_mensaje,
        (SELECT COUNT(*)::int FROM chat_lecturas l WHERE l.id_mensaje=msg.id_mensaje) AS lecturas,
        (SELECT COUNT(*)::int FROM chat_lecturas l WHERE l.id_mensaje=msg.id_mensaje AND l.usuario_id<>msg.enviado_por) AS lecturas_otros
      FROM chat_mensajes msg JOIN chat_conversaciones c USING (id_conversacion)
      WHERE c.nombre LIKE '[QA CHAT %] Coordinación de jornada'
    `);
    assert.ok(rows.length >= 12, 'Run the two real QA chat flows first');
    assert.ok(rows.every(row => row.lecturas >= 1 && row.lecturas_otros === 0), 'Only the author has read these QA messages');
    // The identical counting expression also checks a recipient reading, without
    // inserting artificial reads into real conversations.
    const synthetic = await client.query(`
      WITH msg(id_mensaje,enviado_por) AS (VALUES (1,7),(2,7),(3,7)),
        chat_lecturas(id_mensaje,usuario_id) AS (VALUES (1,7),(2,7),(2,8),(3,7),(3,8),(3,9))
      SELECT (SELECT COUNT(*)::int FROM chat_lecturas l WHERE l.id_mensaje=msg.id_mensaje AND l.usuario_id<>msg.enviado_por) AS lecturas_otros
      FROM msg ORDER BY id_mensaje
    `);
    assert.deepEqual(synthetic.rows.map(row => row.lecturas_otros), [0, 1, 2]);
    console.log(JSON.stringify({ qaMessagesVerified: rows.length, ownReadsExcluded: true, countingCases: 3, readOnly: true }));
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

run().catch(() => {
  console.error('Chat read-count verification failed; no data was changed.');
  process.exitCode = 1;
}).finally(() => pool.end());
