# Chat visible en el anuncio de actualización — 24 de septiembre de 2026

## Cambio solicitado

El chat estaba al final de una lista de trece novedades. Ahora abre el contenido del anuncio con un bloque destacado:

> **Chat interno para tu equipo**
>
> Escribe a tus compañeros y coordina el trabajo sin salir del sistema. No necesitas instalar otra aplicación.
>
> Lo encuentras en el icono de conversación de la esquina superior derecha.

El botón **Abrir chat interno** cierra el anuncio y abre `/chat`. No crea conversaciones ni envía mensajes. Se conserva la posibilidad de cerrar con Escape, la X o Entendido, sin abandonar la sección actual. La ayuda global explica también el icono y cómo volver a Novedades de la versión desde el menú de cuenta.

- Solo las cuentas con `chat.access` ven el destacado, el botón y la sección de chat del anuncio. No se cambian permisos.
- El anuncio se recuerda por versión y cuenta en el navegador; no se repite al navegar o recargar tras descartarlo. Otro navegador o borrar su almacenamiento puede volver a mostrarlo.
- Versión del anuncio y worker: `2026.09.24-chat-visible-v1`. Haber leído la versión anterior no oculta esta novedad.
- El foco de teclado se mantiene dentro del anuncio, con cierre accesible y scroll interno en pantallas pequeñas.
- No cambia el funcionamiento ni los datos de los módulos escolares.

## Comprobaciones de esta modificación

- Construcción Docker: auditoría sin vulnerabilidades altas/críticas, lint y **149/149** pruebas frontend aprobados.
- Regresión focalizada: **16/16** casos, sin omisiones, fallos ni reintentos. Incluye anuncio, apertura real del chat, cierre sin navegación, vuelta atrás, recarga, permisos visibles, claro/oscuro, pantalla de 360 × 640, accesibilidad, changelog y ciclo real de actualización/recuperación de PWA.
- La variante sin permiso simula la respuesta de sesión para comprobar la presentación. No se afirma que este caso pruebe la autorización del backend; esta modificación no cambia el backend.
- Escritorio y móvil emulado (Pixel 7); las capturas se inspeccionaron visualmente. No se afirma haber probado un teléfono físico.
- Se amplió en 3 KiB el presupuesto JavaScript sin comprimir (total y código propio) para el destacado, control de permisos y foco. Los límites de carga inicial, transferencia comprimida, CSS y herramientas diferidas no cambiaron. Resultado: 2186 KiB JS, 644 KiB comprimidos, 495 KiB CSS.

Evidencias generadas, ignoradas por Git:

- [Regresión, informe navegable](../frontend/output/anuncio-chat-20260924/regresion-reporte/index.html).
- [Regresión, resultado JSON](../frontend/output/anuncio-chat-20260924/regresion-results.json).
- [Construcción, lint, pruebas y presupuesto](../frontend/output/anuncio-chat-20260924/build.log).
- [Captura del anuncio en escritorio](../frontend/output/anuncio-chat-20260924/tests/release-chat-announcement--8c490-repite-el-aviso-al-regresar-escritorio/anuncio-chat.png).
- [Captura del anuncio en móvil](../frontend/output/anuncio-chat-20260924/tests/release-chat-announcement--8c490-repite-el-aviso-al-regresar-movil-android/anuncio-chat.png).

## Disponibilidad

Se actualizó únicamente el frontend local de `http://localhost` con la misma imagen validada en QA; backend, base y respaldos no se recrearon. QA utiliza `http://127.0.0.1:8082`. Imagen compartida: `sha256:d8c1354751a1e4b8a7adb2d0886fa525ce2cb0a6a978b4ea55c4af8ed48900d8`.

Comprobación posterior en `localhost`: **2/2** aprobadas, apertura del anuncio → chat real → volver a Documentos → recarga sin repetir el aviso → acceso habitual de la barra superior, en escritorio y móvil emulado. [Resultado local](../frontend/output/anuncio-chat-20260924/local-results.json) e [informe local](../frontend/output/anuncio-chat-20260924/local-reporte/index.html). No se enviaron mensajes ni se modificaron registros escolares.

Sin commits, push, notificaciones a funcionarios ni despliegue al colegio. La ronda general anterior permanece documentada en [el cierre del 23 de septiembre](CIERRE_PENDIENTES_2026-09-23.md); no se presenta como repetida por este cambio.
