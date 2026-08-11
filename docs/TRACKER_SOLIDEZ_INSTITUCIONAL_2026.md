# Tracker de solidez institucional 2026

> Iniciativa implementada y validada localmente en la rama `Testing`: [perfiles personales del equipo institucional](perfiles-personales/README.md). La migración es aditiva y la evidencia local confirmó que no modifica cuentas, contraseñas ni datos operativos existentes. La aceptación física en el colegio continúa pendiente y no se ha desplegado esta rama.

## Objetivo

Dejar el sistema de puntualidad, visitas y retiros preparado para una operación escolar
defendible: los datos históricos no cambian de significado, los errores de carga se
detienen antes de afectar el padrón, la jornada operativa puede cerrarse y la
recuperación desde respaldos se demuestra en un entorno aislado.

Este tracker es también el contrato de aceptación de la implementación. La suite E2E permanente fue incorporada posteriormente por instrucción del propietario. No incluye:

- Integración a `main` ni publicación productiva sin una orden expresa.
- Cálculo de asistencia, ausencias inferidas o cierre de asistencia.

## Principios que no se pueden romper

1. El producto continúa siendo un sistema de atrasos, no de asistencia.
2. Un cambio de curso no puede reescribir el curso de registros anteriores.
3. Un cambio de horario no puede recalcular atrasos históricos.
4. Importar una planilla no puede crear un curso por un error tipográfico sin una
   confirmación explícita.
5. Portería puede resolver su operación desde un solo computador.
6. Toda corrección, autorización, cierre y cambio sensible conserva responsable,
   fecha y motivo.
7. Ningún ensayo de recuperación modifica la base principal.
8. Los cambios de esquema son aditivos o conservan un camino de recuperación mediante
   el respaldo previo.

## Respaldo de recuperación previo

- Estado: COMPLETADO.
- Fecha: 28 de julio de 2026, 18:03 America/Santiago.
- Base: `ldsm_db_20260728_180336.dump`.
- Documentos: `ldsm_documentos_20260728_180336.tar.gz`.
- Integridad: manifiesto SHA-256 verificado.

## Fase A — Verdad histórica

Estado: COMPLETADO Y VERIFICADO.

Entregables:

- Matrícula con inicio y fin de vigencia; solo una matrícula vigente por estudiante.
- Registro de ingreso con instantánea del curso, jornada, hora de entrada, hora límite,
  minutos calculados y versión de la regla.
- Correcciones que utilizan la regla histórica del registro.
- Reportes y estadísticas que priorizan la instantánea histórica.
- Migración idempotente y retrocompatibilidad para registros anteriores.

Criterios de aceptación:

- Cambiar un estudiante de curso no altera el curso mostrado en un ingreso anterior.
- Cambiar la hora límite no altera los minutos de un ingreso anterior.
- Un estudiante no puede tener dos matrículas vigentes.
- Los registros antiguos sin instantánea se identifican como migrados y no fallan.

## Fase B — Importación escolar controlada

Estado: COMPLETADO Y VERIFICADO.

Entregables:

- Previsualización del archivo antes de modificar la base.
- Estados por fila: válida, curso reconocido, equivalencia sugerida, curso desconocido,
  duplicada o rechazada.
- Mapeo explícito de nombres equivalentes.
- Confirmación separada para crear cada curso nuevo.
- Resumen final de creados, actualizados, omitidos y rechazados.
- Origen de alta persistente: manual, ERP o registro anterior.
- Vinculación de una alta manual con su ficha ERP sin cambiar el identificador interno.
- Previsualización de coincidencias existentes y bloqueo de conflictos de identidad.
- Validación real del dígito verificador antes de crear o actualizar estudiantes.

Criterios de aceptación:

- Un curso desconocido bloquea la sincronización hasta ser mapeado o aprobado.
- Un error como `1 Basico` puede sugerir `1° Básico`, pero nunca se aplica solo.
- Una fila inválida informa número de fila y causa.
- La carga conserva el historial de matrícula.
- Una coincidencia por RUT conserva atrasos, familia y matrícula del mismo estudiante.
- Una alta manual vinculada se identifica como validada por ERP y no pierde su origen.
- Un RUT inválido o una identidad materialmente incompatible no modifica el padrón.

