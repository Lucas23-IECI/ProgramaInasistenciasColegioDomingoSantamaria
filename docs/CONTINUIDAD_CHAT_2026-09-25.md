# Continuidad recuperada del chat — 25 de septiembre de 2026

## Causa comprobada del salto de contexto

La misma conversación `019ffb95-d7b1-76e2-921b-8d4150ade113` tiene dos copias de historial en perfiles locales distintos:

- Codex++: `C:/Users/lucas/.codex`.
- Codex2++: `C:/Users/lucas/Downloads/PuroRouter-Candidate/Codex2++-26.908/state/codex-home`.

Se consultaron ambas bases SQLite en modo de solo lectura y los mensajes de sus archivos de sesión. La primera copia salta del estado del 22 de septiembre a esta solicitud de recuperación. La segunda conserva el trabajo posterior, hasta la continuación del 25 de septiembre a las 17:25 (hora de Santiago). El lanzador de Codex2++ declara expresamente un historial y perfil separados.

Esto demuestra una divergencia de historiales; no demuestra que una actualización haya borrado mensajes. Los cambios de código recientes siguen presentes en este checkout. No se sobrescribieron ni fusionaron bases de historial, no se restauró Git ni se descartaron archivos.

El registro de Codex2++ confirma dos interrupciones por `usage_limit_exceeded`, a las 17:24:46 y 17:26:20. Esta última corresponde al «continua» recuperado. No es un cierre satisfactorio de la implementación.

## Pedido vigente recuperado

El último pedido funcional, a las 17:09 del 25 de septiembre, fue:

- Editor de mensajes más pequeño y aprovechamiento del ancho disponible.
- Fotos visibles y visor de imágenes.
- Opciones de grupos: foto, nombre, descripción, integrantes, administradores y quién puede escribir.
- Apariencia personal configurable, incluido fondo, conservando adaptación móvil.

El alcance acordado no incluye afirmar que existe «todo WhatsApp»: respuestas citadas, reacciones y encuestas siguen siendo funciones separadas, no implementadas por este bloque.

## Punto de interrupción

El cierre documentado en `CHAT_USO_DIARIO_2026-09-25.md` es anterior a este bloque. Sus 88 pruebas UI y 2 recorridos reales no certifican los cambios posteriores.

Los archivos de la iteración pendiente incluyen `ChatMedia`, `ChatSettingsPanel`, `ChatAppearanceDialog`, `useChatAppearance`, las rutas y servicio `chatPresentation`, y la migración `054_chat_presentacion.sql`.

Evidencia histórica encontrada, no ejecutada de nuevo durante la recuperación:

- Backend focalizado: 17 aprobados.
- Multimedia: 9 aprobados y 1 fallido.
- Grupos: dos fallos registrados. Uno espera un campo de descripción; otro, al igual que multimedia, coincide con una recarga de desarrollo y un contexto nulo en `ChatDock`.
- Apariencia: no había una regresión específica cerrada.
- La aplicación de la migración 054 y las nuevas rutas en un backend real todavía requieren comprobación. No se asumen a partir de pruebas simuladas.

## Continuación segura

1. Reproducir los fallos con una compilación estable, sin editar la app durante los recorridos.
2. Corregir solamente defectos reproducibles y comprobar fotos, grupos y apariencia en escritorio/móvil.
3. Separar resultados de API simulada de persistencia y permisos con servidor real.
4. Actualizar el estado técnico con resultados y límites concretos.

No se modificará `localhost:80`, la instalación del colegio ni los historiales originales como parte de esta recuperación. Sin commits ni publicación.

## Trabajo retomado y evidencia nueva

- Corregida la etiqueta accesible de la descripción del grupo y alineados los límites de nombre/descripción (180/500) con el servidor.
- Ampliada la regresión de activar/desactivar escritura solo de administradores, cambios de rol fallidos, reintento y guardado pendiente.
- Corregida la retención de una conexión SQL mientras se pedía otra para emitir la actualización; se libera después del commit y antes de notificar.
- La reutilización de un chat contextual ya no devuelve los bytes de la foto dentro del objeto de conversación.
- Ayuda actualizada para fotos, ajustes y apariencia personal, preservando las explicaciones de retención y retorno al registro.

Resultados ejecutados en esta recuperación:

| Verificación | Resultado | Evidencia |
| --- | --- | --- |
| Fotos y ajustes de grupos, escritorio/móvil emulado | 32/32 | `output/recovery-chat-final-20260925.log` |
| Backend de presentación del chat | 19/19 | `output/recovery-chat-backend-20260925.log` |
| Unitarias frontend | 149/149 | `output/recovery-chat-unit-verified-20260925.log` |
| ESLint frontend | Aprobado | `output/recovery-chat-lint-20260925.log` |
| Build frontend | Aprobado | `output/recovery-chat-build-20260925.log` |

Las pruebas de navegador usan API simulada y build estable, no acreditan base de datos real ni aplicación de la migración. La suite backend usa dobles de conexión/SQL. Se inspeccionaron capturas de ajustes en móvil y visor en escritorio oscuro. La repetición focalizada inicial de fotos (10/10) está incluida en los 32; no se suma como prueba diferente. Dos rondas unitarias intermedias detectaron textos de ayuda requeridos por el contrato existente; se repusieron y la ronda final pasó completa.

El puerto 4174 se usó temporalmente solo para la prueba estática sin backend y se cerró al terminar; no se presenta como preview funcional listo para iniciar sesión.

## Pendientes del bloque recuperado al 25 de septiembre

1. Resolver la edición de canales institucionales: el sincronizador periódico vuelve a escribir nombre, descripción y roles desde la configuración institucional. La UI no debe confirmar como persistente algo que luego será reemplazado.
2. Completar la prueba específica de apariencia: fondo propio, cancelar/restablecer, errores y aislamiento entre sesiones/cuentas.
3. Verificar la migración 054 y las rutas nuevas en un entorno QA autorizado; probar permisos y persistencia reales antes de declarar el bloque completo. No se ejecutaron migraciones ni se reemplazaron contenedores en esta recuperación.
4. Pasar la regresión conjunta del chat una vez cerrados los puntos anteriores.

El historial recuperado contiene una antigua credencial local de pruebas. No se copia aquí; se recomienda rotarla si sigue vigente y no reutilizarla fuera de QA. Esta recuperación no cambia credenciales.

## Resolución posterior — 27 de septiembre

Los cuatro pendientes anteriores se completaron en la continuación: protección de canales sincronizados, regresión específica de apariencia, migración y rutas en QA real, y regresión conjunta. El preview del puerto 4174 volvió a habilitarse con backend QA real en el puerto 5002. No se reemplazó `localhost:80`.

Resultado final: 136/136 casos UI con API simulada, 19/19 comprobaciones HTTP/PostgreSQL reales, 2/2 recorridos reales de interfaz, 290/290 tests backend y 149/149 frontend; lint y build aprobados. Este resultado posterior sustituye el estado pendiente, no la evidencia histórica descrita arriba. [Informe del bloque, límites y capturas](CHAT_FOTOS_GRUPOS_APARIENCIA_2026-09-27.md).
