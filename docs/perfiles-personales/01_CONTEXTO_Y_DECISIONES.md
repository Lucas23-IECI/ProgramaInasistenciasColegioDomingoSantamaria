# Contexto y decisiones de producto

## Situación actual verificada

El sistema ya dispone de:

- Inicio de sesión mediante correo y contraseña.
- Sesión mediante cookie `HttpOnly`.
- Bloqueo temporal por intentos fallidos.
- Cambio obligatorio de contraseña.
- Nombre y cargo institucional en la cuenta.
- Perfiles de acceso configurables.
- Permisos recomendados y ajustes individuales.
- Activación, desactivación y eliminación lógica de cuentas.
- Auditoría individual de actividad.
- Iniciales generadas desde el nombre en el encabezado.

La respuesta pública actual de autenticación contiene ID, correo, perfil de acceso, nombre, cargo, cambio obligatorio de contraseña y permisos. El menú personal actual ofrece cambiar contraseña, consultar novedades y cerrar sesión. No existe una página `Mi perfil`, una fotografía persistida, una portada, una biografía o un directorio del personal.

## Problema que se resolverá

La cuenta identifica técnicamente a quien inició sesión, pero todavía no representa a la persona de una forma útil para la colaboración interna. Esto limita:

- Reconocer rápidamente a responsables y participantes.
- Encontrar a una persona por cargo o área.
- Asignar tareas y casos a una identidad visible.
- Mostrar disponibilidad o forma de contacto.
- Construir posteriormente notificaciones, chat y seguimiento institucional.

## Decisiones cerradas

### La fotografía es opcional

No se exigirá una fotografía para utilizar el sistema. La identidad debe continuar siendo clara mediante nombre, cargo y avatar predeterminado.

### Dos valores predeterminados diferentes

- Las personas usarán una silueta neutra cuando no tengan fotografía.
- Las cuentas compartidas o institucionales podrán utilizar el escudo del liceo.

El escudo no se utilizará como fotografía de todas las personas porque dificultaría distinguirlas.

### El perfil es interno

Los perfiles no serán páginas públicas. Solo podrán consultarlos cuentas autenticadas con los permisos correspondientes.

### El usuario controla su presentación, no su autoridad

La persona podrá editar fotografía, portada, presentación, disponibilidad y preferencias. El nombre institucional, correo de ingreso, cargo, perfil de acceso, permisos y estado de cuenta continuarán bajo control administrativo.

### No se vinculará con el padrón de estudiantes

`perfil_personal` se relacionará directamente con `usuarios`. No se reutilizará `alumno` ni se restaurará la vinculación experimental eliminada por la migración 007.

### Las imágenes no serán documentos escolares

No se almacenarán fotografías y portadas como certificados o justificaciones. Tendrán una entidad multimedia propia y utilizarán el mismo volumen persistente mediante un subdirectorio separado.

### No se almacenarán imágenes dentro de PostgreSQL

La base conservará metadatos y referencias. Los archivos optimizados permanecerán en el volumen de archivos que ya participa en respaldos.

### No se mostrará vigilancia de presencia

El estado de disponibilidad será declarado por la persona o por reglas explícitas. El sistema no mostrará públicamente una medición invasiva de última actividad.

## Propiedad de los datos

### Editables por la propia persona

- Fotografía.
- Portada.
- Nombre visible o preferido.
- Presentación breve.
- Estado y mensaje de disponibilidad.
- Horario habitual.
- Anexo interno.
- Oficina o ubicación informativa.
- Preferencias de visibilidad y notificación.

### Administrados por personal autorizado

- Nombre institucional oficial.
- Correo de ingreso.
- Cargo institucional.
- Área institucional oficial.
- Perfil de acceso.
- Permisos efectivos.
- Activación o eliminación de la cuenta.

### Administrados por el sistema

- ID de usuario.
- Fechas de creación y modificación.
- Último acceso.
- Sesiones y dispositivos.
- Versiones de seguridad.
- Auditoría.
- Metadatos técnicos de imágenes.

## Estados de disponibilidad iniciales

- Disponible.
- Ocupado.
- En reunión.
- En terreno.
- Fuera del establecimiento.
- Ausente.
- No molestar.

Un estado podrá incluir una fecha de vencimiento. Al expirar, regresará a `Disponible` o a un estado neutro definido por la institución.

## Experiencia esperada

### Menú del encabezado

Al tocar el avatar se ofrecerá:

- Ver mi perfil.
- Editar mi perfil.
- Notificaciones, cuando exista el módulo.
- Preferencias.
- Seguridad y sesiones.
- Cambiar contraseña.
- Novedades.
- Cerrar sesión.

### Página Mi perfil

Mostrará portada, avatar, nombre visible, nombre institucional cuando sea diferente, cargo, área, estado, presentación, contacto interno, horario y acción de edición. No mostrará públicamente la matriz técnica de permisos; esa información seguirá en `Usuarios y permisos`.

### Directorio institucional

Permitirá buscar por nombre, cargo, área, correo, ubicación o estado. Los resultados abrirán la ficha interna del integrante.

## Criterios de producto

- El perfil ayuda a trabajar; no intenta convertirse en una red social.
- Los campos vacíos no generan una pantalla incompleta o rota.
- Las acciones importantes mantienen texto además de iconos.
- La experiencia es comprensible para personal de 40 a 50 años o más.
- La interfaz conserva controles táctiles amplios y contraste adecuado.
- La información sensible se muestra solamente a quien la necesita.