## Fase C — Bandeja y cierre operacional

Estado: COMPLETADO Y VERIFICADO.

Entregables:

- Pantalla única de tareas por resolver.
- Visitas abiertas, retiros solicitados, retiros autorizados no entregados,
  estudiantes sin matrícula, registros operativos fallidos, justificaciones pendientes,
  usuarios bloqueados y estado de respaldo/servidor.
- Navegación desde cada contador al conjunto exacto de registros.
- Cierre diario exclusivo de visitas y retiros.
- Resumen inmutable del cierre con responsable y observaciones.

Criterios de aceptación:

- El cierre se bloquea mientras existan visitas abiertas o retiros sin resolver.
- Al resolver los pendientes, el cierre genera un resumen auditable.
- Volver a cerrar el mismo día no crea duplicados.
- El lector continúa viendo únicamente registro de estudiantes y visitas/retiros.

## Fase D — Ficha familiar y configuración

Estado: COMPLETADO Y VERIFICADO.

Entregables:

- Ficha de responsable con todos sus estudiantes vinculados.
- Apoderado principal, suplente o autorizado; relación individual, teléfonos,
  vigencia, restricciones y observaciones.
- Historial de cambios de cada vínculo.
- Creación y edición manual además de importación.
- Administración de motivos de visita, destinos, motivos de retiro, parentescos y
  reglas operativas.
- Desactivación segura en lugar de eliminar catálogos ya utilizados.

Criterios de aceptación:

- Un responsable puede estar vinculado a hermanos distintos con relaciones diferentes.
- Una autorización vencida no se ofrece como vigente.
- Los catálogos usados históricamente no pueden borrarse físicamente.
- Toda modificación aparece en auditoría.

## Fase E — Mantenibilidad

Estado: COMPLETADO PARA LOS DOMINIOS NUEVOS; DEUDA HEREDADA DOCUMENTADA.

Entregables:

- Nuevas responsabilidades fuera de `server.js` y `routes/visits.js`.
- Formularios operativos extraídos de `Students.jsx` y `VisitsAdmin.jsx`.
- Servicios, validaciones y consultas reutilizables con pruebas unitarias.
- Límite documentado para evitar que nuevas funciones vuelvan a concentrarse.

Criterios de aceptación:

- Los nuevos dominios poseen rutas, servicios y componentes propios.
- Backend, frontend y cuestionarios conservan lint, build y pruebas verdes.
- No se introducen dependencias visuales pesadas para resolver controles simples.

## Fase F — Recuperación y endurecimiento

Estado: COMPLETADO EN LOCAL; ACEPTACIÓN FÍSICA DEL COLEGIO PENDIENTE.

Entregables en código:

- Ensayo de restauración en base, red y volúmenes temporales.
- Comparación de cantidades y migraciones.
- Arranque y health check del backend restaurado.
- Limpieza garantizada del entorno temporal.
- Validación estricta de configuración para modo producción.
- Plantilla de secretos de producción sin valores reales.
- Diagnóstico de certificado, IP, DNS, cifrado de disco, reinicio, respaldos y
  política de retención.
- Política de retención en modo previsualización; nunca borra datos automáticamente.

Aceptación local:

- El ensayo restaura el respaldo vigente y termina sin tocar `ldsm_db`.
- Una configuración de producción débil se rechaza al iniciar.
- El diagnóstico entrega resultado PASS/FAIL y una corrección concreta.

Aceptación física pendiente en el colegio:

- Confiar la autoridad certificadora en cada equipo cliente.
- Reservar IP o DNS interno en el router institucional.
- Activar cifrado de disco y custodiar la clave de recuperación.
- Ensayar reinicio real de Windows y arranque automático.
- Aprobar formalmente plazos de retención antes de habilitar eliminación.

