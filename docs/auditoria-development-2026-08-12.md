# Auditoría y consolidación de `development`

Fecha de inicio: 12 de agosto de 2026
Rama de trabajo: `development` (local)
Base: `main` en `3c17198`

## Invariantes de seguridad

- Las migraciones nuevas son aditivas, idempotentes y no eliminan datos.
- No se utilizan datos reales en pruebas nuevas.
- Durante la auditoría no se ejecutan `commit`, `push`, `merge`, despliegues ni publicaciones hasta recibir autorización expresa.
- Las reglas institucionales todavía no confirmadas quedan configurables.
- Los registros históricos conservan los valores y reglas aplicados en su fecha.

## Línea base verificada

- PostgreSQL, backend, frontend y respaldo: saludables en Docker.
- Backend al inicio: 148 pruebas aprobadas y comprobación estática aprobada.
- Frontend al inicio: 54 pruebas, lint y build aprobados.
- Migraciones 001 a 039 aplicadas en la base local antes de la ampliación.
- Git no rastrea planillas, respaldos, documentos ofimáticos ni certificados privados.

## Inventario funcional relevante

### Chat institucional

Ya existe un único núcleo con conversaciones directas, grupos, canales, contexto de trabajo, membresía, lectura, menciones, adjuntos, búsqueda, mensajes fijados, preferencias, moderación, retención y actualización por SSE. La consolidación se concentra en contrato real API/base de datos, errores recuperables, PWA y validación visual.

### Visitas y retiros

Ya existen visitantes, motivos, destinos, entradas, salidas, historial, retiros, autorizaciones familiares, reportes, catálogos, auditoría y cierre operativo. La ampliación reutiliza estas tablas y rutas; no crea un módulo paralelo.

### Puntualidad

Ya existen controles versionados para ingreso, recreo, almuerzo, taller u otro; alcance por curso y día; selección automática; excepciones manuales auditadas; instantánea histórica; justificaciones históricas; correcciones, anulaciones y reportes. La ampliación agrega turnos, calendario excepcional, transporte, contingencias y compromisos sobre este núcleo.

## Reglas provisionales configurables

- Permanencia excesiva de una visita: desactivada hasta que el establecimiento defina un umbral; en pruebas se usa 120 minutos.
- Vigencia predeterminada de una preinscripción: 24 horas en desarrollo.
- QR de preinscripción: token aleatorio; se almacena solamente su hash; un solo uso para registrar la entrada.
- Punto de reunión: catálogo configurable, sin asumir rutas ni responsables reales.
- Reconocimiento de mejora: no genera conclusiones automáticas; compara períodos y explica sus datos.

## Criterios de cierre

1. Cada flujo crítico debe probar interfaz, API, base y respuesta visible.
2. Los permisos se validan en backend y frontend.
3. Las transiciones concurrentes usan bloqueo o condición de estado.
4. Chat, Portería y Puntualidad no deben desbordar en móvil.
5. Los errores de red deben conservar la acción del usuario cuando sea seguro.
6. La validación local se diferencia de decisiones institucionales y de producción.

## Problemas confirmados y correcciones

### Portería ampliada

- La generación del QR fallaba en tiempo de ejecución porque `QRCodeWriter.encode` no recibía el mapa de opciones requerido por ZXing. Se corrigió el contrato y se comprobó la credencial visible.
- Las restricciones de acceso solo se comprobaban al ingresar mediante preinscripción. Se agregó la misma protección al registro manual normal para impedir que una persona bloqueada evada la política cambiando de flujo.
- La API de vehículos ya permitía vincular una patente a una visita, pero la interfaz no exponía esa operación. Se agregó el vínculo explícito con visitas activas.
- La cancelación auditada de una visita esperada existía en backend, pero no estaba disponible en la interfaz. Se incorporó la acción con confirmación.
- El formulario de visita normal no permitía declarar una salida esperada, por lo que las alertas de permanencia excesiva quedaban limitadas a preinscripciones. Se agregó el dato opcional y su persistencia.
- Se agregaron entidades externas, proveedores, contratistas, visitantes frecuentes, encomiendas, vehículos, restricciones, preinscripciones con QR de un uso, ocupación de emergencia, puntos de reunión y confirmación de evacuación reutilizando el módulo existente.

### Puntualidad ampliada

- Se preservó el núcleo de controles versionados y se añadieron turnos, alcance por nivel/curso/día, calendario excepcional, actividades especiales, excepciones por estudiante, motivos institucionales, contingencias masivas, compromisos y comparación explicable de períodos.
- Cada registro nuevo puede conservar la instantánea de turno, control, regla, curso, límite y minutos aplicados. Los reportes históricos no dependen exclusivamente de la configuración vigente al consultarlos.
- Las reglas institucionales no confirmadas permanecen configurables; no se fijaron tolerancias sensibles en código.

### Chat y PWA

- Se reutilizó y verificó el único núcleo existente de chat; no se creó una segunda implementación.
- La conversación real abrió en móvil con sus mensajes persistidos y sin errores de consola.
- El service worker y la recuperación de módulos dinámicos permanecen cubiertos por las pruebas existentes. La aceptación física de instalación, cámara y actualización PWA sigue siendo una validación externa.

## Evidencia final local

### Automatización

