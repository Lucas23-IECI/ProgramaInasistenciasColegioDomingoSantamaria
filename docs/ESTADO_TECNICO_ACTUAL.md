# Estado técnico local — 1 de octubre de 2026

Este documento separa el estado local de planes y evidencias históricos. No es una autorización de publicación, ni describe un despliegue realizado en el colegio.

## Entrega autorizada: solo testing

El 1 de octubre el usuario autorizó subir el conjunto pendiente a `testing` y después decidió mantener `main` sin cambios. La verificación nueva detectó también avisos de dependencias (dos altas en frontend y una moderada en backend), además del peso pendiente. No se desactivan controles ni se presenta esta entrega como instalable en producción. [Alcance y comprobaciones de la entrega](ENTREGA_TESTING_2026-10-01.md).

La subida a `testing` quedó comprobada. GitHub Actions no inició ninguno de sus cinco trabajos por un bloqueo de cuenta relacionado con facturación; no hay aprobación remota de pruebas. No se tocó la facturación ni se desplegó en el colegio. `main` permanece en `af3a063`.

## Cambio actual — corrección del alta manual

Corregidos los selectores de curso/motivo, los placeholders, la conservación del curso de origen, Escape dentro del desplegable, el reintento de catálogos sin borrar campos y la legibilidad del formulario. Ayuda y novedades actualizadas; versión `2026.10.01-alta-manual-chat-v1`. No cambia registros ni agrega migraciones.

Pruebas nuevas: 155/155 frontend, 290/290 backend, 47 comprobaciones de navegador sobre fuente repetidas sobre el build de producción y 8 comprobaciones adicionales de ayuda/novedades; lint y build aprobados. Las API del navegador son simuladas, sin escrituras a la base. **El presupuesto de tamaño del frontend acumulado falla en cinco métricas y sigue pendiente**; no se declara toda la actualización lista para publicar. [Causas, evidencia y límites](CORRECCION_ALTA_MANUAL_2026-10-01.md).

Los enlaces de preview de las secciones históricas no acreditan un servicio actualmente activo. Esta ronda usa un frontend temporal sin backend real y no reemplaza `localhost:80`.

## Alcance vigente

- Sistema interno de puntualidad: registra ingresos y atrasos; **no infiere asistencia ni ausencias** por falta de escaneo.
- Los perfiles y permisos configurables existentes se conservan. No se sustituyen por cargos fijos.
- Módulos locales: puntualidad, estudiantes y matrícula histórica, familias, visitas/retiros, seguimiento, convivencia, documentos, chat, notificaciones, analítica/reportes, tareas, agenda, recursos, búsqueda global, auditoría y PWA.
- No se están incorporando portal de apoderados, IA, WhatsApp/SMS, aplicación nativa ni multicolegio en este cierre.

## Preparación HTTPS comprobada

Nuevo instalador de HTTPS privado para Windows/Docker y paquete de confianza para otros PC Windows. No compra dominio, no modifica contraseñas ni instala hooks Git. Incluye diagnóstico sin cambios, rollback, persistencia del override y renovación manual conservando la autoridad. El instalador anterior con mkcert está retirado. [Guía](HTTPS_COLEGIO.md) · [Pruebas y límites](PRUEBAS_HTTPS_2026-09-24.md).

Se probaron criptografía y TLS/Docker reales; el inicio/cierre de sesión, cookies y chat se comprobaron también con backend real sobre la base QA. Con autorización expresa se ejecutó Windows elevado: 33/33 comprobaciones nativas y 46/46 del instalador completo en una copia desechable, incluido Edge real (6/6), cliente interactivo, estado, recuperación, reintento y renovación. Se detectó y corrigió un fallo de ruta predeterminada del cliente en PowerShell 5.1, con regresión roja→verde; cliente 44/44 e instalador 29/29 en PS5.1/7. Limpieza completa y contenedores habituales sin reemplazo/reinicio. No hay un despliegue HTTPS en el colegio ni en el localhost habitual; no se ha probado otro PC físico. Los disparadores de interrupción/vencimiento fueron simulados únicamente en metadatos de la copia; recuperación y renovación fueron reales.

## Bloque anterior — fotos, grupos y apariencia del chat (QA del 27 de septiembre)

El pedido del 25 de septiembre a las 17:09 continuó después del cierre de uso diario: editor compacto, ancho completo, fotos, administración de grupos y apariencia personal. Fue interrumpido por límite de uso y su historial estaba en el perfil separado de Codex2++. Se recuperó ese contexto sin restaurar Git ni sobrescribir historiales. [Checkpoint, evidencia nueva y pendientes](CONTINUIDAD_CHAT_2026-09-25.md).

El 27 de septiembre se completaron apariencia personal, fotos y administración de grupos, con protección de los canales institucionales frente a ediciones que su sincronizador reemplazaría. La migración 054 y la persistencia se comprobaron en la base QA aislada. Resultado final: 290 tests backend, 149 frontend, 136 recorridos UI con API simulada, 19 comprobaciones HTTP/PostgreSQL reales y 2 recorridos completos contra servidor real, todos aprobados. ESLint y build finales aprobados. [Funciones, evidencia, fallos corregidos y límites](CHAT_FOTOS_GRUPOS_APARIENCIA_2026-09-27.md).

Preview utilizado en esa ronda: `http://127.0.0.1:4174/chat`, con backend QA en el puerto 5002; no se confirma como activo al 1 de octubre. El sistema habitual de `localhost:80` no se reemplazó. No se incluyen respuestas citadas, reacciones, encuestas, voz ni llamadas; tampoco se afirma una nueva validación TLS o móvil físico por estas pruebas.

