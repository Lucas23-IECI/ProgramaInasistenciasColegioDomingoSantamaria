const PROTECTED_ADMIN_PROFILE = 'admin';

const registerUserRoutes = (context) => {
  const {
    app,
    pool,
    bcrypt,
    jwt,
    fs,
    path,
    createHash,
    loginLimiter,
    verifyToken,
    verifyPermission,
    verifyAnyPermission,
    JWT_SECRET,
    normalizeEmail,
    sanitizeSnapshotRow,
    validateEmail,
    validatePassword,
    calculateDelayMinutes,
    calculateStatusAndSeverity,
    isIsoDate,
    validateDateRange,
    normalizeStudentPayload,
    sanitizeStudentText,
    validateStudentPayload,
    validateStudentRut,
    findCourseMatch,
    normalizeCourseKey,
    evaluateStudentReconciliation,
    compareStudentFields,
    detectIdentifierCollision,
    validateImportMode,
    assignEnrollment,
    closeEnrollment,
    recordOperationalEvent,
    attachPermissionProfile,
    countActivePermissionHolders,
    getAccessProfile,
    getAccessProfiles,
    getPermissionCatalog,
    getRecommendedPermissions,
    normalizeProfileCode,
    replaceProfilePermissions,
    replaceUserPermissionOverrides,
    validatePermissionSelection,
    cookieOptions,
    toPublicUser,
    setSessionCookie,
    sanitizeText,
    normalizeHeaderKey,
    pickRowValue,
    normalizeRutAndDv,
    normalizeDateInput,
    getImportedStudentFields,
    summarizeStudentImportRows,
    buildStudentImportPreview,
    enrichStudentImportPreview,
    STUDENT_PUBLIC_FIELDS,
    getInstitutionalClock,
    insertarAudit,
    registrarAudit,
    getClientIp
  } = context;

// ACCESS PROFILES AND STAFF ACCOUNTS
app.get('/api/permissions/catalog', verifyToken, verifyPermission('users.manage'), async (req, res) => {
  try {
    const [permissions, templates] = await Promise.all([
      getPermissionCatalog(pool),
      getAccessProfiles(pool)
    ]);
    res.json({ permissions, templates });
  } catch (err) {
    console.error('[permissions/catalog]', err.message);
    res.status(500).json({ message: 'No fue posible obtener el catálogo de permisos.' });
  }
});

app.post('/api/access-profiles', verifyToken, verifyPermission('users.manage'), async (req, res) => {
  const name = sanitizeText(req.body?.name).slice(0, 100);
  const description = sanitizeText(req.body?.description).slice(0, 280);
  if (name.length < 2) return res.status(400).json({ message: 'El nombre del perfil debe tener al menos 2 caracteres.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const permissionValidation = await validatePermissionSelection(client, req.body?.permissions || []);
    if (permissionValidation.error) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: permissionValidation.error });
    }
    const baseCode = normalizeProfileCode(name) || 'perfil';
    let code = baseCode;
    let suffix = 2;
    while ((await client.query('SELECT 1 FROM perfiles_acceso WHERE codigo = $1', [code])).rows.length) {
      code = `${baseCode.slice(0, 42)}_${suffix}`;
      suffix += 1;
    }

    await client.query(`
      INSERT INTO perfiles_acceso (codigo, nombre, descripcion, sistema, activo, orden)
      VALUES ($1, $2, $3, false, true, 70)
    `, [code, name, description]);
    await replaceProfilePermissions(client, code, permissionValidation.permissions);
    await insertarAudit(client, {
      usuario_id: req.user.id,
      usuario_correo: req.user.correo,
      accion: 'CREAR_PERFIL_ACCESO',
      entidad: 'perfil_acceso',
      detalle: { codigo: code, nombre: name, permisos: permissionValidation.permissions },
      ip: getClientIp(req)
    });
    await client.query('COMMIT');
    res.status(201).json({ message: 'Perfil de usuario creado.', profile: { value: code, label: name } });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return res.status(409).json({ message: 'Ya existe un perfil con ese nombre.' });
    console.error('[access-profiles:create]', err.message);
    res.status(500).json({ message: 'No fue posible crear el perfil.' });
  } finally {
    client.release();
  }
});

