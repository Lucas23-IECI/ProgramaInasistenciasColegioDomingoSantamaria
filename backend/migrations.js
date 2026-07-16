const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

const runMigrations = async (pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(255) UNIQUE NOT NULL,
      aplicada_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));

  for (const file of files) {
    const applied = await pool.query(
      'SELECT 1 FROM schema_migrations WHERE nombre = $1',
      [file]
    );
    if (applied.rows.length > 0) continue;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (nombre) VALUES ($1)',
        [file]
      );
      await client.query('COMMIT');
      console.log(`Migración aplicada: ${file}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Falló la migración ${file}: ${error.message}`);
    } finally {
      client.release();
    }
  }
};

module.exports = { runMigrations };

