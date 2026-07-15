const pool = require('./db');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

async function setupAndSeed() {
  try {
    const defaultUserPassword = process.env.DEFAULT_USER_PASSWORD;
    if (!defaultUserPassword || defaultUserPassword.length < 8) {
      throw new Error('DEFAULT_USER_PASSWORD debe existir y tener al menos 8 caracteres.');
    }

    const initSqlPath = path.join(__dirname, 'init.sql');
    const initSql = fs.readFileSync(initSqlPath, 'utf8');

    console.log('Creando tablas desde init.sql...');
    await pool.query(initSql);
    console.log('Tablas creadas exitosamente.');

    // 1. CONFIGURACIÓN DE ASISTENCIA DEFAULT
    console.log('Insertando configuración de asistencia por defecto...');
    await pool.query(
      "INSERT INTO configuracion_asistencia (hora_entrada, hora_limite_atraso) VALUES ('08:00:00', '08:15:00')"
    );

    // 2. USUARIOS ADMIN Y LECTOR
    console.log('Insertando Usuarios del Sistema...');
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(defaultUserPassword, salt);

    await pool.query(
      "INSERT INTO usuarios (correo, password_hash, rol, nombre) VALUES ($1, $2, 'lector', 'Lector Puerta') ON CONFLICT (correo) DO NOTHING",
      ['lector@colegio.cl', hash]
    );
    await pool.query(
      "INSERT INTO usuarios (correo, password_hash, rol, nombre) VALUES ($1, $2, 'admin', 'Administrador General') ON CONFLICT (correo) DO NOTHING",
      ['admin@colegio.cl', hash]
    );

    // 3. CURSOS DEFAULT
    console.log('Insertando Cursos base...');
    const cursosBase = [
      'Pre-Kinder',
      'Kinder',
      '1° Básico',
      '2° Básico',
      '3° Básico',
      '4° Básico',
      '5° Básico',
      '6° Básico',
      '7° Básico',
      '8° Básico',
      '1° Medio',
      '2° Medio',
      '3° Medio',
      '4° Medio'
    ];

    for (const c of cursosBase) {
      await pool.query(
        "INSERT INTO curso (nombre_curso) VALUES ($1) ON CONFLICT (nombre_curso) DO NOTHING",
        [c]
      );
    }

    console.log('Base de datos LDSM inicializada exitosamente.');

  } catch (err) {
    console.error('Error configurando la BD:', err.message);
  } finally {
    pool.end();
  }
}

setupAndSeed();