## Iteración anterior — chat para uso diario

Nueva distribución tras la revisión visual del usuario: lista más amplia, historial sin márgenes centrales excesivos, texto legible y área de escritura con herramientas separadas. Se corrige la barra de desplazamiento innecesaria del editor, su altura al cambiar el ancho y la posición de las menciones al escribir varias líneas. Se conservan navegación, chat flotante, permisos y borradores. [Cambios, pruebas y límites](CHAT_USO_DIARIO_2026-09-25.md). Preview: `http://127.0.0.1:4174/chat`; sin reemplazo de `localhost:80` ni publicación.

## Iteración anterior del mismo día — chat integrado y flotante

Ventana de mensajes inferior compartida por los módulos y vista completa con retorno explícito al panel. Ambas reutilizan las mismas conversaciones y conservan borrador, menciones y urgencia al minimizar o ampliar; el estado privado permanece solo en memoria y se destruye al cerrar sesión o perder acceso. Se compactaron tipografía/lista/burbujas y se actualizó la ayuda. Se corrigieron carreras de foco, respuestas tardías, lecturas y cambios de sesión durante archivos/preferencias. [Evidencia de esta iteración](CHAT_INTEGRADO_2026-09-25.md).

Servido en el preview `http://127.0.0.1:4174/admin` y `/chat`; el sistema habitual de `localhost:80` no se reemplazó. Sin commits ni pushes en esta iteración.

## Iteración anterior del mismo día — chat interno compacto

La interfaz del chat conserva las conversaciones, permisos, adjuntos, menciones, urgencias, fijados y enlaces contextuales, pero usa un carril de lectura acotado, burbujas compactas, agrupación de mensajes, compositor adaptable y retorno móvil visible. Se corrigió el permiso visual de fijar mensajes, la creación cuando la cuenta solo puede crear grupos o canales, el aviso ante una actualización silenciosa fallida y el conteo de lecturas para no contar al propio remitente. [Pruebas y límites](PRUEBAS_CHAT_2026-09-25.md).

La ronda determinista final de navegador pasó 38/38 casos en escritorio y Android; la ronda real pasó 2/2 contra la base QA aislada, con envío, urgencia, mención, adjunto, descarga byte a byte, fijado y persistencia. El preview real usa el puerto permitido 4174; el intento en 5193 fue rechazado por CORS y quedó documentado. El frontend habitual en puerto 80 sigue sin este rediseño. El nuevo campo backend de lecturas está comprobado en SQL/compilación, pero aún no servido por HTTP: el intento de sustituir el contenedor QA fue bloqueado. El preview usa el fallback seguro de una marca. No se afirma una prueba de lectura entre dos sesiones.

## Cambio anterior — anuncio del chat

El anuncio de actualización destaca el chat con acceso directo y explicación de su ubicación, respetando los permisos existentes. Se verificó con 149 pruebas frontend y 16 casos focalizados de navegador. [Cambio y evidencia del 24 de septiembre](ANUNCIO_CHAT_2026-09-24.md). No se repitió toda la auditoría general por este ajuste de interfaz.

## Cierre técnico local comprobado — 23 de septiembre

1. PWA: pruebas con service worker real, pérdida/recuperación de red, actualización confirmada, conservación de cola IndexedDB y aislamiento de cachés. Se compara el worker servido con el código actual antes de probarlo.
2. Importación: planillas ficticias propias, previsualización/importación/reversión desde la interfaz y comprobación posterior de trazas. Incluye dos alumnos sin usuario ERP y un rechazo parcial por usuario duplicado. No revierte importaciones preexistentes.
3. Automatización: CI incluye `testing`; cobertura compatible con Node 20 que falla si faltan métricas o mínimos; navegador instalado explícitamente. Puerto alternativo solo para CI; el puerto habitual continúa en 80.
4. Regresión: la última ronda unificada y sus omisiones se documentan en el informe de cierre, sin sumar repeticiones como si fueran casos distintos.
5. Documentación: este estado y el informe de cierre prevalecen sobre planes iniciales y anotaciones históricas del tracker.

Resultados finales: backend 270/270; frontend 149/149; navegador 169 aprobados y 3 omisiones expresas, sin fallos ni reintentos; 18/18 comprobaciones adicionales en `localhost`. La instalación local usa las mismas imágenes comprobadas en QA y conserva los conteos principales y los controles de integridad. No quedan fallos abiertos de este bloque dentro del alcance probado. La CI remota no se ejecutó.

## Cómo interpretar la evidencia

Las pruebas unitarias, contratos simulados y escenarios de navegador con servicios reales son evidencias distintas. Se identifican por separado en el [informe de cierre de pendientes](CIERRE_PENDIENTES_2026-09-23.md). Móvil significa navegador emulado, no teléfono físico. Una suite finita no demuestra ausencia absoluta de bugs.

Las mutaciones de la auditoría usan exclusivamente la base y los archivos QA aislados. La instalación local habitual y el colegio no reciben registros ficticios de esta ronda. La CI remota no se declara ejecutada sin un resultado remoto verificable.

## Git

La base del conjunto pendiente es `testing`, commit `c6ac038`. La entrega actual está autorizada exclusivamente para `testing`; `main` debe conservar `af3a063`. Los apartados anteriores describen sus respectivas rondas históricas; el [informe de entrega](ENTREGA_TESTING_2026-10-01.md) registra la decisión vigente.
