const PROFILE_STATUS = new Set([
  'SIN_ESTADO',
  'DISPONIBLE',
  'OCUPADO',
  'EN_REUNION',
  'EN_TERRENO',
  'FUERA',
  'AUSENTE',
  'NO_MOLESTAR'
]);

const cleanProfileText = (value, maxLength) => {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
};

const normalizeProfileStatus = (value) => {
  const normalized = String(value || 'SIN_ESTADO').trim().toUpperCase();
  if (!PROFILE_STATUS.has(normalized)) throw new Error('El estado de disponibilidad no es válido.');
  return normalized;
};

const normalizeStatusUntil = (value, status) => {
  if (!value || status === 'SIN_ESTADO') return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('La vigencia del estado no es válida.');
  if (parsed.getTime() <= Date.now()) throw new Error('La vigencia del estado debe quedar en el futuro.');
  const max = Date.now() + (180 * 24 * 60 * 60 * 1000);
  if (parsed.getTime() > max) throw new Error('La vigencia del estado no puede superar 180 días.');
  return parsed.toISOString();
};

const normalizeOwnProfilePayload = (body = {}) => {
  const status = normalizeProfileStatus(body.estado_disponibilidad);
  return {
    nombre_mostrado: cleanProfileText(body.nombre_mostrado, 120),
    biografia: cleanProfileText(body.biografia, 600),
    ubicacion: cleanProfileText(body.ubicacion, 160),
    anexo: cleanProfileText(body.anexo, 30),
    telefono_interno: cleanProfileText(body.telefono_interno, 40),
    horario_trabajo: cleanProfileText(body.horario_trabajo, 180),
    estado_disponibilidad: status,
    mensaje_estado: cleanProfileText(body.mensaje_estado, 180),
    estado_hasta: normalizeStatusUntil(body.estado_hasta, status),
    mostrar_contacto: body.mostrar_contacto !== false
  };
};

const normalizeManagedProfilePayload = (body = {}) => ({
  area: cleanProfileText(body.area, 120),
  visible_directorio: body.visible_directorio !== false,
  cuenta_compartida: body.cuenta_compartida === true
});

const normalizeDirectoryText = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

const DIRECTORY_SORTS = new Set(['name_asc', 'name_desc', 'area', 'status']);
const DIRECTORY_ACCOUNT_TYPES = new Set(['personal', 'shared']);

const filterDirectoryProfiles = (profiles = [], criteria = {}) => {
  const search = normalizeDirectoryText(criteria.search).slice(0, 100);
  const area = normalizeDirectoryText(criteria.area).slice(0, 120);
  const cargo = normalizeDirectoryText(criteria.cargo).slice(0, 120);
  const status = PROFILE_STATUS.has(String(criteria.status || '').toUpperCase())
    ? String(criteria.status).toUpperCase()
    : '';
  const accountType = DIRECTORY_ACCOUNT_TYPES.has(criteria.account_type) ? criteria.account_type : '';
  const sort = DIRECTORY_SORTS.has(criteria.sort) ? criteria.sort : 'name_asc';

  const result = profiles.filter((profile) => {
    const searchable = normalizeDirectoryText([
      profile.nombre_mostrado,
      profile.nombre_oficial,
      profile.cargo,
      profile.area,
      profile.perfil_acceso,
      profile.ubicacion
    ].filter(Boolean).join(' '));
    if (search && !searchable.includes(search)) return false;
    if (area && normalizeDirectoryText(profile.area || 'Equipo institucional') !== area) return false;
    if (cargo && normalizeDirectoryText(profile.cargo || profile.perfil_acceso) !== cargo) return false;
    if (status && profile.estado_disponibilidad !== status) return false;
    if (accountType === 'shared' && !profile.cuenta_compartida) return false;
    if (accountType === 'personal' && profile.cuenta_compartida) return false;
    return true;
  });

  const compareText = (left, right) => normalizeDirectoryText(left).localeCompare(
    normalizeDirectoryText(right),
    'es',
    { sensitivity: 'base', numeric: true }
  );
  result.sort((left, right) => {
    if (sort === 'name_desc') return compareText(right.nombre_mostrado, left.nombre_mostrado);
    if (sort === 'area') return compareText(left.area || 'Equipo institucional', right.area || 'Equipo institucional')
      || compareText(left.nombre_mostrado, right.nombre_mostrado);
    if (sort === 'status') return compareText(left.estado_disponibilidad, right.estado_disponibilidad)
      || compareText(left.nombre_mostrado, right.nombre_mostrado);
    return compareText(left.nombre_mostrado, right.nombre_mostrado);
  });
  return result;
};

const buildDirectoryFacets = (profiles = []) => {
  const unique = (values) => [...new Set(values.filter(Boolean))]
    .sort((left, right) => normalizeDirectoryText(left).localeCompare(normalizeDirectoryText(right), 'es', { sensitivity: 'base' }));
  return {
    areas: unique(profiles.map((profile) => profile.area || 'Equipo institucional')),
    cargos: unique(profiles.map((profile) => profile.cargo || profile.perfil_acceso)),
    statuses: [...PROFILE_STATUS].filter((status) => profiles.some((profile) => profile.estado_disponibilidad === status)),
    account_types: ['personal', 'shared']
  };
};

