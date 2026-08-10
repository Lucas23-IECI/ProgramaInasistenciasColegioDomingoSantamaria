# Roadmap posterior a perfiles personales

## Principio de orden

Los perfiles personales son la identidad base. Los siguientes módulos no deben duplicar nombres, cargos, fotos, estados o responsables en estructuras separadas.

## Etapa 2: Seguimiento institucional

Nombre visible recomendado: `Seguimiento institucional`.

Capacidades:

- Casos automáticos y manuales.
- Estudiante y familia relacionados.
- Motivo de apertura.
- Prioridad.
- Responsable y equipo.
- Fecha límite.
- Estado y próxima acción.
- Tareas, notas y documentos.
- Contactos y acuerdos.
- Línea de tiempo.
- Cierre y resultado.

Fuentes automáticas previstas:

- Reincidencia de atrasos.
- Justificaciones pendientes.
- Estudiantes manuales no vinculados.
- Falta de curso o apoderado.
- Posibles duplicados.
- Conflictos de identidad.
- Retiros anticipados reiterados.
- Visitas o retiros sin cierre.
- Derivación explícita de un funcionario.

## Etapa 3: Centro de notificaciones

- Casos asignados.
- Tareas por vencer o vencidas.
- Retiros pendientes.
- Personas esperando en Portería.
- Visitantes todavía dentro.
- Conflictos ERP.
- Mensajes sin leer.
- Respaldos fallidos.
- Servicios fuera de línea.

Primero se implementarán notificaciones dentro de la aplicación. Correo, PWA, WhatsApp o SMS requerirán políticas y configuración independientes.

## Etapa 4: Chat institucional

- Conversaciones directas.
- Grupos por área.
- Canales de Portería, Inspectoría y Dirección.
- Conversaciones asociadas a estudiantes, retiros o casos.
- Menciones y archivos.
- Confirmación de lectura.
- Mensajes fijados y búsqueda.
- Horarios de silencio.
- Retención institucional.

La primera versión utilizará HTTPS, almacenamiento protegido, permisos, auditoría y respaldos cifrados. El cifrado de extremo a extremo no se adoptará sin resolver recuperación institucional, búsqueda, múltiples dispositivos y retención.

## Etapa 5: Agenda y familias

- Agenda de Dirección e Inspectoría.
- Entrevistas con docentes.
- Reserva de horas y cola de atención.
- Recordatorios, acuerdos y resultados.
- Portal separado para apoderados.
- Justificaciones y certificados.
- Personas autorizadas para retirar.
- Actualización controlada de contacto.

## Etapa 6: módulos especializados

### Convivencia escolar

Casos especialmente protegidos, entrevistas, mediaciones, acuerdos, medidas, derivaciones y revisiones.

### Gestión documental

Expediente, vigencias, versiones, plantillas, PDF, firma y OCR con revisión humana.

### Portería ampliada

Preinscripción, QR temporal, proveedores, vehículos, entregas, contratistas, visitantes esperados y emergencia.

### Puntualidad ampliada

Bloques por recreos, almuerzo, jornada, nivel, curso y días excepcionales, conservando siempre reglas históricas.

### Paneles por cargo

Cada panel priorizará tareas e indicadores pertinentes para Dirección, Inspectoría, Portería y Secretaría.

## Etapa 7: plataforma

- PWA instalable.
- Operaciones reconciliables sin conexión.
- Integraciones oficiales.
- Analítica institucional explicable.
- Cifrado de disco y respaldos.
- Doble factor.
- Gestión de sesiones y dispositivos.
- Recuperación ante desastre.
- Soporte para varios establecimientos si el producto se expande.

## Etapa 8: asistencia inteligente controlada

Usos permitidos:

- Resumir casos largos.
- Preparar borradores.
- Detectar posibles duplicados.
- Clasificar documentos.
- Sugerir campos faltantes.
- Preparar minutas.
- Consultar reportes en lenguaje natural.

Usos prohibidos:

- Sancionar automáticamente.
- Diagnosticar estudiantes.
- Decidir medidas disciplinarias.
- Enviar comunicaciones sensibles sin confirmación humana.
- Modificar expedientes sin autorización.

## Secuencia maestra

1. Perfiles personales.
2. Seguimiento institucional.
3. Notificaciones.
4. Chat conectado a casos.
5. Agenda y portal de familias.
6. Módulos especializados.
7. Plataforma e integraciones.
8. Automatización asistida.

Cada etapa tendrá su propio contrato, tracker, migraciones aditivas, pruebas y aceptación antes de comenzar la siguiente.
