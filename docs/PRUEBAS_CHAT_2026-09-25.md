# Pruebas del chat interno — 25 de septiembre de 2026

## Cambios revisados

- Vista de conversaciones más compacta, con columna lateral acotada y mensajes limitados a una línea de lectura cómoda.
- Burbujas, adjuntos y compositor adaptados a 320, 375, 414, 768, 1440 y 1920 px; navegación móvil con retorno a la lista.
- Agrupación visual de mensajes consecutivos, fechas visibles, adjuntos compactos y estados de lectura honestos.
- Fijado disponible únicamente para la membresía que puede moderar (propietario o moderador).
- Permisos de creación respetados para conversación directa, grupo y canal.
- El borrador se conserva ante un error de envío; mientras se envía, el compositor bloquea acciones duplicadas.
- Las actualizaciones silenciosas fallidas muestran un aviso explícito y permiten reintentar sin ocultar los mensajes ya visibles.
- Ayuda contextual actualizada con Enter, Mayús + Enter, adjuntos, menciones, fijados, lectura y recuperación.

## Evidencia

| Prueba | Resultado |
|---|---:|
| Frontend unitario | 149/149 |
| Backend unitario focalizado de chat | 17/17 |
| Backend unitario completo, ejecución final local | 270/270 |
| Chat visual determinista escritorio + Android | 38/38 |
| Flujo real QA aislado escritorio + Android | 2/2 |
| Backend QA construido con la consulta de lecturas corregida | 270/270 durante el build |
| Consulta SQL de lecturas, transacción READ ONLY en PostgreSQL QA | 12 mensajes + 3 casos de conteo |

Las 38 pruebas son 19 escenarios en dos proyectos de navegador, con respuestas API simuladas para reproducir fallos, roles y estados extremos. Incluyen la ayuda visible, contraste claro/oscuro, devolución del foco, recuperación de lista/conversación y ocultamiento de mensajes cuando el servidor responde que se perdió el acceso. No se cuentan las rondas de reparación previas como casos nuevos.

El flujo real creó dos grupos ficticios de QA, envió cinco mensajes por Enter (incluido uno urgente con mención), adjuntó el PDF de prueba, descargó el archivo y comparó sus bytes, fijó un mensaje y verificó la persistencia tras recarga mediante UI y API. Las capturas están en [output/chat-real-20260925](../output/chat-real-20260925).

La prueba real usó `http://127.0.0.1:4174` como preview y la base aislada `ldsm_codex_manual_019ffb95`. No modificó el sistema principal, no cambió cuentas y no acredita TLS ni entrega/lectura entre dos sesiones físicas. Los intentos previos en el puerto 5193 se conservaron como evidencia del rechazo CORS, no se contaron como éxitos.

## Nota de lectura

El código del backend agrega `lecturas_otros`, excluyendo la lectura automática del propio remitente. Una marca significa enviado sin lectura externa confirmada; dos marcas significan que existe al menos una lectura de otra cuenta. Si un backend antiguo no entrega el campo, la interfaz vuelve de forma segura a una sola marca.

La consulta nueva se comprobó en PostgreSQL QA sobre los 12 mensajes creados por el flujo real, todos con lectura propia y cero lecturas externas. Otros tres casos SQL autocontenidos confirmaron los resultados 0, 1 y 2, sin insertar lecturas ni cambiar registros. Script: `backend/scripts/verify-chat-read-counts.js`. Evidencia: `output/chat-read-counts-20260925.log`.

**Estado servido:** el preview 4174 usa el frontend nuevo y el backend QA anterior. La imagen de backend nueva está construida, pero no se sustituyó el contenedor: el intento de reemplazo fue bloqueado por la herramienta y no se insistió. Por tanto, el campo `lecturas_otros` está validado en código/SQL, no servido aún por HTTP; en el preview se muestra una sola marca sin inventar lecturas. Tampoco se actualizó el frontend de `localhost:80`.

## Revisión HTTPS de este turno

176/176 comprobaciones de scripts (Certificates 15, Client 44 y Server 29 en PowerShell 5.1 y 7) y 22/22 de integración Docker/TLS aislada. Logs: `output/https/recheck-20260925` y `output/https/integration-20260925-000120-bc7b11bc27ab`. La prueba Windows elevada 46/46 y Edge 6/6 del 24 de septiembre se revisó como evidencia anterior, no se repitió. No se prueba aquí otro PC físico ni se afirma cifrado de extremo a extremo del chat.

## Incidencias y límites conservados

- El preview inicial no tenía `VITE_API_URL=/api`; después, el puerto 5193 fue rechazado por la lista CORS del servidor QA. Se corrigió el arranque del preview y se usó el puerto 4174 ya autorizado, sin relajar CORS.
- La primera ejecución completa local del backend registró un fallo del proceso de tests de notificaciones; ese archivo pasó 8/8 por separado y la ejecución completa repetida pasó 270/270. La causa del primer fallo no quedó determinada; el log completo de la ejecución final está en `output/backend-unit-final-20260925.log`.
- Build frontend aprobado con aviso de tamaño del chunk principal, no un error de compilación. No se cambió el límite para ocultar el aviso.
- La comprobación SQL informa una contraseña de base QA de menos de 16 caracteres; no se modificó ningún secreto. Ese aviso no acredita la configuración de producción.
- Docker se detuvo durante la continuidad del trabajo; tras reabrirlo, se arrancaron los contenedores QA existentes. No se reemplazaron imágenes del sistema habitual ni se ejecutaron commits/pushes.

Logs finales: `output/chat-browser-verified-final-20260925.log`, `output/frontend-unit-chat-verified-20260925.log`, `output/frontend-lint-chat-verified-20260925.log` y `output/frontend-build-chat-verified-20260925.log`. Capturas deterministas: `frontend/test-results/chat-verified-final`; capturas del flujo real: `output/chat-real-20260925/allowed-origin-4174`.