const ensurePersonalProfile = async (queryable, userId, updatedBy = userId) => {
  await queryable.query(`
    INSERT INTO perfiles_personales (usuario_id, nombre_mostrado, actualizado_por)
    SELECT id, NULLIF(BTRIM(nombre), ''), $2
    FROM usuarios
    WHERE id = $1 AND eliminado_en IS NULL
    ON CONFLICT (usuario_id) DO NOTHING
  `, [userId, updatedBy]);
};

const profileSelect = `
  SELECT u.id AS usuario_id, u.nombre AS nombre_oficial, u.correo, u.cargo, u.rol,
         pa.nombre AS perfil_acceso,
         pp.nombre_mostrado, pp.biografia, pp.area, pp.ubicacion, pp.anexo,
         pp.telefono_interno, pp.horario_trabajo, pp.estado_disponibilidad,
         pp.mensaje_estado, pp.estado_hasta, pp.visible_directorio,
         pp.mostrar_contacto, pp.cuenta_compartida, pp.avatar_archivo_id,
         pp.portada_archivo_id, pp.actualizado_en
  FROM usuarios u
  LEFT JOIN perfiles_acceso pa ON pa.codigo = u.rol
  LEFT JOIN perfiles_personales pp ON pp.usuario_id = u.id
`;

const serializePersonalProfile = (row, { includeContact = true, respectContactVisibility = true } = {}) => {
  if (!row) return null;
  const displayName = row.nombre_mostrado || row.nombre_oficial || row.correo;
  const contactVisible = includeContact && (!respectContactVisibility || row.mostrar_contacto !== false);
  const statusExpired = row.estado_hasta && new Date(row.estado_hasta).getTime() <= Date.now();
  return {
    usuario_id: row.usuario_id,
    nombre_oficial: row.nombre_oficial,
    nombre_mostrado: displayName,
    correo: contactVisible ? row.correo : null,
    cargo: row.cargo || null,
    area: row.area || null,
    perfil_acceso: row.perfil_acceso || row.rol,
    biografia: row.biografia || null,
    ubicacion: contactVisible ? row.ubicacion || null : null,
    anexo: contactVisible ? row.anexo || null : null,
    telefono_interno: contactVisible ? row.telefono_interno || null : null,
    horario_trabajo: row.horario_trabajo || null,
    estado_disponibilidad: statusExpired ? 'SIN_ESTADO' : row.estado_disponibilidad || 'SIN_ESTADO',
    mensaje_estado: statusExpired ? null : row.mensaje_estado || null,
    estado_hasta: statusExpired ? null : row.estado_hasta || null,
    visible_directorio: row.visible_directorio !== false,
    mostrar_contacto: row.mostrar_contacto !== false,
    cuenta_compartida: row.cuenta_compartida === true,
    avatar_archivo_id: row.avatar_archivo_id || null,
    portada_archivo_id: row.portada_archivo_id || null,
    avatar_url: row.avatar_archivo_id ? `/api/profile-media/${row.avatar_archivo_id}/thumb` : null,
    avatar_full_url: row.avatar_archivo_id ? `/api/profile-media/${row.avatar_archivo_id}/main` : null,
    avatar_source_url: row.avatar_archivo_id ? `/api/profile-media/${row.avatar_archivo_id}/source` : null,
    portada_url: row.portada_archivo_id ? `/api/profile-media/${row.portada_archivo_id}/main` : null,
    portada_source_url: row.portada_archivo_id ? `/api/profile-media/${row.portada_archivo_id}/source` : null,
    actualizado_en: row.actualizado_en || null
  };
};

const getPersonalProfile = async (queryable, userId, options = {}) => {
  await ensurePersonalProfile(queryable, userId, options.updatedBy || userId);
  const result = await queryable.query(`${profileSelect}
    WHERE u.id = $1 AND u.eliminado_en IS NULL
    LIMIT 1
  `, [userId]);
  return serializePersonalProfile(result.rows[0], options);
};

const getPersonalProfileSummary = async (queryable, userId) => {
  const result = await queryable.query(`${profileSelect}
    WHERE u.id = $1 AND u.eliminado_en IS NULL
    LIMIT 1
  `, [userId]);
  const profile = serializePersonalProfile(result.rows[0], { includeContact: false });
  if (!profile) return null;
  return {
    nombre_mostrado: profile.nombre_mostrado,
    estado_disponibilidad: profile.estado_disponibilidad,
    cuenta_compartida: profile.cuenta_compartida,
    avatar_url: profile.avatar_url
  };
};

module.exports = {
  PROFILE_STATUS,
  buildDirectoryFacets,
  ensurePersonalProfile,
  filterDirectoryProfiles,
  getPersonalProfile,
  getPersonalProfileSummary,
  normalizeManagedProfilePayload,
  normalizeOwnProfilePayload,
  profileSelect,
  serializePersonalProfile
};