## Matriz de verificación final

| Área | Verificación |
| --- | --- |
| Esquema | migraciones idempotentes y restricciones |
| Historial | pruebas de cambio de curso y regla |
| Excel | archivos válidos, desconocidos, duplicados y con errores |
| Operación | pendientes, cierre bloqueado y cierre exitoso |
| Familia | hermanos, vigencia, restricciones e historial |
| Catálogos | crear, editar, desactivar y proteger referenciados |
| Recuperación | restaurar, comparar, iniciar, comprobar y destruir temporal |
| Seguridad | configuración estricta, permisos backend y auditoría |
| UI | 320, 375, 414, tableta y escritorio; teclado y foco |
| Regresión | tests, lint, builds, auditoría de dependencias y Docker healthy |

## Registro de decisiones

- 2026-07-28: se excluyen los puntos 8 y 11 por instrucción del propietario.
- 2026-07-28: los siete visitantes abiertos y los dos retiros pendientes se conservan;
  se convierten en evidencia operativa de la bandeja y no se eliminan.
- 2026-07-28: las contraseñas locales de prueba no se rotan durante esta implementación.
  Producción utiliza una plantilla y controles separados.
- 2026-07-28: las acciones físicas del colegio se preparan y documentan, pero no se
  declaran aprobadas desde el entorno doméstico.

## Cierre de implementación y auditoría local

Fecha: 28 de julio de 2026.

Resultado: APROBADO PARA PRUEBAS LOCALES CONTROLADAS. NO APROBADO TODAVÍA COMO
INSTALACIÓN DE PRODUCCIÓN EN EL COLEGIO.

Evidencia ejecutada:

- 16 migraciones aplicadas; 391 estudiantes activos y 381 matrículas vigentes.
- Cero matrículas vigentes duplicadas, vigencias inválidas, estados operativos
  desconocidos, eventos huérfanos o auditorías sin acción.
- Backend: 61 de 61 pruebas aprobadas y comprobación sintáctica aprobada.
- Cuestionarios: 7 de 7 pruebas aprobadas.
- Frontend: lint y construcción de producción aprobados.
- Dependencias: cero vulnerabilidades aplicables en backend y cuestionarios; la
  excepción del frontend corresponde a RSC inestable y la aplicación es una SPA sin RSC.
- Docker: PostgreSQL, backend, frontend y respaldo saludables.
- Restauración: base y documentos restaurados en un entorno temporal, cantidades
  comparadas, backend temporal saludable y entorno temporal eliminado.
- Exportaciones verificadas en XLSX, PDF y Markdown.
- Permisos verificados: Portería accede a visitas y recibe 403 al consultar usuarios.
- Configuración de catálogos aplicada también en backend: detalle, contacto, motivo y
  validación excepcional son obligatorios cuando la regla institucional lo exige.
- Interfaz móvil verificada a 390 x 844 sin desborde horizontal, con campos etiquetados,
  botones con nombre accesible, modo oscuro, ayuda contextual y regreso desde el terminal.
- RUT y teléfono se formatean progresivamente; las operaciones no se habilitan hasta
  completar los datos requeridos.
- HTTPS local responde correctamente y entrega CSP, HSTS, protección de marcos,
  `nosniff`, política de referencia y política de permisos.
- El respaldo vigente se puede leer desde el backend sin exponer los archivos privados.
- No existen claves privadas, archivos operacionales, referencias al pegado accidental
  `accontadores` ni certificados secretos rastreados por Git.
- Las altas manuales muestran su origen, la previsualización anuncia su vinculación con
  ERP y las coincidencias incompatibles se bloquean antes de sincronizar.
- La carga ERP distingue actualización parcial y nómina oficial completa; ninguna omisión
  retira matrículas sin confirmación expresa.
- Cada importación conserva nombre, hash, persona responsable, resumen y cambios por fila.
- La comparación campo por campo separa valores conservados, actualizados y conflictos que
  requieren decisión institucional.
