const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildDirectoryFacets,
  filterDirectoryProfiles,
  normalizeManagedProfilePayload,
  normalizeOwnProfilePayload,
  serializePersonalProfile
} = require('../services/personalProfileService');

const directoryRows = [
  { usuario_id: 1, nombre_mostrado: 'María González', cargo: 'Inspectora de piso', area: 'Inspectoría', perfil_acceso: 'Inspectoría', estado_disponibilidad: 'DISPONIBLE', cuenta_compartida: false },
  { usuario_id: 2, nombre_mostrado: 'Portería', cargo: 'Portería', area: null, perfil_acceso: 'Lector', estado_disponibilidad: 'SIN_ESTADO', cuenta_compartida: true },
  { usuario_id: 3, nombre_mostrado: 'Ana Pérez', cargo: 'Directora', area: 'Dirección', perfil_acceso: 'Dirección', estado_disponibilidad: 'EN_REUNION', cuenta_compartida: false }
];

test('normaliza solamente los campos personales autorizados', () => {
  const payload = normalizeOwnProfilePayload({
    nombre_mostrado: '  Maria\nGonzalez  ',
    biografia: ' Inspectora de piso ',
    ubicacion: ' Primer piso ',
    anexo: ' 204 ',
    telefono_interno: ' +56 41 000 0000 ',
    horario_trabajo: ' 08:00 a 17:00 ',
    estado_disponibilidad: 'disponible',
    mensaje_estado: ' En oficina ',
    mostrar_contacto: false,
    rol: 'admin'
  });

  assert.equal(payload.nombre_mostrado, 'Maria Gonzalez');
  assert.equal(payload.estado_disponibilidad, 'DISPONIBLE');
  assert.equal(payload.mostrar_contacto, false);
  assert.equal(Object.hasOwn(payload, 'rol'), false);
});

test('rechaza estados desconocidos y vigencias vencidas', () => {
  assert.throws(() => normalizeOwnProfilePayload({ estado_disponibilidad: 'VACACIONES' }), /no es válido/i);
  assert.throws(() => normalizeOwnProfilePayload({
    estado_disponibilidad: 'OCUPADO',
    estado_hasta: new Date(Date.now() - 60_000).toISOString()
  }), /futuro/i);
});

test('separa los campos administrados de los campos editables por la persona', () => {
  const payload = normalizeManagedProfilePayload({
    area: ' Inspectoria General ',
    visible_directorio: false,
    cuenta_compartida: true,
    biografia: 'No debe copiarse'
  });
  assert.deepEqual(payload, {
    area: 'Inspectoria General',
    visible_directorio: false,
    cuenta_compartida: true
  });
});

test('filtra el directorio combinando búsqueda sin acentos, área, estado y tipo de cuenta', () => {
  assert.deepEqual(filterDirectoryProfiles(directoryRows, { search: 'maria' }).map((row) => row.usuario_id), [1]);
  assert.deepEqual(filterDirectoryProfiles(directoryRows, { area: 'direccion', status: 'EN_REUNION' }).map((row) => row.usuario_id), [3]);
  assert.deepEqual(filterDirectoryProfiles(directoryRows, { account_type: 'shared' }).map((row) => row.usuario_id), [2]);
  assert.deepEqual(filterDirectoryProfiles(directoryRows, { cargo: 'inspectora de piso' }).map((row) => row.usuario_id), [1]);
});

test('construye filtros disponibles y ordena el directorio de forma estable', () => {
  const facets = buildDirectoryFacets(directoryRows);
  assert.deepEqual(facets.areas, ['Dirección', 'Equipo institucional', 'Inspectoría']);
  assert.ok(facets.cargos.includes('Portería'));
  assert.deepEqual(filterDirectoryProfiles(directoryRows, { sort: 'name_desc' }).map((row) => row.usuario_id), [2, 1, 3]);
});

test('oculta contacto en el directorio pero lo conserva para la persona propietaria', () => {
  const row = {
    usuario_id: 7,
    nombre_oficial: 'Maria Gonzalez',
    nombre_mostrado: null,
    correo: 'maria@ldsm.local',
    cargo: 'Inspectora',
    rol: 'inspector',
    perfil_acceso: 'Inspectoria',
    mostrar_contacto: false,
    ubicacion: 'Primer piso',
    anexo: '204',
    telefono_interno: '+56 41 000 0000',
    visible_directorio: true,
    cuenta_compartida: false
  };

  const directory = serializePersonalProfile(row, { includeContact: true });
  const owner = serializePersonalProfile(row, { includeContact: true, respectContactVisibility: false });
  assert.equal(directory.correo, null);
  assert.equal(directory.ubicacion, null);
  assert.equal(owner.correo, 'maria@ldsm.local');
  assert.equal(owner.ubicacion, 'Primer piso');
});