- Backend: `157/157` pruebas aprobadas.
- Backend: `npm run check` aprobado.
- Frontend: `62/62` pruebas aprobadas.
- Frontend: lint aprobado.
- Frontend: build de producción aprobado.
- Docker: construcción completa aprobada y auditoría sin vulnerabilidades altas ni críticas aplicables.
- E2E Playwright: `35/35` escenarios aplicables aprobados en escritorio y Pixel 7; `3` se omiten deliberadamente por pertenecer solo al proyecto/dispositivo contrario.
- Migraciones 040 y 041: aplicadas dos veces consecutivas sobre una base temporal de solo esquema; repetibilidad aprobada y entorno temporal eliminado.
- Dependencias backend: `npm audit --omit=dev --audit-level=high`, 0 vulnerabilidades.
- Dependencias frontend: auditoría de seguridad aprobada, sin vulnerabilidades altas ni críticas.

### Servicios y datos

- `backend`, `frontend`, `postgres` y `backup`: saludables.
- `GET /api/health`: HTTP 200, servicio listo y base `ready`.
- Cantidades antes y después de las migraciones y pruebas: 8 cuentas vigentes, 392 estudiantes, 2 registros de puntualidad, 43 visitas y 8 retiros; coinciden con la línea base local conocida.
- Visitantes ficticios residuales: 0.
- `git diff --check`: sin errores de espacios ni parches inválidos; solo advertencias normales de conversión LF/CRLF en Windows.

### Prueba visible de extremo a extremo

- Inicio de sesión administrativo real: aprobado.
- Panel principal: 15 módulos visibles y sin errores de consola.
- Portería ampliada: preinscripción creada desde UI, guardada en API/base, QR generado y datos ficticios eliminados al finalizar.
- Portería móvil a 390 px: resumen, visitas esperadas, restricciones, encomiendas, vehículos y emergencia visibles; ancho del documento menor al viewport y consola limpia.
- Puntualidad móvil a 390 px: jornada, controles, políticas y línea de tiempo visibles; sin desbordamiento ni errores de consola.
- Chat móvil a 390 px: conversación persistida, mensajes visibles, sin desbordamiento ni errores de consola.
- Justificación histórica: búsqueda y apertura del atraso específico aprobadas en escritorio y móvil; la fecha original permanece visible y separada de la fecha de justificación.
- RBAC en API: Administrador accede a resumen, restricciones y políticas; Portería accede al resumen y políticas operativas, pero recibe 403 en restricciones y excepciones de estudiante.
- Durante la primera ejecución E2E Docker Desktop se cerró y produjo `ERR_CONNECTION_REFUSED` transversal. No fue una caída de la aplicación: al reiniciar el motor, los servicios recuperaron salud y la suite completa terminó sin fallas.

## Estado de entrega

### Implementado y comprobado localmente

- Migraciones aditivas 040 y 041.
- Backend, permisos, auditoría y transiciones de estado de Portería y Puntualidad.
- Integración frontend → API → PostgreSQL → respuesta visible para el flujo crítico de preinscripción.
- Responsive de las pantallas ampliadas y regresión del chat.
- Protección de restricciones tanto en QR como en registro manual.
- Acción primaria de justificación estabilizada: se eliminó el desplazamiento visual en `hover` que podía impedir un clic fiable con zoom, automatización o punteros de baja precisión.

### Pendiente de validación institucional o física

- Definir umbral real de permanencia excesiva, vigencia habitual de preinscripciones, responsables y puntos de reunión.
- Definir horarios y tolerancias reales por nivel, curso, turno y día.
- Confirmar la política para compromisos y reconocimiento de mejora; el sistema solo muestra comparación explicable.
- Probar pistola, impresora de credenciales, cámara, vibración/sonido y PWA en los dispositivos reales del colegio.
- Ejecutar un simulacro institucional de emergencia; el software local no valida procedimientos físicos.
- Instalar y confiar el certificado HTTPS interno en los equipos y teléfonos autorizados antes de usar cámara en red.
- Realizar aceptación con perfiles reales del establecimiento sin usar datos personales en el repositorio.
- Confirmar retención de documentos de visitantes, preinscripciones, encomiendas, vehículos y eventos de emergencia.

## Riesgos de producción

- Las migraciones son incrementales y no contienen `DROP`, `TRUNCATE` ni borrado masivo, pero deben aplicarse después de un respaldo verificado en el servidor escolar.
- La construcción local y los tests no sustituyen la prueba en la topología, certificados, periféricos y políticas reales del establecimiento.
- Los QR no almacenan el token en texto plano y son de un uso, pero su vigencia final debe quedar alineada con la política de Portería.
- La contraseña local de PostgreSQL detectada en el entorno no cumple todavía la recomendación de 16 caracteres; debe rotarse antes de una instalación definitiva sin registrar el valor en Git.
- Docker Desktop debe configurarse para iniciar con Windows y verificarse tras reinicios; si el motor se cierra, la interfaz deja de responder aunque el código sea correcto.
- El 13 de agosto de 2026 se autorizó expresamente integrar y publicar esta versión en `main`, después de repetir pruebas, comprobación estática, lint y build. El despliegue en el servidor escolar continúa siendo una acción separada a cargo del establecimiento, precedida por un respaldo verificado.