- Una colisión entre UUID del ERP y RUT detiene completamente la fila.
- Las fichas inactivas que reaparecen requieren confirmación expresa antes de reactivarse.
- La bandeja operativa y el control del padrón muestran las altas manuales pendientes.
- El panel de calidad informa RUT inválidos, falta de curso o apoderado, teléfonos incompletos,
  matrículas duplicadas, conflictos ERP y reactivaciones.
- La unión de duplicados previsualiza dependencias, bloquea incompatibilidades, transfiere
  relaciones y conserva la ficha descartada como registro inactivo auditado.

Controles de producción todavía pendientes:

- cambiar `NODE_ENV` a `production`;
- activar validación estricta y cookie segura;
- reemplazar la contraseña local de PostgreSQL por una robusta;
- declarar únicamente los orígenes HTTPS definitivos;
- reservar IP o DNS, confiar la CA en cada cliente, cifrar el disco y ensayar un reinicio
  físico del PC servidor.

Deuda técnica residual:

- `server.js`, `routes/visits.js`, `Students.jsx` y `VisitsAdmin.jsx` siguen siendo
  archivos heredados grandes. Los dominios nuevos ya se separaron en rutas, servicios,
  utilidades y componentes propios, pero conviene continuar la extracción antes de una
  nueva expansión funcional.
- La suite E2E permanente cubre acceso, administración, alta manual/MRZ, Portería,
  terminal, navegación y desborde móvil. Se ejecuta localmente y en GitHub Actions.

## Ampliación técnica del 1 de agosto de 2026

- Lectura local TD3/MRZ con permiso crítico y auditoría sin imágenes ni texto del documento.
- 103 pruebas backend y 17 pruebas frontend aprobadas.
- 15 ejecuciones E2E aprobadas en escritorio y Android emulado; una ejecución se omite
  deliberadamente en escritorio por ser una comprobación exclusiva del viewport móvil.
- Presupuesto aprobado: script mayor 482 KiB, JavaScript total 1.734 KiB y CSS total 294 KiB.
- Auditoría de dependencias sin alertas altas o críticas aplicables.
- Restauración aislada aprobada con 391 alumnos, 381 matrículas, 43 visitas, 8 retiros,
  9 usuarios y 29 migraciones; el backend temporal respondió y el entorno fue eliminado.
- Guía de pruebas locales, procedimiento MRZ y comando único de validación incorporados.
- Previsualización del ERP oficial aprobada con 392 filas preparadas, cero rechazadas y
  11 casos sin curso enviados a revisión, sin confirmar una importación destructiva.
- Changelog verificado en escritorio, móvil y equivalentes de zoom 125 %, 150 % y 200 %;
  la prueba comprueba que ningún control global intercepte el botón de cierre.

## Cierre local de perfiles y directorio del 8 de agosto de 2026

- Alineación del menú de usuario corregida mediante selectores estrictamente acotados;
  el avatar ya no hereda estilos destinados al texto de identidad.
- El perfil propio distingue cambios pendientes de información ya guardada, avisa antes
  de abandonar el navegador y permite volver a seleccionar una imagen tras un intento.
- La persistencia fue comprobada desde la interfaz: guardar, recargar, verificar y
  restaurar el valor original sin dejar datos de prueba en la ficha.
- El directorio interno incorpora búsqueda tolerante a mayúsculas y tildes, filtros por
  área, cargo, disponibilidad y tipo de cuenta, orden configurable, limpieza de filtros
  y cancelación de solicitudes obsoletas.
- Los filtros se adaptan a escritorio y móvil; en pantallas pequeñas permanecen
  contraídos hasta que la persona decide abrirlos.
- La regresión final aprobó 111 pruebas backend, 23 pruebas frontend y 18 ejecuciones
  E2E en escritorio y Android. Dos casos se omiten deliberadamente por corresponder a
  una única plataforma o viewport.
