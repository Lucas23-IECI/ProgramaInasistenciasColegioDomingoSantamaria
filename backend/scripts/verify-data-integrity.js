const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pool = require('../db');
const { resolveDocumentPath } = require('../services/documentService');

const scalar = async (sql) => Number((await pool.query(sql)).rows[0].total);

const main = async () => {
  const migrationFiles = fs.readdirSync(path.join(__dirname, '..', 'migrations'))
    .filter((file) => file.endsWith('.sql'));
  const appliedMigrations = await scalar('SELECT COUNT(*)::int AS total FROM schema_migrations');
  assert.equal(appliedMigrations, migrationFiles.length, 'La base no tiene todas las migraciones del código actual.');

  const checks = [
    {
      name: 'notificaciones_con_enlace_inseguro',
      sql: `SELECT COUNT(*)::int AS total
            FROM notificaciones_internas
            WHERE enlace IS NOT NULL
              AND (enlace !~ '^/[A-Za-z0-9/?&=._%#:+-]*$' OR enlace LIKE '//%')`
    },
    {
      name: 'envios_con_cantidad_inconsistente',
      sql: `SELECT COUNT(*)::int AS total
            FROM notificaciones_envios e
            LEFT JOIN notificaciones_internas n ON n.envio_id = e.id_envio
            GROUP BY e.id_envio, e.destinatarios_total
            HAVING COUNT(n.id_notificacion)::int <> e.destinatarios_total
            LIMIT 1`
    },
    {
      name: 'seguimientos_cerrados_incompletos',
      sql: `SELECT COUNT(*)::int AS total
            FROM seguimiento_casos
            WHERE (estado IN ('RESUELTO', 'CERRADO') AND (cerrado_en IS NULL OR resultado_final IS NULL))
               OR (estado NOT IN ('RESUELTO', 'CERRADO') AND cerrado_en IS NOT NULL)`
    },
    {
      name: 'senales_activas_sin_caso',
      sql: `SELECT COUNT(*)::int AS total
            FROM seguimiento_senales
            WHERE activa = true AND id_caso IS NULL`
    },
    {
      name: 'convivencia_cerrada_incompleta',
      sql: `SELECT COUNT(*)::int AS total
            FROM convivencia_casos
            WHERE (estado = 'CERRADO' AND (cerrado_en IS NULL OR motivo_cierre IS NULL))
               OR (estado <> 'CERRADO' AND cerrado_en IS NOT NULL)`
    },
    {
      name: 'chats_directos_con_membresia_invalida',
      sql: `SELECT COUNT(*)::int AS total FROM (
              SELECT c.id_conversacion
              FROM chat_conversaciones c
              LEFT JOIN chat_miembros m
                ON m.id_conversacion = c.id_conversacion AND m.activo = true
              WHERE c.activa = true AND c.tipo = 'DIRECTA'
              GROUP BY c.id_conversacion
              HAVING COUNT(m.usuario_id) <> 2
            ) inconsistentes`
    },
    {
      name: 'mensajes_con_respuesta_cruzada',
      sql: `SELECT COUNT(*)::int AS total
            FROM chat_mensajes m
            JOIN chat_mensajes r ON r.id_mensaje = m.responde_a_id
            WHERE r.id_conversacion <> m.id_conversacion`
    },
    {
      name: 'fijados_en_conversacion_incorrecta',
      sql: `SELECT COUNT(*)::int AS total
            FROM chat_mensajes_fijados f
            JOIN chat_mensajes m ON m.id_mensaje = f.id_mensaje
            WHERE m.id_conversacion <> f.id_conversacion`
    },
    {
      name: 'versiones_documentales_duplicadas',
      sql: `SELECT COUNT(*)::int AS total FROM (
              SELECT id_documento_expediente, numero_version
              FROM documento_expediente_versiones
              GROUP BY id_documento_expediente, numero_version
              HAVING COUNT(*) > 1
            ) duplicadas`
    }
  ];

  const results = {};
  for (const check of checks) {
    const query = await pool.query(check.sql);
    const total = Number(query.rows[0]?.total || 0);
    results[check.name] = total;
    assert.equal(total, 0, `Integridad inválida: ${check.name}.`);
  }

  const binaries = await pool.query('SELECT nombre_almacenado FROM justification_documents');
  let missingFiles = 0;
  let unsafeNames = 0;
  for (const binary of binaries.rows) {
    if (path.basename(binary.nombre_almacenado) !== binary.nombre_almacenado) unsafeNames += 1;
    const filePath = resolveDocumentPath(binary.nombre_almacenado);
    if (!filePath || !fs.existsSync(filePath)) missingFiles += 1;
  }
  assert.equal(unsafeNames, 0, 'Hay nombres de archivo almacenados fuera del formato seguro.');
  assert.equal(missingFiles, 0, 'Hay documentos registrados cuyo archivo físico no está disponible.');

  process.stdout.write(`${JSON.stringify({
    ok: true,
    migraciones: appliedMigrations,
    documentos_revisados: binaries.rowCount,
    archivos_faltantes: missingFiles,
    ...results
  })}\n`);
};

main()
  .catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
