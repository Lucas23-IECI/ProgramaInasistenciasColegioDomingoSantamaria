# Chat integrado y flotante — 25 de septiembre de 2026

## Alcance de esta iteración

- Botón **Mensajes** inferior y acceso superior: abren una ventana no modal sin abandonar el módulo actual.
- Lista, búsqueda, conversación, adjuntos, menciones, urgencia, preferencias y permisos reutilizan el chat existente; no hay una segunda base de mensajes.
- Minimizar/cerrar y volver a abrir conserva conversación y borrador. Ampliar lleva al hilo completo; **Usar chat flotante** vuelve a la página de origen, incluidos filtros y fragmento.
- Borrador, menciones y urgencia permanecen solo en memoria de esta pestaña. No se guardan en almacenamiento persistente; se descartan al recargar, cerrar sesión o perder acceso. No se trasladan entre cuentas.
- **Panel principal** ahora tiene texto visible. Lista, tipografía, espaciado, burbujas, adjuntos, encabezados y estados vacíos se compactaron siguiendo la guía `polish-web-ui`, manteniendo los colores y controles institucionales.
- Ayuda contextual actualizada para ambas presentaciones.

## Correcciones funcionales incluidas

- Respuestas tardías no actualizan un hilo desmontado ni borran borradores de una sesión nueva, incluso con el mismo usuario.
- Un archivo pendiente de lectura no se sube con la sesión siguiente. Las solicitudes sucesivas de preferencias tampoco continúan después de cambiar de sesión.
- Los errores 403 de lista o conversación retiran mensajes y borradores; los errores temporales conservan información y permiten reintentar.
- El envío pendiente sigue bloqueado al minimizar/ampliar y no genera un segundo envío.
- Restauración del foco después de habilitar realmente el editor; no antes, cuando el campo aún está deshabilitado.
- Lecturas solo con el hilo abierto y la pestaña visible; nunca se envía un identificador nulo que pudiera marcar como leído un mensaje recién llegado.
- El enlace al registro original también se recupera desde la respuesta de la conversación, sin depender de parámetros en la URL.
- Diálogo de creación portaleado al documento, fondo de viewport completo, foco contenido y cierre por Escape. La ventana flotante no bloquea el resto del módulo.

## Validación

Resultados finales, sin sumar las rondas repetidas como casos nuevos:

| Comprobación | Resultado |
| --- | ---: |
| Chat completo, flotante y ciclo de sesión con API simulada | 82/82 |
| Regresión de sesión con login real y respuestas seleccionadas intervenidas | 8/8 |
| Anuncio existente y acceso al chat (QA real; permisos simulados en un escenario) | 8/8 |
| Creación, envío, archivo, cambio de vista y persistencia reales | 2/2 |
| Unitarias frontend | 149/149 |
| ESLint y build frontend | Aprobados |

La ronda final de navegador y los controles estáticos se registran en:

- `output/chat-integrado-verificado-20260925.log`
- `output/chat-integrado-lint-20260925.log`
- `output/chat-integrado-unit-20260925.log`
- `output/chat-integrado-build-20260925.log`
- `output/chat-session-real-final-20260925.log`
- `output/chat-anuncio-integrado-20260925.log`

Los 82 tests de `chat-compact-ui`, `chat-dock` y `chat-session-lifecycle` interceptan todas las API deliberadamente: comprueban interfaz, estados de error, sesión y accesibilidad; no acreditan persistencia en una base real. Pasaron completos dentro de la ronda unificada de 90. Los ocho de `session-races` son distintos: login real e intervención de respuestas concretas. Su ejecución final separada pasó 8/8. Las capturas se guardan en `frontend/test-results/chat-integrado-verificado-20260925`, `chat-session-real-final-20260925` y `chat-anuncio-integrado-20260925`.

El flujo **real QA pasó 2/2**, escritorio y Pixel 7 emulado: crea grupo ficticio, envía seis mensajes (uno desde el flotante), prueba mención/urgencia, adjunta PDF, descarga y compara bytes, fija un mensaje, cambia entre ambas vistas conservando borrador, recarga y comprueba persistencia en UI/API. Evidencia: `output/chat-dock-real-20260925.log` y `frontend/test-results/chat-dock-real-20260925`.

Se inspeccionaron visualmente capturas de conversación completa, ventana flotante y vista móvil. Los anchos automáticos cubren 320–1920 px y temas claro/oscuro. No equivalen a una prueba en un teléfono físico.

## Incidencias de las rondas previas

- Se detectó una carrera real de foco tras enviar: el intento de enfoque podía ocurrir con el editor todavía deshabilitado. Corregida mediante un efecto posterior al cambio de estado.
- Un selector de la prueba móvil de denegación apuntaba a la lista oculta; se corrigió para comprobar el aviso visible del hilo.
- Una ronda anterior coincidió con recarga de desarrollo al modificar componentes y perdió el diálogo durante la medición de accesibilidad. No se cuenta como una ejecución aprobada.
- La ronda unificada dio 88/90: los dos fallos adicionales eran la comprobación de redirección en una pestaña inactiva. La traza confirmó respuesta autenticada 200 en esa pestaña. La prueba se hizo determinista esperando el login y volviendo al primer tab antes de inspeccionarlo, sin liberar la respuesta antigua 401 hasta confirmar la sesión nueva; luego la suite pasó 8/8. No se cambió la lógica de autenticación para superar esa prueba.
- Se deshabilitaron trazas y vídeo en las suites con login real y se retiraron únicamente los dos ZIP de trazas generados por esos fallos, porque contienen solicitudes de autenticación. Se conservan logs/capturas y la explicación del fallo.
- Las rondas previas se conservan en `chat-integrated-full`, `chat-integrado-final-20260925` y `chat-dock-first`; no se suman repeticiones como escenarios distintos.

## Entorno y límites

Preview: `http://127.0.0.1:4174/admin` y `/chat`, con backend QA en 5002 y base `ldsm_codex_manual_019ffb95`. Los dos nuevos grupos y archivos de prueba permanecen únicamente en QA. No se modificaron cuentas ni registros del sistema habitual/colegio.

No se reemplazaron contenedores ni se desplegó en `localhost:80`. Se mantiene la limitación de la iteración anterior: el backend QA servido aún no entrega `lecturas_otros`, por lo que la interfaz no inventa confirmaciones de lectura. Esta ronda no añade cifrado de extremo a extremo ni acredita entrega entre dos personas/dispositivos reales. Sin commits ni pushes.