- Docker confirmó saludables PostgreSQL, backend, frontend y el servicio de respaldos.
- Durante la auditoría se corrigió además el contraste del botón deshabilitado del
  inicio de sesión; la verificación de accesibilidad volvió a aprobar en ambos viewports.
- Configuración de visitas reorganizada y validada sin desborde horizontal ni barreras
  críticas de accesibilidad en escritorio y Android emulado.
- La recuperación de módulos versionados obsoletos evita que una actualización deje una
  sección en blanco y limita la recarga automática a un único intento seguro.
- La aceptación física quedó separada en `docs/ACEPTACION_COLEGIO_ANDRES.md` con matriz,
  responsables y criterio de cierre institucional.
- La guía distingue instalaciones nuevas de bases persistentes: una contraseña de
  PostgreSQL existente nunca se rota editando solamente `.env`.

## Editor visual de avatar y portada del 8 de agosto de 2026

Estado: IMPLEMENTADO Y VALIDADO LOCALMENTE EN `Testing`.

- Los botones existentes de cámara y portada abren un editor previo al guardado sin
  alterar la estructura visual del perfil.
- Avatar y portada permiten arrastrar, ampliar con deslizador, rueda o gesto táctil,
  girar en pasos de 90 grados y restablecer todos los ajustes.
- La previsualización utiliza el mismo recorte que se enviará al servidor: circular
  para el avatar y panorámica 3:1 para la portada.
- El procesamiento conserva la proporción, no estira la imagen, elimina metadatos y
  genera salidas WebP exactas de 640 × 640 y 1800 × 600 píxeles.
- Se aceptan JPEG, PNG y WebP de hasta 5 MiB y 36 megapíxeles. Un error de carga o
  guardado conserva el encuadre para permitir reintentar sin empezar de nuevo.
- Durante el procesamiento se bloquean guardado y cierre, se informa el estado y no
  se producen saltos de layout.
- La interfaz fue comprobada visualmente en escritorio y 390 × 844, sin desborde
  horizontal; los controles táctiles mantienen objetivos cómodos y nombres accesibles.
- La persistencia real quedó comprobada mediante guardado, recarga y lectura de la
  miniatura procesada desde el backend.
- Las imágenes nuevas conservan además una fuente WebP normalizada y sin metadatos.
  Esto permite volver a abrir una foto o portada ya guardada, reposicionarla y generar
  otro recorte sin depender del archivo original del dispositivo. Los medios anteriores
  a esta migración se pueden editar usando el recorte disponible y adquieren su fuente
  normalizada en el siguiente guardado.
- La regresión automatizada cubre zoom, giro, restablecimiento, cancelación, error
  controlado, accesibilidad WCAG y ambas proporciones de salida.
- No se realizó commit, push ni despliegue; la aceptación táctil en un teléfono físico
  continúa siendo un control de instalación, no una deuda de implementación.

## Administración de perfiles reutilizables del 9 de agosto de 2026

Estado: IMPLEMENTADO Y VALIDADO LOCALMENTE EN `Testing`.

- Todos los perfiles excepto Administrador se pueden editar, desactivar, reactivar y
  eliminar cuando no conservan cuentas asociadas. Desactivar un perfil impide nuevas
  asignaciones, pero mantiene sus cuentas e historial intactos.
- Administrador es un perfil protegido en interfaz y API: no puede desactivarse,
  eliminarse ni perder permisos mediante una petición manual. Solo admite cambios
  seguros de nombre o descripción.
- La eliminación comprueba y bloquea perfiles con cuentas antes de modificar datos;
  nunca elimina cuentas como efecto secundario y se ejecuta dentro de una transacción.
- Cada perfil ofrece una actividad consolidada de todas sus cuentas, con filtros por
  persona, acción y período, orden descendente, paginación y exportación Excel que
  respeta exactamente los filtros aplicados.
- Las tarjetas y la ficha de cada perfil muestran estado, cuentas activas, cuentas
  totales y funciones recomendadas calculadas desde la base, sin cifras fijas.