app.put('/api/access-profiles/:code', verifyToken, verifyPermission('users.manage'), async (req, res) => {
  const code = String(req.params.code || '').trim();
  const name = sanitizeText(req.body?.name).slice(0, 100);
  const description = sanitizeText(req.body?.description).slice(0, 280);
  if (name.length < 2) return res.status(400).json({ message: 'El nombre del perfil debe tener al menos 2 caracteres.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await getAccessProfile(client, code, { includeInactive: true });
    if (!current) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Perfil de usuario no encontrado.' });
    }
    const permissionValidation = await validatePermissionSelection(client, req.body?.permissions || []);
    if (permissionValidation.error) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: permissionValidation.error });
    }
    const previousPermissions = await getRecommendedPermissions(client, code);
    if (code === PROTECTED_ADMIN_PROFILE) {
      const desired = JSON.stringify([...permissionValidation.permissions].sort());
      const existing = JSON.stringify([...previousPermissions].sort());
      if (desired !== existing) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'Las funciones del perfil Administrador están protegidas y no se pueden modificar.' });
      }
    }

    await client.query(`
      UPDATE perfiles_acceso
      SET nombre = $1, descripcion = $2, actualizado_en = CURRENT_TIMESTAMP
      WHERE codigo = $3
    `, [name, description, code]);
    await replaceProfilePermissions(client, code, permissionValidation.permissions);

    if (await countActivePermissionHolders(client, 'users.manage') === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Debe existir al menos una cuenta activa capaz de administrar usuarios.' });
    }

    await client.query('UPDATE usuarios SET token_version = token_version + 1 WHERE rol = $1', [code]);
    await insertarAudit(client, {
      usuario_id: req.user.id,
      usuario_correo: req.user.correo,
      accion: 'EDITAR_PERFIL_ACCESO',
      entidad: 'perfil_acceso',
      detalle: {
        codigo: code,
        antes: { nombre: current.nombre, descripcion: current.descripcion },
        despues: { nombre: name, descripcion, permisos: permissionValidation.permissions },
        permisos_agregados: permissionValidation.permissions.filter((permission) => !previousPermissions.includes(permission)),
        permisos_retirados: previousPermissions.filter((permission) => !permissionValidation.permissions.includes(permission))
      },
      ip: getClientIp(req)
    });
    await client.query('COMMIT');

    if (req.user.rol === code) {
      const refreshed = await pool.query('SELECT * FROM usuarios WHERE id = $1', [req.user.id]);
      const sessionUser = await attachPermissionProfile(pool, refreshed.rows[0]);
      setSessionCookie(res, sessionUser);
    }
    res.json({ message: 'Perfil y permisos recomendados actualizados.' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return res.status(409).json({ message: 'Ya existe un perfil con ese nombre.' });
    console.error('[access-profiles:update]', err.message);
    res.status(500).json({ message: 'No fue posible actualizar el perfil.' });
  } finally {
    client.release();
  }
});

