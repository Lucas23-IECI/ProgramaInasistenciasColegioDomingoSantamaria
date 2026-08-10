# Arquitectura y migración segura

## Objetivo técnico

Extender las cuentas existentes con perfiles personales sin modificar la semántica de autenticación, autorización o registros operativos.

## Modelo propuesto

Los nombres definitivos podrán ajustarse durante la implementación, pero el contrato funcional será el siguiente.

### Tabla `perfiles_personales`

Relación uno a uno con `usuarios`.

| Campo | Propósito |
| --- | --- |
| `usuario_id` | Clave primaria y referencia a la cuenta existente |
| `nombre_visible` | Nombre preferido opcional |
| `biografia` | Presentación breve |
| `area` | Área o unidad visible |
| `ubicacion` | Oficina o lugar habitual |
| `anexo` | Anexo telefónico institucional |
| `telefono_interno` | Contacto opcional sujeto a visibilidad |
| `horario_texto` | Descripción simple del horario habitual |
| `estado` | Disponibilidad actual |
| `mensaje_estado` | Contexto breve del estado |
| `estado_hasta` | Vencimiento opcional del estado |
| `avatar_archivo_id` | Referencia a imagen vigente |
| `portada_archivo_id` | Referencia a portada vigente |
| `preferencias` | Preferencias controladas y validadas |
| `creado_en` | Fecha de creación |
| `actualizado_en` | Fecha de actualización |
| `actualizado_por` | Último responsable del cambio administrativo |

No se copiarán contraseñas, perfiles de acceso ni permisos a esta tabla.

### Tabla `archivos_perfil`

Metadatos de fotografías y portadas.

| Campo | Propósito |
| --- | --- |
| `id` | Identificador interno |
| `usuario_id` | Propietario del archivo |
| `categoria` | Avatar o portada |
| `nombre_almacenado` | Nombre aleatorio dentro del volumen |
| `mime_type` | Tipo detectado por contenido |
| `tamano_bytes` | Tamaño real |
| `ancho` y `alto` | Dimensiones verificadas |
| `sha256` | Integridad y deduplicación técnica |
| `variante` | Miniatura, mediana o principal |
| `estado` | Vigente, reemplazado o eliminado |
| `creado_por` | Responsable de la carga |
| `creado_en` | Fecha de carga |

Los archivos se almacenarán bajo un subdirectorio como `/uploads/profiles`, incluido en el volumen persistente y en los respaldos existentes.

## Compatibilidad con cuentas existentes

La API de perfil tendrá un fallback obligatorio:

1. Si existe `perfiles_personales`, combinará sus datos con `usuarios`.
2. Si no existe una fila personal, generará una representación utilizando `usuarios.nombre`, `usuarios.cargo` y el avatar predeterminado.
3. La ausencia de imagen o perfil nunca producirá un error de autenticación.

Esto permite desplegar frontend y backend de forma segura durante una transición controlada.

## Migración prevista

La siguiente migración disponible es la 030. La migración deberá:

1. Crear las tablas nuevas con `IF NOT EXISTS` cuando corresponda.
2. Crear restricciones e índices sin modificar registros académicos.
3. Insertar un perfil vacío por cada usuario no eliminado mediante `INSERT ... SELECT` y `ON CONFLICT DO NOTHING`.
4. Registrar los permisos nuevos.
5. No actualizar nombre, correo, cargo, rol, contraseña o permisos personalizados.
6. Ejecutarse dentro de una transacción cuando PostgreSQL permita todas las operaciones involucradas.
7. Ser segura al ejecutarse nuevamente.

## Elementos que la migración no puede tocar

- `alumno`.
- Matrículas.
- Registros de puntualidad.
- Visitas.
- Retiros.
- Apoderados y autorizaciones.
- Justificaciones.
- Documentos existentes.
- Hashes de contraseña.
- Tokens de sesión.
- Roles y permisos actuales.
- Registros de auditoría existentes.

## Permisos propuestos

| Código conceptual | Alcance |
| --- | --- |
| `profiles.directory.view` | Consultar el directorio interno |
| `profiles.own.edit` | Editar presentación y preferencias propias |
| `profiles.manage` | Administrar campos protegidos y perfiles de otras cuentas |
| `profiles.contact.view` | Consultar datos internos restringidos |
| `profiles.media.manage` | Moderar o retirar imágenes |
| `sessions.own.view` | Consultar sesiones propias |
| `sessions.manage` | Consultar o cerrar sesiones de otras cuentas |

Los códigos definitivos deberán seguir las convenciones del catálogo actual.

## API propuesta

### Perfil propio

- `GET /api/profile/me`
- `PATCH /api/profile/me`
- `POST /api/profile/me/avatar`
- `DELETE /api/profile/me/avatar`
- `POST /api/profile/me/cover`
- `DELETE /api/profile/me/cover`

### Directorio

- `GET /api/directory/staff`
- `GET /api/directory/staff/:userId`

### Administración

- `PATCH /api/users/:id/profile`
- `DELETE /api/users/:id/profile/avatar`
- `GET /api/users/:id/sessions`
- `DELETE /api/users/:id/sessions/:sessionId`

Las rutas administrativas no sustituirán las rutas existentes de creación y permisos de cuentas.

## Procesamiento de imágenes

La implementación deberá:

- Detectar el formato por contenido real.
- Aceptar únicamente formatos explícitos y seguros.
- Definir límites de bytes y dimensiones.
- Decodificar completamente antes de aceptar.
- Corregir orientación.
- Eliminar metadatos EXIF.
- Generar nombres aleatorios.
- Crear variantes pequeñas para listados.
- Aplicar recorte cuadrado al avatar.
- Aplicar proporción estable a la portada.
- Evitar servir rutas físicas directamente.

Tamaños de referencia:

- Avatar miniatura: 96 por 96.
- Avatar de perfil: 320 por 320.
- Portada: hasta 1600 por 480.

Los límites definitivos se validarán contra consumo de memoria y compatibilidad del PC escolar antes de implementarse.

## Valores predeterminados

### Avatar humano

Recurso vectorial o CSS propio con silueta neutra, alto contraste y compatibilidad con tema claro y oscuro. No dependerá de una URL externa.

### Cuenta institucional

Podrá utilizar `/institucional/escudo-ldsm-concepcion.jpg` mediante una marca explícita de cuenta compartida. No se inferirá únicamente desde el cargo.

### Portada

Composición local basada en la identidad visual institucional. No descargará imágenes desde redes sociales durante el uso normal.

## Auditoría

Acciones previstas:

- `EDITAR_PERFIL_PROPIO`.
- `EDITAR_PERFIL_USUARIO`.
- `CAMBIAR_AVATAR`.
- `ELIMINAR_AVATAR`.
- `CAMBIAR_PORTADA`.
- `ELIMINAR_PORTADA`.
- `CAMBIAR_ESTADO_PERSONAL`.
- `CONSULTAR_SESIONES_USUARIO`.
- `CERRAR_SESION_REMOTA`.

La auditoría no almacenará la imagen ni datos binarios.

## Recuperación y reversibilidad

- Antes del despliegue escolar se generará un respaldo completo.
- La migración se ensayará sobre una restauración temporal.
- Deshabilitar la interfaz nueva no impide que la autenticación continúe funcionando.
- Si fuera necesario revertir la versión de aplicación, las tablas adicionales podrán permanecer sin afectar el código anterior.
- No se eliminarán tablas nuevas automáticamente durante un rollback de aplicación.
- Los archivos huérfanos solo se limpiarán mediante una tarea explícita y auditada después de comprobar referencias.
