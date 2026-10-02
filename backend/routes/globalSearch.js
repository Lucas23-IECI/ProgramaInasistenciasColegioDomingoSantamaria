const express = require('express');

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 80;
const RESULTS_PER_GROUP = 6;

const DOMAIN_PERMISSIONS = {
  students: ['students.view', 'students.manage', 'students.import', 'withdrawals.import_guardians'],
  directory: ['profiles.directory.view'],
  followUp: ['seguimiento.view'],
  documents: ['documents.view'],
  coexistence: ['convivencia.view'],
  visits: ['visits.view', 'visits.history'],
  withdrawals: [
    'visits.view',
    'visits.history',
    'withdrawals.register',
    'withdrawals.approve',
    'withdrawals.authorizations'
  ]
};

const normalizeSearchQuery = (value) => String(value || '')
  .replace(/[\\%_]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, MAX_QUERY_LENGTH);

const canSearchDomain = (permissions, domain) => {
  const available = new Set(Array.isArray(permissions) ? permissions : []);
  return (DOMAIN_PERMISSIONS[domain] || []).some((permission) => available.has(permission));
};

const formatState = (value) => String(value || '')
  .toLowerCase()
  .replace(/_/g, ' ')
  .replace(/^./, (letter) => letter.toUpperCase());

const SEARCH_DOMAINS = [
  {
    key: 'students',
    label: 'Estudiantes',
    query: `
      /* global-search:students */
      SELECT a.id_alumno AS id,
             trim(concat_ws(' ', a.nombres, a.paterno, a.materno)) AS title,
             COALESCE(c.nombre_curso, 'Sin curso') AS subtitle
      FROM alumno a
      LEFT JOIN matricula_actual m ON m.id_alumno = a.id_alumno
      LEFT JOIN curso c ON c.id_curso = m.id_curso
      WHERE a.activo = true
        AND (
          trim(concat_ws(' ', a.nombres, a.paterno, a.materno)) ILIKE '%' || $1 || '%'
          OR COALESCE(a.rut, '') ILIKE '%' || $1 || '%'
          OR COALESCE(a.documento_erp, '') ILIKE '%' || $1 || '%'
          OR COALESCE(a.uuid_erp, '') ILIKE '%' || $1 || '%'
          OR COALESCE(a.codigo_barra, '') ILIKE '%' || $1 || '%'
          OR EXISTS (
            SELECT 1 FROM alumno_identificador ai
            WHERE ai.id_alumno = a.id_alumno
              AND ai.estado <> 'REVOCADO'
              AND (ai.valor_original ILIKE '%' || $1 || '%' OR ai.valor_normalizado ILIKE '%' || $1 || '%')
          )
        )
      ORDER BY lower(a.paterno), lower(a.nombres), a.id_alumno
      LIMIT $2
    `,
    map: (row) => ({
      id: String(row.id),
      type: 'student',
      title: row.title,
      subtitle: row.subtitle,
      url: `/admin/estudiantes?estudiante_id=${encodeURIComponent(row.id)}`
    })
  },
  {
    key: 'directory',
    label: 'Equipo institucional',
    query: `
      /* global-search:directory */
      SELECT u.id,
             COALESCE(NULLIF(trim(pp.nombre_mostrado), ''), NULLIF(trim(u.nombre), ''), 'Cuenta institucional') AS title,
             COALESCE(NULLIF(trim(u.cargo), ''), NULLIF(trim(pp.area), ''), pa.nombre, 'Personal') AS subtitle,
             NULLIF(trim(pp.area), '') AS meta
      FROM usuarios u
      LEFT JOIN perfiles_personales pp ON pp.usuario_id = u.id
      LEFT JOIN perfiles_acceso pa ON pa.codigo = u.rol
      WHERE u.activo = true
        AND u.eliminado_en IS NULL
        AND COALESCE(pp.visible_directorio, true) = true
        AND (
          COALESCE(pp.nombre_mostrado, '') ILIKE '%' || $1 || '%'
          OR COALESCE(u.nombre, '') ILIKE '%' || $1 || '%'
          OR COALESCE(u.cargo, '') ILIKE '%' || $1 || '%'
          OR COALESCE(pp.area, '') ILIKE '%' || $1 || '%'
        )
      ORDER BY lower(COALESCE(NULLIF(trim(pp.nombre_mostrado), ''), NULLIF(trim(u.nombre), ''), 'Cuenta institucional'))
      LIMIT $2
    `,
    map: (row) => ({
      id: String(row.id),
      type: 'staff',
      title: row.title,
      subtitle: row.subtitle,
      meta: row.meta && row.meta !== row.subtitle ? row.meta : null,
      url: `/directorio/${encodeURIComponent(row.id)}`
    })
  },
  {
    key: 'followUp',
    label: 'Seguimientos',
    query: `
      /* global-search:follow-up */
      SELECT c.id_caso AS id, c.titulo AS title, c.codigo,
             c.estado, c.prioridad,
             trim(concat_ws(' ', a.nombres, a.paterno, a.materno)) AS student_name
      FROM seguimiento_casos c
      LEFT JOIN alumno a ON a.id_alumno = c.estudiante_principal_id
      WHERE c.codigo ILIKE '%' || $1 || '%'
         OR c.titulo ILIKE '%' || $1 || '%'
         OR trim(concat_ws(' ', a.nombres, a.paterno, a.materno)) ILIKE '%' || $1 || '%'
      ORDER BY c.actualizado_en DESC, c.id_caso DESC
      LIMIT $2
    `,
    map: (row) => ({
      id: String(row.id),
      type: 'follow-up',
      title: row.title,
      subtitle: [row.codigo, row.student_name].filter(Boolean).join(' · '),
      meta: `${formatState(row.estado)} · Prioridad ${formatState(row.prioridad)}`,
      url: `/admin/seguimiento/${encodeURIComponent(row.id)}`
    })
  },
  {
    key: 'documents',
    label: 'Documentos',
    query: `
      /* global-search:documents */
      SELECT d.id_documento_expediente AS id, d.titulo AS title,
             d.categoria, d.estado,
             trim(concat_ws(' ', a.nombres, a.paterno, a.materno)) AS student_name
      FROM documentos_expediente d
      JOIN expedientes_documentales e ON e.id_expediente = d.id_expediente
      JOIN alumno a ON a.id_alumno = e.id_alumno
      WHERE d.titulo ILIKE '%' || $1 || '%'
         OR d.categoria ILIKE '%' || $1 || '%'
         OR trim(concat_ws(' ', a.nombres, a.paterno, a.materno)) ILIKE '%' || $1 || '%'
      ORDER BY d.actualizado_en DESC, d.id_documento_expediente DESC
      LIMIT $2
    `,
    map: (row) => ({
      id: String(row.id),
      type: 'document',
      title: row.title,
      subtitle: row.student_name,
      meta: `${formatState(row.categoria)} · ${formatState(row.estado)}`,
      url: `/admin/documentos/ficha/${encodeURIComponent(row.id)}`
    })
  },
  {
    key: 'coexistence',
    label: 'Convivencia escolar',
    query: `
      /* global-search:coexistence */
      SELECT DISTINCT c.id_caso AS id, c.titulo AS title, c.codigo,
             c.estado, c.prioridad
      FROM convivencia_casos c
      LEFT JOIN convivencia_participantes p ON p.id_caso = c.id_caso AND p.activo = true
      LEFT JOIN alumno a ON a.id_alumno = p.estudiante_id
      LEFT JOIN usuarios u ON u.id = p.usuario_id
      WHERE c.codigo ILIKE '%' || $1 || '%'
         OR c.titulo ILIKE '%' || $1 || '%'
         OR trim(concat_ws(' ', a.nombres, a.paterno, a.materno)) ILIKE '%' || $1 || '%'
         OR COALESCE(u.nombre, '') ILIKE '%' || $1 || '%'
         OR COALESCE(p.nombre_externo, '') ILIKE '%' || $1 || '%'
      ORDER BY c.id_caso DESC
      LIMIT $2
    `,
    map: (row) => ({
      id: String(row.id),
      type: 'coexistence',
      title: row.title,
      subtitle: row.codigo,
      meta: `${formatState(row.estado)} · Prioridad ${formatState(row.prioridad)}`,
      url: `/admin/convivencia/${encodeURIComponent(row.id)}`
    })
  },
  {
    key: 'visits',
    label: 'Visitas',
    query: `
      /* global-search:visits */
      SELECT v.id, p.nombre_completo AS title, vd.nombre AS destination,
             v.estado, v.ingreso_en
      FROM visitas v
      JOIN visitantes p ON p.id = v.visitante_id
      JOIN visita_destinos vd ON vd.codigo = v.destino_codigo
      WHERE p.nombre_completo ILIKE '%' || $1 || '%'
         OR p.documento_numero ILIKE '%' || $1 || '%'
         OR vd.nombre ILIKE '%' || $1 || '%'
         OR COALESCE(v.persona_contactada, '') ILIKE '%' || $1 || '%'
      ORDER BY v.ingreso_en DESC, v.id DESC
      LIMIT $2
    `,
    map: (row) => ({
      id: String(row.id),
      type: 'visit',
      title: row.title,
      subtitle: `Destino: ${row.destination}`,
      meta: formatState(row.estado),
      url: `/admin/visitas?tab=historial&visita_id=${encodeURIComponent(row.id)}`
    })
  },
  {
    key: 'withdrawals',
    label: 'Retiros',
    query: `
      /* global-search:withdrawals */
      SELECT r.id, r.estado,
             trim(concat_ws(' ', a.nombres, a.paterno, a.materno)) AS title,
             p.nombre_completo AS guardian_name,
             COALESCE(c.nombre_curso, 'Sin curso') AS course
      FROM retiros_alumno r
      JOIN alumno a ON a.id_alumno = r.id_alumno
      JOIN visitantes p ON p.id = r.visitante_id
      LEFT JOIN matricula_actual m ON m.id_alumno = a.id_alumno
      LEFT JOIN curso c ON c.id_curso = m.id_curso
      WHERE trim(concat_ws(' ', a.nombres, a.paterno, a.materno)) ILIKE '%' || $1 || '%'
         OR p.nombre_completo ILIKE '%' || $1 || '%'
         OR p.documento_numero ILIKE '%' || $1 || '%'
      ORDER BY r.solicitado_en DESC, r.id DESC
      LIMIT $2
    `,
    map: (row) => ({
      id: String(row.id),
      type: 'withdrawal',
      title: row.title,
      subtitle: `${row.course} · Retira ${row.guardian_name}`,
      meta: formatState(row.estado),
      url: `/admin/visitas?tab=retiros&retiro_id=${encodeURIComponent(row.id)}`
    })
  }
];