app.patch('/api/access-profiles/:code/status', verifyToken, verifyPermission('users.manage'), async (req, res) => {
  const code = String(req.params.code || '').trim();
  const active = req.body?.activo;
  if (typeof active !== 'boolean') return res.status(400).json({ message: 'El estado solicitado no es válido.' });
  if (code === PROTECTED_ADMIN_PROFILE) {
    return res.status(409).json({ message: 'El perfil Administrador es obligatorio y no se puede desactivar.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query('SELECT * FROM perfiles_acceso WHERE codigo = $1 FOR UPDATE', [code]);
    const current = locked.rows[0];
    if (!current) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Perfil de usuario no encontrado.' });
    }
    if (current.activo === active) {
      await client.query('COMMIT');
      return res.json({ message: active ? 'El perfil ya estaba activo.' : 'El perfil ya estaba desactivado.' });
    }
    await client.query(`
      UPDATE perfiles_acceso
      SET activo = $1, actualizado_en = CURRENT_TIMESTAMP
      WHERE codigo = $2
    `, [active, code]);
    await insertarAudit(client, {
      usuario_id: req.user.id,
      usuario_correo: req.user.correo,
      accion: active ? 'REACTIVAR_PERFIL_ACCESO' : 'DESACTIVAR_PERFIL_ACCESO',
      entidad: 'perfil_acceso',
      detalle: { codigo: code, nombre: current.nombre, cuentas_conservadas: true },
      ip: getClientIp(req)
    });
    await client.query('COMMIT');
    res.json({ message: active ? 'Perfil reactivado.' : 'Perfil desactivado. Las cuentas asociadas se conservaron.' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[access-profiles:status]', err.message);
    res.status(500).json({ message: 'No fue posible cambiar el estado del perfil.' });
  } finally {
    client.release();
  }
});

app.delete('/api/access-profiles/:code', verifyToken, verifyPermission('users.manage'), async (req, res) => {
  const code = String(req.params.code || '').trim();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query('SELECT * FROM perfiles_acceso WHERE codigo = $1 FOR UPDATE', [code]);
    const current = locked.rows[0];
    if (!current) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Perfil de usuario no encontrado.' });
    }
    if (code === PROTECTED_ADMIN_PROFILE) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'El perfil Administrador es obligatorio y no se puede eliminar.' });
    }
    const holders = await client.query(
      'SELECT id, nombre, correo FROM usuarios WHERE rol = $1 AND eliminado_en IS NULL FOR UPDATE',
      [code]
    );
    if (holders.rowCount > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        message: `No puedes eliminar ${current.nombre} porque actualmente está asignado a ${holders.rowCount} cuenta(s). Reasigna esas cuentas a otro perfil antes de eliminarlo.`,
        associated_accounts: holders.rowCount
      });
    }
    await client.query('DELETE FROM permisos_rol WHERE rol = $1', [code]);
    await client.query('DELETE FROM perfiles_acceso WHERE codigo = $1', [code]);
    await insertarAudit(client, {
      usuario_id: req.user.id,
      usuario_correo: req.user.correo,
      accion: 'ELIMINAR_PERFIL_ACCESO',
      entidad: 'perfil_acceso',
      detalle: { codigo: code, nombre: current.nombre },
      ip: getClientIp(req)
    });
    await client.query('COMMIT');
    res.json({ message: 'Perfil de usuario eliminado.' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[access-profiles:delete]', err.message);
    res.status(500).json({ message: 'No fue posible eliminar el perfil.' });
  } finally {
    client.release();
  }
});

app.get('/api/users', verifyToken, verifyPermission('users.manage'), async (req, res) => {
  try {
    const resU = await pool.query(`
      SELECT u.id, u.correo, u.rol, u.nombre, u.cargo,
             u.fecha_creacion, u.activo, u.debe_cambiar_password,
             u.ultimo_acceso, u.password_actualizado_en
      FROM usuarios u
      WHERE u.eliminado_en IS NULL
      ORDER BY u.activo DESC, COALESCE(u.nombre, u.correo) ASC
    `);
    const users = await Promise.all(resU.rows.map((user) => attachPermissionProfile(pool, user)));
    res.json(users);
  } catch (err) {
    console.error('[users:list]', err.message);
    res.status(500).json({ message: 'Error al obtener usuarios.' });
  }
});