- Crear o cambiar una cuenta hacia un perfil desactivado queda rechazado. Una cuenta
  que ya pertenece a ese perfil puede conservarlo sin ser desactivada automáticamente.
- Creación, edición, cambio de funciones, desactivación, reactivación y eliminación
  quedan registradas en la auditoría con instantáneas del código y nombre del perfil,
  por lo que los eventos sobreviven a cambios posteriores.
- Los modales destructivos explican consecuencias; eliminar exige escribir el nombre
  exacto del perfil y no se habilita mientras existan cuentas vinculadas.
- La interfaz fue comprobada visualmente en escritorio y 390 × 844 sin desborde
  horizontal. Acciones, filtros, resumen y tabla conservan la línea visual vigente.
- La regresión final aprobó 114 pruebas backend, 27 pruebas frontend y 20 ejecuciones
  E2E en escritorio y Android emulado. Dos casos se omiten deliberadamente porque solo
  corresponden a una plataforma o viewport. El ciclo completo de un perfil temporal,
  las protecciones de Administrador y el bloqueo de eliminación ocupada quedaron cubiertos.
- Las migraciones `031` y `032` son aditivas: agregan instantáneas de auditoría y la
  fuente normalizada de imágenes; no eliminan ni reemplazan información operacional.
- No se realizó commit, push ni despliegue.

## Analítica institucional y PWA del 9 de agosto de 2026

Estado: IMPLEMENTADO Y VALIDADO LOCALMENTE EN `Testing`.

- La migración `035` agrega idempotencia a ingresos diferidos, programaciones,
  ejecuciones y tres permisos de analítica. Es aditiva y no elimina ni recalcula datos.
- El panel institucional compara tendencias, cursos y bloques; identifica mejoras,
  reincidencia posterior a intervenciones, retiros, visitas, convivencia y carga de
  trabajo. Las alertas muestran el dato, umbral y regla exacta, sin puntajes opacos.
- La relación entre contacto con apoderados y cierre se rotula como correlación
  descriptiva y no como prueba de causalidad.
- PDF y Excel respetan el período solicitado. Las programaciones semanales y mensuales
  conservan una instantánea de cada ejecución y usan bloqueo de PostgreSQL para evitar
  duplicaciones entre instancias del backend.
- Los usuarios autorizados administran las programaciones desde el panel: pueden
  crear reportes, consultar su estado y pausarlos o reactivarlos con auditoría.
- La PWA incluye manifiesto, iconos institucionales, modo independiente y caché
  versionada del shell. Ninguna respuesta de la API se almacena en caché.
- Solo el terminal de puntualidad puede encolar operaciones sin conexión. Visitas,
  retiros, estudiantes, convivencia, documentos y administración continúan exigiendo
  conexión para evitar reconciliaciones ambiguas.
- Cada operación diferida tiene UUID, instante de captura y método. El backend limita
  la ventana a 24 horas, tolera hasta cinco minutos futuros y responde idempotentemente
  ante reenvíos para impedir ingresos duplicados.
- El aviso local de sincronización es opcional: el navegador solicita permiso mediante
  una acción explícita y notifica solo después de recibir confirmación del servidor.
- El padrón operativo local contiene exclusivamente la información mínima de búsqueda.
  Queda aislado por origen en IndexedDB, sin cifrado adicional de aplicación; el puesto
  debe contar con control físico y bloqueo del dispositivo.
- PostgreSQL, backend, frontend y respaldos quedaron saludables en Docker. La consulta
  analítica se ejecutó contra la base real local y el manifiesto y service worker
  respondieron correctamente desde el frontend construido.
- La regresión permanente cubre períodos, migración aditiva, bloqueo del programador,
  administración visible de reportes, idempotencia, manifiesto, exclusión de API del
  caché, cola FIFO, permiso explícito de avisos y restricción del modo diferido al
  terminal de puntualidad.
- La guía técnica y la aceptación física están documentadas en
  `docs/ANALITICA_INSTITUCIONAL_PWA.md`.
