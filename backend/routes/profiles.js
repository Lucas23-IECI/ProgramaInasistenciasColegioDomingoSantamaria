const fs = require('fs');

const {
  buildDirectoryFacets,
  filterDirectoryProfiles,
  getPersonalProfile,
  normalizeManagedProfilePayload,
  normalizeOwnProfilePayload,
  profileSelect,
  serializePersonalProfile
} = require('../services/personalProfileService');
const {
  processProfileImage,
  removeProfileImageFiles,
  resolveProfileImagePath
} = require('../services/profileMediaService');

const requestedOrCurrent = (body, key, currentValue) => (
  Object.prototype.hasOwnProperty.call(body || {}, key) ? body[key] : currentValue
);

const PROFILE_VALIDATION_MESSAGES = new Set([
  'El estado de disponibilidad no es válido.',
  'La vigencia del estado no es válida.',
  'La vigencia del estado debe quedar en el futuro.',
  'La vigencia del estado no puede superar 180 días.'
]);

const PROFILE_IMAGE_VALIDATION_MESSAGES = new Set([
  'La imagen debe ser JPG, PNG o WEBP.',
  'La imagen debe pesar como máximo 5 MB.',
  'La imagen fuente es demasiado compleja para conservarla. Prueba con una imagen de menor tamaño.',
  'Categoría de imagen no válida.',
  'No fue posible leer la imagen.',
  'No fue posible leer la imagen fuente.'
]);

