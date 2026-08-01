const pool = require('../db');
const bcrypt = require('bcryptjs');
const { calculateRutDv } = require('../utils/visitors');

if (process.env.ALLOW_DEMO_DATA !== 'true') {
  throw new Error('Datos de demostración bloqueados. Declara ALLOW_DEMO_DATA=true únicamente en un entorno local.');
}

const firstNames = [
  'Andrea', 'Carlos', 'Paula', 'Rodrigo', 'Marcela', 'Felipe', 'Daniela', 'Jorge',
  'Carolina', 'Mauricio', 'Patricia', 'Cristián', 'Verónica', 'Sebastián', 'Claudia'
];
const paternalNames = [
  'González', 'Muñoz', 'Rojas', 'Díaz', 'Pérez', 'Soto', 'Contreras', 'Silva',
  'Martínez', 'Sepúlveda', 'Morales', 'Rodríguez', 'López', 'Torres', 'Castillo'
];
const maternalNames = [
  'Fernández', 'Gutiérrez', 'Aravena', 'Vega', 'Salazar', 'Navarro', 'Reyes',
  'Espinoza', 'Henríquez', 'Bustamante'
];
const motives = ['REUNION', 'TRAMITE', 'PROVEEDOR', 'DOCENTE', 'ACTIVIDAD'];
const destinations = ['DIRECCION', 'INSPECTORIA', 'SECRETARIA', 'UTP', 'CONVIVENCIA'];

const demoRut = (index) => {
  const body = String(50000000 + index);
  return `${body}${calculateRutDv(body)}`;
};

const makeName = (index) => [
  firstNames[index % firstNames.length],
  paternalNames[(index * 3) % paternalNames.length],
  maternalNames[(index * 7) % maternalNames.length]
].join(' ');