- Permanecen como aceptación escolar HTTPS confiable en teléfonos, instalación PWA,
  cámara real y un ensayo físico de corte y recuperación de red en Portería.
- No se realizó commit, push ni despliegue.

## Convivencia Escolar protegida del 9 de agosto de 2026

Estado: IMPLEMENTADO Y VALIDADO LOCALMENTE EN `Testing`.

- Se incorporó un módulo independiente para situaciones, personas involucradas,
  medidas, entrevistas, mediaciones, acuerdos, seguimientos, derivaciones, documentos,
  fechas de revisión y cierre del caso.
- La migración `033` es aditiva y crea cinco tablas reservadas. No altera datos ni
  columnas de atrasos, estudiantes, matrículas, visitas o retiros.
- Se agregaron cinco permisos críticos. Solamente Administrador y el nuevo perfil
  `Convivencia Escolar` los reciben inicialmente; Inspectoría, Dirección, Secretaría y
  Portería no obtienen acceso implícito.
- Todos los controles se validan en backend. La interfaz replica esos permisos para
  mostrar únicamente acciones autorizadas.
- La bandeja resume casos activos, seguimientos, revisiones vencidas y cierres del mes;
  sus indicadores son interactivos y los listados admiten búsqueda, estado, prioridad
  y paginación.
- Cada caso conserva relato inicial, responsable, participantes, línea de tiempo,
  resultados, próxima revisión y documentos protegidos. El cierre bloquea cambios y la
  reapertura exige un nuevo motivo.
- Los respaldos se almacenan fuera de rutas públicas, se validan por firma y tamaño y
  requieren permiso tanto para subir como para descargar.
- La auditoría registra operaciones y metadatos, pero no duplica narrativas sensibles.
  No existe borrado de casos o actuaciones en la API.
- Se añadió ayuda contextual para bandeja y ficha, navegación responsive y modales con
  cierre por teclado, restauración de foco y bloqueo del desplazamiento de fondo.
- La regresión aprobó 121 pruebas backend, 27 pruebas frontend, lint, chequeo de rutas
  y build de producción. La integración real de API aprobó acceso 401/403, alta,
  participantes, actuación, archivo, descarga, cierre, bloqueo y reapertura.
- La prueba de integración limpió exclusivamente su caso, auditoría y archivo temporal;
  la base quedó con cero casos de prueba `PRUEBA CODEX`.
- PostgreSQL, backend, frontend y respaldos quedaron saludables en Docker.
- La inspección mediante navegador integrado quedó impedida por la política de acceso a
  direcciones locales de esa herramienta. La aceptación visual humana en navegador de
  escritorio y teléfono continúa pendiente y está detallada en
  `docs/CONVIVENCIA_ESCOLAR.md`.
- No se realizó commit, push ni despliegue.

## Gestión documental de estudiantes del 9 de agosto de 2026

Estado: IMPLEMENTADO Y VALIDADO LOCALMENTE EN `Testing`.

- La migración `034` agrega expedientes, documentos, versiones, firmas y plantillas
  mediante tablas nuevas. No elimina ni reemplaza datos operacionales existentes.
- Cada estudiante dispone de un expediente único con categorías institucionales,
  estado, nivel de acceso, vigencia, vencimiento y responsable de incorporación.
- Las nuevas versiones nunca sobrescriben el archivo anterior y conservan nombre,
  origen, notas, tamaño, tipo MIME y huella SHA-256.
- La descarga se realiza mediante una ruta autenticada. No existe borrado físico en
  la API; los documentos se archivan conservando su trazabilidad.
- Se incorporaron seis permisos independientes para consultar, subir, administrar,
  firmar, gestionar plantillas y ejecutar OCR. Solo Administrador y el perfil Gestión
  Documental los reciben inicialmente.
- Las plantillas generan PDF institucional en estado pendiente. Los campos admitidos
  se controlan en backend para evitar sustituciones arbitrarias.
- La firma implementada es una constancia electrónica interna asociada al usuario y a
  la huella exacta de una versión; no se presenta como firma electrónica avanzada.