app.post('/api/users', verifyToken, verifyPermission('users.manage'), async (req, res) => {
  const { correo, password, rol, nombre, cargo } = req.body;
  if (!correo || !password || !rol || !nombre || !cargo) {
    return res.status(400).json({ message: 'Faltan campos requeridos.' });
  }
  const normalizedEmail = normalizeEmail(correo);
  const emailError = validateEmail(normalizedEmail);
  if (emailError) return res.status(400).json({ message: emailError });
  const passwordError = validatePassword(password);
  if (passwordError) return res.status(400).json({ message: passwordError });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (!await getAccessProfile(client, rol)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'El perfil de usuario seleccionado no existe o está inactivo.' });
    }
    const selectedPermissions = rol === 'lector'
      ? await getRecommendedPermissions(client, rol)
      : req.body.permissions === undefined
        ? await getRecommendedPermissions(client, rol)
        : req.body.permissions;
    const permissionValidation = await validatePermissionSelection(client, selectedPermissions);
    if (permissionValidation.error) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: permissionValidation.error });
    }
    const hash = await bcrypt.hash(password, 12);
    const safeName = sanitizeText(nombre).slice(0, 100);
    const safeCargo = sanitizeText(cargo).slice(0, 100);
    if (safeName.length < 2 || safeCargo.length < 2) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'El nombre y el cargo del personal son obligatorios.' });
    }
    const created = await client.query(
      `INSERT INTO usuarios (correo, password_hash, rol, nombre, cargo, debe_cambiar_password)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING id, correo, rol, nombre, cargo, fecha_creacion, activo, debe_cambiar_password`,
      [normalizedEmail, hash, rol, safeName, safeCargo]
    );
    await client.query(`
      INSERT INTO perfiles_personales (usuario_id, nombre_mostrado, actualizado_por)
      VALUES ($1, $2, $3)
      ON CONFLICT (usuario_id) DO NOTHING
    `, [created.rows[0].id, safeName, req.user.id]);
    await replaceUserPermissionOverrides(client, {
      userId: created.rows[0].id,
      role: rol,
      permissions: permissionValidation.permissions,
      updatedBy: req.user.id
    });
    const createdUser = await attachPermissionProfile(client, created.rows[0]);
    await insertarAudit(client, {
      usuario_id: req.user.id,
      usuario_correo: req.user.correo,
      accion: 'CREAR_USUARIO',
      entidad: 'usuario',
      entidad_id: created.rows[0].id,
      detalle: {
        correo: normalizedEmail,
        rol,
        nombre: safeName,
        cargo: safeCargo,
        permisos: createdUser.permissions
      },
      ip: getClientIp(req)
    });
    await client.query('COMMIT');
    res.status(201).json({ message: 'Cuenta creada con contraseña temporal.', user: createdUser });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Ya existe una cuenta con ese correo.' });
    }
    console.error('[users:create]', err.message);
    res.status(500).json({ message: 'Error al crear la cuenta.' });
  } finally {
    client.release();
  }
});