const seed = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const qaPassword = process.env.DEFAULT_USER_PASSWORD;
    if (!qaPassword) throw new Error('DEFAULT_USER_PASSWORD es obligatorio para crear la cuenta QA local.');
    const qaHash = await bcrypt.hash(qaPassword, 12);
    await client.query(
      `INSERT INTO usuarios
        (correo, password_hash, rol, nombre, cargo, activo, debe_cambiar_password)
       VALUES ('qa.visitas@ldsm.local', $1, 'admin', 'QA local - Visitas', 'Cuenta de prueba local', true, false)
       ON CONFLICT (LOWER(correo)) WHERE eliminado_en IS NULL DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         rol = 'admin',
         nombre = EXCLUDED.nombre,
         cargo = EXCLUDED.cargo,
         activo = true,
         debe_cambiar_password = false,
         token_version = usuarios.token_version + 1`,
      [qaHash]
    );
    const actorResult = await client.query(
      `SELECT id FROM usuarios
       WHERE activo = true AND eliminado_en IS NULL
       ORDER BY CASE WHEN rol = 'admin' THEN 0 ELSE 1 END, id
       LIMIT 1`
    );
    if (!actorResult.rows.length) throw new Error('No existe una cuenta activa para atribuir los datos de demostración.');
    const actorId = actorResult.rows[0].id;

    await client.query(`
      DELETE FROM retiros_alumno
      WHERE motivo LIKE '[DEMO]%'
    `);
    await client.query(`
      DELETE FROM personas_autorizadas_retiro
      WHERE origen_autorizacion = 'DATOS DEMO LOCAL'
    `);
    await client.query(`
      DELETE FROM visita_eventos
      WHERE visita_id IN (
        SELECT id FROM visitas WHERE observaciones = 'DATOS DEMO LOCAL'
      )
    `);
    await client.query(`
      DELETE FROM visitas
      WHERE observaciones = 'DATOS DEMO LOCAL'
    `);

    const visitorIds = [];
    for (let index = 1; index <= 60; index += 1) {
      const document = demoRut(index);
      const visitorResult = await client.query(
        `INSERT INTO visitantes
          (tipo_documento, documento_numero, nombre_completo, telefono, creado_por, actualizado_por)
         VALUES ('RUT', $1, $2, $3, $4, $4)
         ON CONFLICT (tipo_documento, documento_numero) DO UPDATE SET
           nombre_completo = EXCLUDED.nombre_completo,
           telefono = EXCLUDED.telefono,
           actualizado_por = EXCLUDED.actualizado_por,
           actualizado_en = CURRENT_TIMESTAMP
         RETURNING id`,
        [document, makeName(index), `+56 9 0000 ${String(index).padStart(4, '0')}`, actorId]
      );
      visitorIds.push(visitorResult.rows[0].id);
    }

    for (let index = 0; index < 42; index += 1) {
      const active = index < 7;
      const daysAgo = active ? 0 : (index % 18);
      const hoursAgo = active ? (index + 1) : ((index % 7) + 2);
      const ingreso = new Date(Date.now() - daysAgo * 86400000 - hoursAgo * 3600000);
      const salida = active ? null : new Date(ingreso.getTime() + ((index % 3) + 1) * 3600000);
      const visitResult = await client.query(
        `INSERT INTO visitas
          (visitante_id, motivo_codigo, motivo_detalle, destino_codigo,
           persona_contactada, observaciones, estado, origen, ingreso_en,
           salida_en, registrado_por, finalizado_por)
         VALUES ($1, $2, $3, $4, $5, 'DATOS DEMO LOCAL', $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [
          visitorIds[index],
          motives[index % motives.length],
          index % 4 === 0 ? 'Coordinación previamente informada' : null,
          destinations[(index * 2) % destinations.length],
          index % 3 === 0 ? 'Funcionario de referencia' : null,
          active ? 'DENTRO' : 'FINALIZADA',
          index % 2 === 0 ? 'LECTOR' : 'MANUAL',
          ingreso,
          salida,
          actorId,
          active ? null : actorId
        ]
      );
      await client.query(
        `INSERT INTO visita_eventos (visita_id, accion, detalle, realizado_por, realizado_en)
         VALUES ($1, 'REGISTRAR_ENTRADA', '{"demo":true}', $2, $3)`,
        [visitResult.rows[0].id, actorId, ingreso]
      );
      if (salida) {
        await client.query(
          `INSERT INTO visita_eventos (visita_id, accion, detalle, realizado_por, realizado_en)
           VALUES ($1, 'REGISTRAR_SALIDA', '{"demo":true}', $2, $3)`,
          [visitResult.rows[0].id, actorId, salida]
        );
      }
    }

    const students = await client.query(
      `SELECT id_alumno FROM alumno
       WHERE activo = true
       ORDER BY id_alumno
       LIMIT 12`
    );

    for (let index = 0; index < students.rows.length; index += 1) {
      const authorization = await client.query(
        `INSERT INTO personas_autorizadas_retiro
          (id_alumno, visitante_id, parentesco, parentesco_codigo,
           es_principal, origen_autorizacion, fuente_registro, creado_por)
         VALUES ($1, $2, $3, $4, $5, 'DATOS DEMO LOCAL', 'DEMO', $6)
         RETURNING id`,
        [
          students.rows[index].id_alumno,
          visitorIds[42 + index],
          index % 2 === 0 ? 'Apoderado principal' : 'Familiar autorizado',
          index % 2 === 0 ? 'APODERADO_PRINCIPAL' : 'FAMILIAR_AUTORIZADO',
          index % 2 === 0,
          actorId
        ]
      );

      if (index < 6) {
        const states = ['SOLICITADO', 'SOLICITADO', 'AUTORIZADO', 'ENTREGADO', 'RECHAZADO', 'CANCELADO'];
        const state = states[index];
        await client.query(
          `INSERT INTO retiros_alumno
            (id_alumno, visitante_id, autorizacion_id, motivo, motivo_codigo,
             motivo_detalle, parentesco_declarado_codigo, estado,
             solicitado_por, solicitado_en, decidido_por, decidido_en,
             motivo_decision, entregado_por, entregado_en,
             cancelado_por, cancelado_en, motivo_cancelacion)
           VALUES (
             $1, $2, $3, $4, 'CITA_MEDICA', $4, $5, $6, $7,
             CURRENT_TIMESTAMP - ($8 || ' minutes')::interval,
             $9, CASE WHEN $9::int IS NULL THEN NULL ELSE CURRENT_TIMESTAMP - interval '15 minutes' END,
             $10, $11, CASE WHEN $11::int IS NULL THEN NULL ELSE CURRENT_TIMESTAMP - interval '5 minutes' END,
             $12, CASE WHEN $12::int IS NULL THEN NULL ELSE CURRENT_TIMESTAMP - interval '10 minutes' END,
             $13
           )`,
          [
            students.rows[index].id_alumno,
            visitorIds[42 + index],
            authorization.rows[0].id,
            `[DEMO] Retiro informado para prueba local ${index + 1}`,
            index % 2 === 0 ? 'APODERADO_PRINCIPAL' : 'FAMILIAR_AUTORIZADO',
            state,
            actorId,
            String(55 - index * 5),
            ['AUTORIZADO', 'ENTREGADO', 'RECHAZADO'].includes(state) ? actorId : null,
            state === 'RECHAZADO' ? 'Antecedentes insuficientes para autorizar' : (['AUTORIZADO', 'ENTREGADO'].includes(state) ? 'Autorización vigente verificada' : null),
            state === 'ENTREGADO' ? actorId : null,
            state === 'CANCELADO' ? actorId : null,
            state === 'CANCELADO' ? 'Solicitud retirada antes de la entrega' : null
          ]
        );
      }
    }

    await client.query('COMMIT');
    console.log(JSON.stringify({
      status: 'OK',
      cuenta_qa: 'qa.visitas@ldsm.local',
      visitantes_demo: visitorIds.length,
      visitas_demo: 42,
      autorizaciones_demo: students.rows.length,
      retiros_demo: Math.min(6, students.rows.length)
    }));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
};

seed().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
