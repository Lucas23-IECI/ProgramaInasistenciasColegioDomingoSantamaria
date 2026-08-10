# Pruebas, despliegue y recuperación

## Objetivo

Demostrar que los perfiles personales se añaden sin pérdida de datos, regresiones de acceso o degradación operacional.

## Matriz de regresión de datos

Antes y después de la migración se compararán:

- Usuarios activos, inactivos y eliminados lógicamente.
- Correos, IDs, hashes de contraseña, roles y cargos.
- Permisos efectivos y personalizados.
- Estudiantes y matrículas.
- Registros de puntualidad.
- Visitas y retiros.
- Apoderados y autorizaciones.
- Justificaciones y documentos.
- Registros de auditoría.

La única diferencia esperada será la existencia de tablas, permisos y perfiles personales nuevos.

## Pruebas de migración

- Instalación nueva ejecuta todas las migraciones hasta la 030.
- Base existente en migración 029 avanza a 030.
- Ejecutar nuevamente no duplica perfiles ni permisos.
- Una cuenta eliminada lógicamente conserva auditoría.
- Una cuenta activa obtiene fallback aunque no tenga fila personal.
- Una falla forzada revierte la transacción.
- El backend no anuncia salud si el esquema queda incompleto.

## Pruebas de autenticación

- Administrador, Inspectoría, Secretaría y Portería existentes inician sesión.
- El cambio obligatorio conserva el mismo flujo.
- Una cuenta desactivada sigue bloqueada.
- Los intentos fallidos mantienen el bloqueo temporal.
- Cerrar sesión elimina la sesión local.
- Actualizar presentación no cambia token ni permisos.
- Un cambio administrativo de seguridad invalida sesiones cuando corresponda.

## Pruebas de autorización

- Una persona edita únicamente sus campos permitidos.
- No puede cambiar cargo, correo, rol o permisos.
- No puede modificar a otra persona sin permiso.
- El directorio respeta su permiso.
- Los contactos restringidos no aparecen en la API.
- Administración puede retirar una imagen.
- Las denegaciones responden 403 sin filtrar información.

## Pruebas de imágenes

- Imagen válida.
- Extensión válida con contenido falso.
- Archivo vacío, truncado o sobredimensionado.
- Dimensiones excesivas.
- Orientación EXIF.
- Metadatos sensibles.
- Reemplazo y eliminación de avatar.
- Reemplazo y eliminación de portada.
- Interrupción durante escritura.
- Limpieza de temporales.
- Acceso no autenticado.
- Acceso autenticado a miniaturas.

## Pruebas funcionales

- Abrir Mi perfil desde el avatar.
- Editar presentación y guardar.
- Cambiar estado con vencimiento.
- Buscar por nombre y cargo.
- Buscar ignorando tildes y mayúsculas.
- Abrir una ficha desde el directorio.
- Distinguir cuenta personal de institucional.
- Mostrar correctamente campos vacíos.
- Volver a la imagen predeterminada.

## UI y accesibilidad

Viewports mínimos:

- 360 por 800.
- 390 por 844.
- 768 por 1024.
- 1366 por 768.
- 1920 por 1080.

Comprobaciones:

- Sin desplazamiento horizontal involuntario.
- Controles táctiles de al menos 44 píxeles.
- Contraste WCAG AA.
- Navegación completa por teclado.
- Foco visible.
- Etiquetas accesibles.
- Zoom hasta 200 por ciento.
- Tema claro y oscuro.
- Errores asociados al campo correcto.
- Diálogos contenidos dentro del viewport.

## Rendimiento

- El directorio utiliza miniaturas.
- Las imágenes se cargan de forma diferida.
- El avatar predeterminado no genera solicitudes repetidas.
- La carga de imágenes tiene límites de memoria medidos.
- El bundle no incorpora dependencias excesivas sin justificación.
- El presupuesto frontend se compara antes y después.

## Respaldo y restauración

El ensayo aislado deberá crear una base temporal, restaurar dump y archivos, ejecutar migraciones, comparar conteos, verificar perfiles e imágenes, iniciar un backend temporal, consultar salud y eliminar únicamente el entorno temporal verificado.

## Despliegue escolar

### Antes

- Cerrar la prueba local.
- Confirmar que la rama integrada contiene solo cambios aprobados.
- Generar respaldo inmediato de base y archivos.
- Verificar hashes.
- Registrar commit anterior y objetivo.
- Confirmar espacio disponible.

### Durante

- Actualizar código sin eliminar volúmenes.
- Reconstruir servicios.
- Esperar migraciones y health checks.
- Verificar versión y migración aplicada.
- No ejecutar comandos que eliminen volúmenes.

### Después

- Probar cuentas reales autorizadas.
- Comprobar estudiantes, atrasos, visitas y retiros.
- Abrir perfiles sin fotografía.
- Cargar una fotografía de prueba autorizada.
- Reiniciar el servidor en una ventana controlada.
- Confirmar acceso desde otro computador y celular.
- Ejecutar un nuevo respaldo.

## Recuperación

Si solamente falla la interfaz nueva, se podrá volver al commit anterior manteniendo las tablas aditivas. Si la migración no completa, el backend no debe forzar el arranque; se conservarán logs y se diagnosticará sobre una restauración temporal.

Nunca se utilizará `docker compose down -v` como procedimiento de actualización o recuperación.

## Evidencia final requerida

- Resultado de migraciones.
- Conteos comparativos.
- Suite backend y frontend.
- E2E escritorio y móvil.
- Auditoría de dependencias aplicable.
- Presupuesto de rendimiento.
- Capturas responsive.
- Restauración temporal.
- Matriz de aceptación escolar.

## Evidencia local ejecutada el 8 de agosto de 2026

- Rama de trabajo: `Testing`; sin commit, push ni despliegue escolar.
- Migración 030 aplicada sobre la base local poblada: misma cantidad de cuentas activas y mismos hashes de contraseña antes y después; un perfil aditivo por cuenta.
- Backend: 109 pruebas aprobadas y comprobación sintáctica de núcleo, rutas y scripts aprobada.
- Frontend: 22 pruebas aprobadas, lint y build de producción aprobados.
- E2E: 17 escenarios aprobados y uno omitido intencionalmente en la matriz de escritorio y Android. Incluye acceso, padrón, changelog, terminal, visitas, perfiles, directorio, Portería y desborde móvil.
- Accesibilidad: Axe sin violaciones críticas o serias en perfiles y directorio; el contraste secundario fue corregido hasta cumplir WCAG AA.
- Dependencias: auditorías de backend y frontend con cero vulnerabilidades reportadas.
- Imágenes: contenido real validado, conversión a WEBP, rotación, eliminación de metadatos y generación de variantes comprobadas.
- Respaldo: respaldo inmediato válido con manifiesto de integridad.
- Restauración: entorno Docker aislado restaurado, 30 migraciones registradas, conteos coincidentes, backend temporal saludable y recursos temporales eliminados.
- Navegador: escritorio y móvil revisados sin errores de consola ni desborde horizontal en las rutas nuevas.

La única evidencia pendiente es la aceptación física en la red y dispositivos reales del colegio. Esta evidencia no debe confundirse con un despliegue: la rama continúa exclusivamente local.