app.put('/api/users/:id', verifyToken, verifyPermission('users.manage'), async (req, res) => {
  const { id } = req.params;
  const { correo, password, rol, nombre, cargo } = req.body;
  const normalizedEmail = normalizeEmail(correo);
  const emailError = validateEmail(normalizedEmail);
  if (emailError) return res.status(400).json({ message: emailError });
  if (password) {
    const passwordError = validatePassword(password);
    if (passwordError) return res.status(400).json({ message: passwordError });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const targetRes = await client.query('SELECT * FROM usuarios WHERE id = $1 AND eliminado_en IS NULL FOR UPDATE', [id]);
    if (targetRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Usuario no encontrado.' });
    }
    const target = targetRes.rows[0];
    if (!await getAccessProfile(client, rol, { includeInactive: target.rol === rol })) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'El perfil de usuario seleccionado no existe o está inactivo.' });
    }

    const currentProfile = await attachPermissionProfile(client, target);
    const selectedPermissions = rol === 'lector'
      ? await getRecommendedPermissions(client, rol)
      : req.body.permissions === undefined
        ? currentProfile.permissions
        : req.body.permissions;
    const permissionValidation = await validatePermissionSelection(client, selectedPermissions);
    if (permissionValidation.error) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: permissionValidation.error });
    }

    if (target.activo
      && currentProfile.permissions.includes('users.manage')
      && !permissionValidation.permissions.includes('users.manage')
      && await countActivePermissionHolders(client, 'users.manage', target.id) === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Debe existir al menos una cuenta activa capaz de administrar usuarios.' });
    }

    const safeName = sanitizeText(nombre).slice(0, 100);
    const safeCargo = sanitizeText(cargo).slice(0, 100);
    if (safeName.length < 2 || safeCargo.length < 2) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'El nombre y el cargo del personal son obligatorios.' });
    }
    const permissionsChanged = JSON.stringify([...currentProfile.permissions].sort())
      !== JSON.stringify([...permissionValidation.permissions].sort());
    const securityChanged = target.correo !== normalizedEmail || target.rol !== rol || Boolean(password) || permissionsChanged;
    let hash = null;
    if (password) {
      hash = await bcrypt.hash(password, 12);
    }

    const updated = await client.query(`
      UPDATE usuarios
      SET correo = $1,
          password_hash = COALESCE($2, password_hash),
          rol = $3,
          nombre = $4,
          cargo = $5,
          debe_cambiar_password = CASE
            WHEN $2::text IS NOT NULL AND id <> $6 THEN true
            WHEN $2::text IS NOT NULL THEN false
            ELSE debe_cambiar_password
          END,
          password_actualizado_en = CASE WHEN $2::text IS NOT NULL THEN CURRENT_TIMESTAMP ELSE password_actualizado_en END,
          token_version = token_version + CASE WHEN $7 THEN 1 ELSE 0 END
      WHERE id = $8
      RETURNING id, correo, rol, nombre, cargo, token_version, fecha_creacion, activo,
                debe_cambiar_password, ultimo_acceso, password_actualizado_en
    `, [normalizedEmail, hash, rol, safeName, safeCargo, req.user.id, securityChanged, id]);

    await replaceUserPermissionOverrides(client, {
      userId: target.id,
      role: rol,
      permissions: permissionValidation.permissions,
      updatedBy: req.user.id
    });
    const updatedUser = await attachPermissionProfile(client, updated.rows[0]);

    await insertarAudit(client, {
      usuario_id: req.user.id,
      usuario_correo: req.user.correo,
      accion: 'EDITAR_USUARIO',
      entidad: 'usuario',
      entidad_id: parseInt(id, 10),
      detalle: {
        antes: { correo: target.correo, rol: target.rol, nombre: target.nombre, cargo: target.cargo, permisos: currentProfile.permissions },
        despues: { correo: normalizedEmail, rol, nombre: safeName, cargo: safeCargo, permisos: updatedUser.permissions },
        cambio_password: Boolean(password)
      },
      ip: getClientIp(req)
    });
    await client.query('COMMIT');

    if (parseInt(id, 10) === req.user.id && securityChanged) setSessionCookie(res, updatedUser);
    res.json({ message: 'Usuario actualizado.', user: updatedUser });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') {
      return res.status(409).json({ message: 'Ya existe una cuenta con ese correo.' });
    }
    console.error('[users:update]', err.message);
    res.status(500).json({ message: 'Error al actualizar usuario.' });
  } finally {
    client.release();
  }
});