const registerProfileRoutes = ({
  app,
  pool,
  verifyToken,
  verifyPermission,
  insertarAudit,
  getClientIp
}) => {
  app.get('/api/profile/me', verifyToken, async (req, res) => {
    try {
      const profile = await getPersonalProfile(pool, req.user.id, { includeContact: true, respectContactVisibility: false });
      res.json({ profile });
    } catch (error) {
      console.error('[profile:me]', error.message);
      res.status(500).json({ message: 'No fue posible cargar el perfil personal.' });
    }
  });

  app.patch('/api/profile/me', verifyToken, verifyPermission('profiles.own.edit'), async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const before = await getPersonalProfile(client, req.user.id, { includeContact: true, respectContactVisibility: false });
      const payload = normalizeOwnProfilePayload({
        nombre_mostrado: requestedOrCurrent(req.body, 'nombre_mostrado', before.nombre_mostrado),
        biografia: requestedOrCurrent(req.body, 'biografia', before.biografia),
        ubicacion: requestedOrCurrent(req.body, 'ubicacion', before.ubicacion),
        anexo: requestedOrCurrent(req.body, 'anexo', before.anexo),
        telefono_interno: requestedOrCurrent(req.body, 'telefono_interno', before.telefono_interno),
        horario_trabajo: requestedOrCurrent(req.body, 'horario_trabajo', before.horario_trabajo),
        estado_disponibilidad: requestedOrCurrent(req.body, 'estado_disponibilidad', before.estado_disponibilidad),
        mensaje_estado: requestedOrCurrent(req.body, 'mensaje_estado', before.mensaje_estado),
        estado_hasta: requestedOrCurrent(req.body, 'estado_hasta', before.estado_hasta),
        mostrar_contacto: requestedOrCurrent(req.body, 'mostrar_contacto', before.mostrar_contacto)
      });
      await client.query(`
        UPDATE perfiles_personales
        SET nombre_mostrado = $1, biografia = $2, ubicacion = $3, anexo = $4,
            telefono_interno = $5, horario_trabajo = $6, estado_disponibilidad = $7,
            mensaje_estado = $8, estado_hasta = $9, mostrar_contacto = $10,
            actualizado_en = CURRENT_TIMESTAMP, actualizado_por = $11
        WHERE usuario_id = $11
      `, [
        payload.nombre_mostrado,
        payload.biografia,
        payload.ubicacion,
        payload.anexo,
        payload.telefono_interno,
        payload.horario_trabajo,
        payload.estado_disponibilidad,
        payload.mensaje_estado,
        payload.estado_hasta,
        payload.mostrar_contacto,
        req.user.id
      ]);
      await insertarAudit(client, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: 'ACTUALIZAR_PERFIL_PROPIO',
        entidad: 'perfil_personal',
        entidad_id: req.user.id,
        detalle: { antes: before, despues: payload },
        ip: getClientIp(req)
      });
      const profile = await getPersonalProfile(client, req.user.id, { includeContact: true, respectContactVisibility: false });
      await client.query('COMMIT');
      res.json({ message: 'Perfil actualizado.', profile });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (PROFILE_VALIDATION_MESSAGES.has(error.message)) return res.status(400).json({ message: error.message });
      console.error('[profile:update-me]', error.message);
      res.status(500).json({ message: 'No fue posible actualizar el perfil.' });
    } finally {
      client.release();
    }
  });

  app.get('/api/directory/staff', verifyToken, verifyPermission('profiles.directory.view'), async (req, res) => {
    const includeContact = req.user.permissions.includes('profiles.contact.view');
    try {
      const result = await pool.query(`${profileSelect}
        WHERE u.eliminado_en IS NULL
          AND u.activo = true
          AND COALESCE(pp.visible_directorio, true) = true
        ORDER BY LOWER(COALESCE(pp.nombre_mostrado, u.nombre, u.correo)), u.id
        LIMIT 500
      `);
      const allProfiles = result.rows.map((row) => serializePersonalProfile(row, { includeContact }));
      const rows = filterDirectoryProfiles(allProfiles, {
        search: req.query.search,
        area: req.query.area,
        cargo: req.query.cargo,
        status: req.query.status,
        account_type: req.query.account_type,
        sort: req.query.sort
      });
      res.json({ rows, filters: buildDirectoryFacets(allProfiles), total: allProfiles.length });
    } catch (error) {
      console.error('[directory:list]', error.message);
      res.status(500).json({ message: 'No fue posible cargar el directorio institucional.' });
    }
  });

  app.get('/api/directory/staff/:userId', verifyToken, verifyPermission('profiles.directory.view'), async (req, res) => {
    const userId = Number.parseInt(req.params.userId, 10);
    if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ message: 'La cuenta seleccionada no es válida. Regresa al directorio y vuelve a abrirla.' });
    try {
      const profile = await getPersonalProfile(pool, userId, {
        includeContact: req.user.permissions.includes('profiles.contact.view'),
        updatedBy: req.user.id
      });
      if (!profile || (!profile.visible_directorio && !req.user.permissions.includes('profiles.manage'))) {
        return res.status(404).json({ message: 'El perfil no existe o ya no está visible en el directorio.' });
      }
      res.json({ profile });
    } catch (error) {
      console.error('[directory:detail]', error.message);
      res.status(500).json({ message: 'No fue posible cargar el perfil.' });
    }
  });

  app.patch('/api/profiles/:userId', verifyToken, verifyPermission('profiles.manage'), async (req, res) => {
    const userId = Number.parseInt(req.params.userId, 10);
    if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ message: 'La cuenta seleccionada no es válida. Regresa al listado y vuelve a abrirla.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const before = await getPersonalProfile(client, userId, { includeContact: true, updatedBy: req.user.id });
      if (!before) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'La cuenta seleccionada no existe o fue eliminada. Recarga el listado.' });
      }
      const payload = normalizeManagedProfilePayload({
        area: requestedOrCurrent(req.body, 'area', before.area),
        visible_directorio: requestedOrCurrent(req.body, 'visible_directorio', before.visible_directorio),
        cuenta_compartida: requestedOrCurrent(req.body, 'cuenta_compartida', before.cuenta_compartida)
      });
      await client.query(`
        UPDATE perfiles_personales
        SET area = $1, visible_directorio = $2, cuenta_compartida = $3,
            actualizado_en = CURRENT_TIMESTAMP, actualizado_por = $4
        WHERE usuario_id = $5
      `, [payload.area, payload.visible_directorio, payload.cuenta_compartida, req.user.id, userId]);
      await insertarAudit(client, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: 'ADMINISTRAR_PERFIL_PERSONAL',
        entidad: 'perfil_personal',
        entidad_id: userId,
        detalle: { antes: before, despues: payload },
        ip: getClientIp(req)
      });
      const profile = await getPersonalProfile(client, userId, { includeContact: true });
      await client.query('COMMIT');
      res.json({ message: 'Configuración institucional actualizada.', profile });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[profile:admin-update]', error.message);
      res.status(500).json({ message: 'No fue posible actualizar la configuración del perfil.' });
    } finally {
      client.release();
    }
  });

  const saveProfileImage = (category) => async (req, res) => {
    let processed;
    try {
      processed = await processProfileImage({
        dataUrl: req.body?.data_url,
        sourceDataUrl: req.body?.source_data_url,
        category,
        userId: req.user.id
      });
    } catch (error) {
      if (PROFILE_IMAGE_VALIDATION_MESSAGES.has(error.message)) {
        return res.status(400).json({ message: error.message });
      }
      console.error('[profile:image:process]', error.message);
      return res.status(500).json({ message: 'No fue posible procesar la imagen. Prueba con otro archivo o inténtalo nuevamente.' });
    }

    const client = await pool.connect();
    let previous = null;
    try {
      await client.query('BEGIN');
      await getPersonalProfile(client, req.user.id, { includeContact: true, respectContactVisibility: false });
      const column = category === 'avatar' ? 'avatar_archivo_id' : 'portada_archivo_id';
      const current = await client.query(`
        SELECT ap.* FROM perfiles_personales pp
        LEFT JOIN archivos_perfil ap ON ap.id = pp.${column}
        WHERE pp.usuario_id = $1
      `, [req.user.id]);
      previous = current.rows[0]?.id ? current.rows[0] : null;
      const inserted = await client.query(`
        INSERT INTO archivos_perfil
          (usuario_id, categoria, nombre_principal, nombre_miniatura, mime_type,
           bytes_principal, bytes_miniatura, ancho, alto, sha256, creado_por,
           nombre_fuente, mime_fuente, bytes_fuente, sha256_fuente)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $1, $11, $5, $12, $13)
        RETURNING id
      `, [
        req.user.id, category, processed.mainName, processed.thumbName, processed.mimeType,
        processed.mainBytes, processed.thumbBytes, processed.width, processed.height, processed.sha256,
        processed.sourceName, processed.sourceBytes, processed.sourceSha256
      ]);
      await client.query(`
        UPDATE perfiles_personales
        SET ${column} = $1, actualizado_en = CURRENT_TIMESTAMP, actualizado_por = $2
        WHERE usuario_id = $2
      `, [inserted.rows[0].id, req.user.id]);
      if (previous) await client.query('UPDATE archivos_perfil SET eliminado_en = CURRENT_TIMESTAMP WHERE id = $1', [previous.id]);
      await insertarAudit(client, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: category === 'avatar' ? 'ACTUALIZAR_AVATAR' : 'ACTUALIZAR_PORTADA',
        entidad: 'perfil_personal',
        entidad_id: req.user.id,
        detalle: { archivo_id: inserted.rows[0].id, reemplazo_archivo_id: previous?.id || null },
        ip: getClientIp(req)
      });
      const profile = await getPersonalProfile(client, req.user.id, { includeContact: true, respectContactVisibility: false });
      await client.query('COMMIT');
      if (previous) removeProfileImageFiles(previous);
      res.status(201).json({ message: category === 'avatar' ? 'Foto actualizada.' : 'Portada actualizada.', profile });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      removeProfileImageFiles({
        nombre_principal: processed.mainName,
        nombre_miniatura: processed.thumbName,
        nombre_fuente: processed.sourceName
      });
      console.error('[profile:save-image]', error.message);
      res.status(500).json({ message: 'No fue posible guardar la imagen.' });
    } finally {
      client.release();
    }
  };

  const deleteProfileImage = (category) => async (req, res) => {
    const column = category === 'avatar' ? 'avatar_archivo_id' : 'portada_archivo_id';
    const client = await pool.connect();
    let previous = null;
    try {
      await client.query('BEGIN');
      const current = await client.query(`
        SELECT ap.* FROM perfiles_personales pp
        LEFT JOIN archivos_perfil ap ON ap.id = pp.${column}
        WHERE pp.usuario_id = $1
      `, [req.user.id]);
      previous = current.rows[0]?.id ? current.rows[0] : null;
      await client.query(`
        UPDATE perfiles_personales
        SET ${column} = NULL, actualizado_en = CURRENT_TIMESTAMP, actualizado_por = $1
        WHERE usuario_id = $1
      `, [req.user.id]);
      if (previous) await client.query('UPDATE archivos_perfil SET eliminado_en = CURRENT_TIMESTAMP WHERE id = $1', [previous.id]);
      await insertarAudit(client, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: category === 'avatar' ? 'ELIMINAR_AVATAR' : 'ELIMINAR_PORTADA',
        entidad: 'perfil_personal',
        entidad_id: req.user.id,
        detalle: { archivo_id: previous?.id || null },
        ip: getClientIp(req)
      });
      const profile = await getPersonalProfile(client, req.user.id, { includeContact: true, respectContactVisibility: false });
      await client.query('COMMIT');
      if (previous) removeProfileImageFiles(previous);
      res.json({ message: 'Imagen eliminada.', profile });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[profile:delete-image]', error.message);
      res.status(500).json({ message: 'No fue posible eliminar la imagen.' });
    } finally {
      client.release();
    }
  };

  app.post('/api/profile/me/avatar', verifyToken, verifyPermission('profiles.own.edit'), saveProfileImage('avatar'));
  app.delete('/api/profile/me/avatar', verifyToken, verifyPermission('profiles.own.edit'), deleteProfileImage('avatar'));
  app.post('/api/profile/me/cover', verifyToken, verifyPermission('profiles.own.edit'), saveProfileImage('portada'));
  app.delete('/api/profile/me/cover', verifyToken, verifyPermission('profiles.own.edit'), deleteProfileImage('portada'));

  app.get('/api/profile-media/:mediaId/:variant', verifyToken, async (req, res) => {
    const mediaId = Number.parseInt(req.params.mediaId, 10);
    const variant = ['main', 'thumb', 'source'].includes(req.params.variant) ? req.params.variant : null;
    if (!Number.isInteger(mediaId) || mediaId <= 0 || !variant) return res.status(404).end();
    try {
      const result = await pool.query(`
        SELECT ap.*, pp.visible_directorio
        FROM archivos_perfil ap
        JOIN perfiles_personales pp ON pp.usuario_id = ap.usuario_id
        WHERE ap.id = $1 AND ap.eliminado_en IS NULL
      `, [mediaId]);
      const media = result.rows[0];
      if (!media) return res.status(404).end();
      const isOwner = media.usuario_id === req.user.id;
      const canViewDirectory = req.user.permissions.includes('profiles.directory.view') && media.visible_directorio;
      const canManage = req.user.permissions.includes('profiles.manage');
      if (!isOwner && !canViewDirectory && !canManage) return res.status(403).end();
      const fileName = variant === 'source'
        ? (media.nombre_fuente || media.nombre_principal)
        : variant === 'main' ? media.nombre_principal : media.nombre_miniatura;
      const filePath = resolveProfileImagePath(fileName);
      if (!filePath || !fs.existsSync(filePath)) return res.status(404).end();
      res.setHeader('Content-Type', media.mime_type);
      res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
      const variantHash = variant === 'source' ? (media.sha256_fuente || media.sha256) : media.sha256;
      res.setHeader('ETag', `"${variantHash}-${variant}"`);
      res.sendFile(filePath);
    } catch (error) {
      console.error('[profile:media]', error.message);
      res.status(500).end();
    }
  });
};

module.exports = { registerProfileRoutes };
