const pool = require('./db');
const { runMigrations } = require('./migrations');
const { bootstrapBaseSchema, ensureBaseData } = require('./server');

const seed = async () => {
  try {
    const isNewSchema = await bootstrapBaseSchema();
    await runMigrations(pool);
    await ensureBaseData(isNewSchema);
    console.log('Datos base verificados sin eliminar información existente.');
  } catch (error) {
    console.error('No fue posible verificar los datos base:', error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
};

seed();