- El OCR local procesa JPEG y PNG, guarda una propuesta y exige aprobación o rechazo
  humano. No modifica fichas ni afirma la autenticidad del archivo.
- El panel incluye indicadores, filtros, búsqueda de estudiantes, historial de
  versiones, vigencias, plantillas y ayudas contextuales en sus tres niveles.
- La integración real de API aprobó 401 sin sesión, 403 para Lector, carga, consulta,
  OCR, revisión humana, firma, segunda versión, PDF, descarga y limpieza exacta de sus
  datos de prueba.
- La regresión backend aprobó 127 pruebas, incluyendo seis controles documentales;
  las 27 pruebas frontend, lint y build de producción también aprobaron.
- La regresión E2E aprobó 22 recorridos en escritorio y Android emulado; dos casos se
  omitieron por condiciones previstas de plataforma o viewport. El módulo documental
  superó navegación, expediente, responsive, ausencia de desborde y accesibilidad WCAG.
- Un PDF institucional se renderizó a imagen y se inspeccionó visualmente. El diseño,
  los saltos de línea y los caracteres Unicode de español quedaron correctos.
- La guía operativa y las limitaciones están documentadas en
  `docs/GESTION_DOCUMENTAL.md`.
- Permanecen como aceptación escolar la asignación definitiva de permisos, las
  plantillas oficiales, el criterio jurídico de firma y las políticas de retención.
- No se realizó commit, push ni despliegue.

## Seguimiento y chat institucional del 10 de agosto de 2026

Estado: IMPLEMENTACIÓN DE SOFTWARE COMPLETA Y VALIDADA LOCALMENTE EN `testing`.

- Seguimiento cuenta con reglas configurables, ejecución manual y periódica, asignación
  por perfil y carga, escalamiento por plazo y avisos internos auditables.
- Chat actualiza conversaciones y contadores mediante SSE con sondeo de respaldo,
  administra miembros, horarios de silencio, pausas, menciones y preferencias.
- La retención permite configurar, previsualizar y aplicar de forma explícita una
  política global o por conversación. Permanece apagada por defecto.
- Las migraciones son aditivas y conservaron cuentas, estudiantes, atrasos, documentos,
  conversaciones y seguimientos existentes.
- La API real confirmó sesión, diez reglas de seguimiento, diez perfiles responsables,
  automatización desactivada y retención desactivada.
- La regresión aprobó 143 pruebas backend, 47 frontend, lint, build y 32 recorridos
  E2E en escritorio y Android; dos casos se omitieron por condiciones intencionales de
  plataforma. Se corrigió además el contraste WCAG del resumen.
- El límite global de API distingue cuentas autenticadas aunque compartan una red,
  mantiene una cuota independiente para accesos anónimos y deja el inicio de sesión
  bajo su protección específica. La regresión completa dejó de reproducir el 429.
- PostgreSQL, backend, frontend y respaldos quedaron saludables en Docker.
- Pendientes institucionales: aprobar reglas y plazos de retención, definir responsables
  definitivos y realizar la aceptación física en los equipos del establecimiento.
- No se realizó commit, push ni despliegue.

### Cierre de decisiones de Dirección · 10 de agosto de 2026

- [x] Regla preventiva definida en 3 atrasos dentro de 15 días móviles.
- [x] Responsable inicial definido como perfil Inspectoría.
- [x] Plazo institucional definido en 3 días.
- [x] Escalamiento simultáneo definido para Inspectoría y Equipo de Gestión.
- [x] Canales institucionales definidos para Inspectoría, Equipo de Gestión y
  Equipo de Convivencia.
- [x] Conservación de conversaciones definida durante todo el año escolar (365 días).
- [x] Previsualización de solo lectura agregada antes de crear seguimientos manualmente.
- [ ] Activar la ejecución automática únicamente después de validar la previsualización
  con datos reales del establecimiento.
- [ ] Activar eliminación por retención únicamente después de una autorización
  operacional específica; permanece desactivada.
