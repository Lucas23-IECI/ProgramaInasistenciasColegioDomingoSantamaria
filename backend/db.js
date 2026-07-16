const { Pool } = require('pg');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env') });

const appTimezone = process.env.APP_TIMEZONE || 'America/Santiago';

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: String(process.env.DB_PASSWORD),
  port: parseInt(process.env.DB_PORT, 10),
  max: parseInt(process.env.DB_POOL_MAX || '10', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  application_name: 'ldsm_asistencia',
  options: `-c timezone=${appTimezone}`,
});

module.exports = pool;