const setUserActiveStatus = async (req, res, forcedStatus = null) => {
  const { id } = req.params;
  const requestedStatus = forcedStatus === null ? req.body?.activo : forcedStatus;
  if (typeof requestedStatus !== 'boolean') {
    return res.status(400).json({ message: 'El estado activo debe ser verdadero o falso.' });
  }
  if (!requestedStatus && parseInt(id, 10) === req.user.id) {
    return res.status(409).json({ message: 'No puedes desactivar la cuenta con la que tienes la sesión iniciada.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const targetRes = await client.query('SELECT id, correo, rol, nombre, cargo, activo FROM usuarios WHERE id = $1 AND eliminado_en IS NULL FOR UPDATE', [id]);
    if (targetRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Usuario no encontrado.' });
    }
    const target = targetRes.rows[0];
    const targetProfile = await attachPermissionProfile(client, target);
    if (!requestedStatus
      && target.activo
      && targetProfile.permissions.includes('users.manage')
      && await countActivePermissionHolders(client, 'users.manage', target.id) === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Debe existir al menos una cuenta activa capaz de administrar usuarios.' });
    }

    const updated = await client.query(`
      UPDATE usuarios
      SET activo = $1,
          token_version = token_version + CASE WHEN activo IS DISTINCT FROM $1 THEN 1 ELSE 0 END,
          intentos_fallidos = CASE WHEN $1 THEN 0 ELSE intentos_fallidos END,
          bloqueado_hasta = CASE WHEN $1 THEN NULL ELSE bloqueado_hasta END
      WHERE id = $2
      RETURNING id, correo, rol, nombre, cargo, activo, debe_cambiar_password, fecha_creacion,
                ultimo_acceso, password_actualizado_en
    `, [requestedStatus, id]);

    const action = requestedStatus ? 'ACTIVAR_USUARIO' : 'DESACTIVAR_USUARIO';
    await insertarAudit(client, {
      usuario_id: req.user.id,
      usuario_correo: req.user.correo,
      accion: action,
      entidad: 'usuario',
      entidad_id: parseInt(id, 10),
      detalle: { correo: target.correo, rol: target.rol, nombre: target.nombre, activo: requestedStatus },
      ip: getClientIp(req)
    });
    await client.query('COMMIT');
    res.json({
      message: requestedStatus ? 'Usuario activado.' : 'Usuario desactivado.',
      user: updated.rows[0]
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ message: 'Error al cambiar el estado del usuario.' });
  } finally {
    client.release();
  }
};

app.patch('/api/users/:id/status', verifyToken, verifyPermission('users.manage'), (req, res) => setUserActiveStatus(req, res));

app.delete('/api/users/:id', verifyToken, verifyPermission('users.manage'), async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  const reason = sanitizeText(req.body?.motivo).slice(0, 280);
  if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ message: 'La cuenta seleccionada no es válida.' });
  if (userId === req.user.id) return res.status(409).json({ message: 'No puedes eliminar la cuenta con la que tienes la sesión iniciada.' });
  if (reason.length < 8) return res.status(400).json({ message: 'Indica un motivo de eliminación de al menos 8 caracteres.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const targetRes = await client.query(
      'SELECT id, correo, rol, nombre, cargo, activo FROM usuarios WHERE id = $1 AND eliminado_en IS NULL FOR UPDATE',
      [userId]
    );
    if (!targetRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'La cuenta no existe o ya fue eliminada.' });
    }

    const target = targetRes.rows[0];
    const targetProfile = await attachPermissionProfile(client, target);
    if (target.activo
      && targetProfile.permissions.includes('users.manage')
      && await countActivePermissionHolders(client, 'users.manage', target.id) === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Debe existir al menos una cuenta activa capaz de administrar usuarios.' });
    }

    await client.query(`
      UPDATE usuarios
      SET activo = false,
          eliminado_en = CURRENT_TIMESTAMP,
          eliminado_por = $1,
          motivo_eliminacion = $2,
          token_version = token_version + 1,
          bloqueado_hasta = NULL
      WHERE id = $3
    `, [req.user.id, reason, userId]);

    await insertarAudit(client, {
      usuario_id: req.user.id,
      usuario_correo: req.user.correo,
      accion: 'ELIMINAR_USUARIO',
      entidad: 'usuario',
      entidad_id: userId,
      detalle: {
        cuenta_eliminada: { correo: target.correo, nombre: target.nombre, cargo: target.cargo, rol: target.rol },
        motivo: reason
      },
      ip: getClientIp(req)
    });
    await client.query('COMMIT');
    res.json({ message: 'Cuenta eliminada. Su historial institucional se conserva en auditoría.' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[users:delete]', err.message);
    res.status(500).json({ message: 'No fue posible eliminar la cuenta.' });
  } finally {
    client.release();
  }
});
};

module.exports = { registerUserRoutes };