const createGlobalSearchRouter = ({ pool, verifyToken, insertarAudit, getClientIp }) => {
  const router = express.Router();
  router.use(verifyToken);
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    next();
  });

  router.get('/', async (req, res) => {
    const query = normalizeSearchQuery(req.query.q);
    if (query.length < MIN_QUERY_LENGTH) {
      return res.json({ query, groups: [], total: 0 });
    }

    const searchableDomains = SEARCH_DOMAINS.filter((domain) => (
      canSearchDomain(req.user?.permissions, domain.key)
    ));
    if (searchableDomains.length === 0) {
      return res.status(403).json({ message: 'Tu cuenta no tiene acceso a secciones incluidas en la búsqueda institucional.' });
    }

    try {
      const groups = (await Promise.all(searchableDomains.map(async (domain) => {
        const result = await pool.query(domain.query, [query, RESULTS_PER_GROUP]);
        return {
          key: domain.key,
          label: domain.label,
          items: result.rows.map(domain.map)
        };
      }))).filter((group) => group.items.length > 0);

      const total = groups.reduce((count, group) => count + group.items.length, 0);
      if (typeof insertarAudit === 'function') {
        await insertarAudit(pool, {
          usuario_id: req.user.id,
          usuario_correo: req.user.correo,
          accion: 'CONSULTAR_BUSQUEDA_GLOBAL',
          entidad: 'busqueda_institucional',
          entidad_id: null,
          detalle: {
            dominios_consultados: searchableDomains.map((domain) => domain.key),
            dominios_con_resultados: groups.map((group) => group.key),
            cantidad_resultados: total
          },
          ip: typeof getClientIp === 'function' ? getClientIp(req) : ''
        });
      }

      return res.json({
        query,
        groups,
        total
      });
    } catch (error) {
      console.error('[busqueda-global]', error.message);
      return res.status(500).json({ message: 'No fue posible completar la búsqueda institucional. Inténtalo nuevamente.' });
    }
  });

  return router;
};

module.exports = {
  DOMAIN_PERMISSIONS,
  MIN_QUERY_LENGTH,
  RESULTS_PER_GROUP,
  canSearchDomain,
  createGlobalSearchRouter,
  normalizeSearchQuery
};
