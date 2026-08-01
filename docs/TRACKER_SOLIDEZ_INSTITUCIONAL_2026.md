# Tracker de solidez institucional 2026

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
- 103 pruebas backend y 14 pruebas frontend aprobadas.
- 9 escenarios E2E aprobados en escritorio y Android emulado; un escenario se omite
  deliberadamente en escritorio por ser una comprobación exclusiva del viewport móvil.
- Presupuesto aprobado: script mayor 482 KiB, JavaScript total 1.729 KiB y CSS total 284 KiB.
- Auditoría de dependencias sin alertas altas o críticas aplicables.
- Restauración aislada aprobada con 391 alumnos, 381 matrículas, 43 visitas, 8 retiros,
  9 usuarios y 29 migraciones; el backend temporal respondió y el entorno fue eliminado.
- Guía de pruebas locales, procedimiento MRZ y comando único de validación incorporados.