test('un estado temporal vencido vuelve a sin estado al presentarse', () => {
  const result = serializePersonalProfile({
    usuario_id: 8,
    correo: 'equipo@ldsm.local',
    estado_disponibilidad: 'OCUPADO',
    mensaje_estado: 'En reunion',
    estado_hasta: new Date(Date.now() - 1_000).toISOString(),
    visible_directorio: true,
    mostrar_contacto: true
  });
  assert.equal(result.estado_disponibilidad, 'SIN_ESTADO');
  assert.equal(result.mensaje_estado, null);
  assert.equal(result.estado_hasta, null);
});

test('reprocesa imágenes de perfil sin conservar metadatos y guarda una fuente reeditable', async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ldsm-profile-'));
  const previousUploadsDir = process.env.UPLOADS_DIR;
  process.env.UPLOADS_DIR = temporaryRoot;
  const sharp = require('sharp');
  const servicePath = require.resolve('../services/profileMediaService');
  delete require.cache[servicePath];
  const { processProfileImage, removeProfileImageFiles } = require('../services/profileMediaService');

  const source = await sharp({
    create: { width: 900, height: 700, channels: 3, background: '#175f8a' }
  }).jpeg().withMetadata({ comment: 'dato que no debe persistir' }).toBuffer();

  const media = await processProfileImage({
    dataUrl: `data:image/jpeg;base64,${source.toString('base64')}`,
    category: 'avatar',
    userId: 4
  });

  const mainPath = path.join(temporaryRoot, 'profiles', media.mainName);
  const thumbPath = path.join(temporaryRoot, 'profiles', media.thumbName);
  const sourcePath = path.join(temporaryRoot, 'profiles', media.sourceName);
  assert.equal(fs.existsSync(mainPath), true);
  assert.equal(fs.existsSync(thumbPath), true);
  assert.equal(fs.existsSync(sourcePath), true);
  const metadata = await sharp(fs.readFileSync(mainPath)).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.width, 640);
  assert.equal(metadata.height, 640);
  const sourceMetadata = await sharp(fs.readFileSync(sourcePath)).metadata();
  assert.equal(sourceMetadata.format, 'webp');
  assert.equal(sourceMetadata.exif, undefined);
  assert.ok(media.sourceBytes > 0);
  assert.match(media.sourceSha256, /^[a-f0-9]{64}$/);

  removeProfileImageFiles({ nombre_principal: media.mainName, nombre_miniatura: media.thumbName, nombre_fuente: media.sourceName });
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
  if (previousUploadsDir === undefined) delete process.env.UPLOADS_DIR;
  else process.env.UPLOADS_DIR = previousUploadsDir;
});

test('la portada procesada conserva exactamente la proporción institucional', async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ldsm-cover-'));
  const previousUploadsDir = process.env.UPLOADS_DIR;
  process.env.UPLOADS_DIR = temporaryRoot;
  const sharp = require('sharp');
  const servicePath = require.resolve('../services/profileMediaService');
  delete require.cache[servicePath];
  const { processProfileImage, removeProfileImageFiles } = require('../services/profileMediaService');

  const source = await sharp({
    create: { width: 1500, height: 900, channels: 3, background: '#0b3741' }
  }).jpeg().toBuffer();
  const media = await processProfileImage({
    dataUrl: `data:image/jpeg;base64,${source.toString('base64')}`,
    category: 'portada',
    userId: 5
  });

  const metadata = await sharp(fs.readFileSync(path.join(temporaryRoot, 'profiles', media.mainName))).metadata();
  assert.equal(metadata.width, 1800);
  assert.equal(metadata.height, 600);
  assert.equal(media.width, 1800);
  assert.equal(media.height, 600);

  removeProfileImageFiles({ nombre_principal: media.mainName, nombre_miniatura: media.thumbName, nombre_fuente: media.sourceName });
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
  if (previousUploadsDir === undefined) delete process.env.UPLOADS_DIR;
  else process.env.UPLOADS_DIR = previousUploadsDir;
});

test('las rutas de perfil exigen permisos y registran cambios sensibles', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'profiles.js'), 'utf8');
  assert.match(source, /verifyPermission\('profiles\.own\.edit'\)/);
  assert.match(source, /verifyPermission\('profiles\.directory\.view'\)/);
  assert.match(source, /verifyPermission\('profiles\.manage'\)/);
  assert.match(source, /ACTUALIZAR_PERFIL_PROPIO/);
  assert.match(source, /ACTUALIZAR_AVATAR/);
  assert.match(source, /ADMINISTRAR_PERFIL_PERSONAL/);
  assert.match(source, /source_data_url/);
  assert.match(source, /nombre_fuente/);
  assert.match(source, /\['main', 'thumb', 'source'\]/);
  assert.doesNotMatch(source, /await client\.query\('COMMIT'\);\s*const profile = await getPersonalProfile/u);
  assert.match(source, /const profile = await getPersonalProfile\(client,[\s\S]{0,180}await client\.query\('COMMIT'\)/u);
});
