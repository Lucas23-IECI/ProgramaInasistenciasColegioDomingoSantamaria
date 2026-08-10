# Plan de implementación y tracker

## Objetivo

Entregar perfiles personales internos listos para servir como identidad base de directorio, asignaciones, notificaciones, seguimiento institucional y chat, sin cambiar la operación actual del colegio.

## Estrategia de trabajo

- Implementar en una rama dedicada.
- Mantener commits pequeños y en español.
- No aplicar migraciones manuales sobre el colegio durante el desarrollo.
- Probar primero con una restauración temporal o base local controlada.
- Separar esquema, backend, interfaz, pruebas y documentación.
- No incorporar chat o casos dentro de esta misma entrega.

## Tracker

| ID | Entregable | Estado | Dependencia | Evidencia de cierre |
| --- | --- | --- | --- | --- |
| PP-001 | Contrato funcional y técnico | Completado | Ninguna | Documentos de este directorio |
| PP-002 | Inventario final de puntos de integración | Completado | PP-001 | Autenticación, usuarios, permisos, auditoría, menú, ayuda y respaldos inventariados |
| PP-010 | Migración aditiva de perfiles | Completado | PP-002 | Migración 030 aplicada sobre base poblada; conteos y hashes conservados |
| PP-011 | Entidad multimedia de perfil | Completado | PP-010 | Tablas, restricciones, variantes e índices incluidos en la migración 030 |
| PP-012 | Permisos y auditoría | Completado | PP-010 | Cuatro permisos granulares, respuestas 401/403 y eventos auditados |
| PP-020 | Servicio de perfil propio | Completado | PP-010 | Servicio separado y pruebas unitarias/API aprobadas |
| PP-021 | Servicio seguro de imágenes | Completado | PP-011 | Límite de 5 MB, validación real, WEBP, rotación, miniaturas y eliminación de EXIF |
| PP-022 | Directorio y consulta individual | Completado | PP-020 | Búsqueda, fichas, visibilidad y permisos validados |
| PP-023 | Administración de perfiles | Completado | PP-012, PP-020 | Área, visibilidad y cuenta compartida separadas del perfil personal y auditadas |
| PP-030 | Avatar y portada predeterminados | Completado | PP-001 | Silueta neutra, escudo para cuentas compartidas y portada local sin red |
| PP-031 | Página Mi perfil | Completado | PP-020, PP-030 | Vista responsive con estados de carga, error y campos vacíos |
| PP-032 | Editor de perfil e imágenes | Completado | PP-021, PP-031 | Carga, recorte seguro en servidor, reemplazo y eliminación |
| PP-033 | Menú global de usuario | Completado | PP-031 | Avatar, nombre, perfil y directorio integrados con permisos |
| PP-034 | Directorio institucional | Completado | PP-022 | Búsqueda por nombre, cargo y área; agrupación y fichas individuales |
| PP-035 | Estados y preferencias | Completado | PP-020, PP-031 | Estados temporales, vencimiento y privacidad de contacto comprobados |
| PP-040 | Pruebas de regresión de autenticación | Completado local | PP-020 | Cuentas y hashes existentes conservados; acceso administrativo y de Portería cubierto |
| PP-041 | Pruebas E2E de perfiles | Completado local | PP-031 a PP-035 | Playwright aprobó escritorio y Android junto con la regresión crítica |
| PP-042 | Accesibilidad y responsive | Completado local | PP-031 a PP-035 | Axe sin hallazgos críticos/serios y pruebas sin desborde horizontal |
| PP-043 | Rendimiento de imágenes | Completado local | PP-021, PP-032 | Procesamiento acotado, dos variantes WEBP y dimensiones máximas definidas |
| PP-044 | Respaldo y restauración | Completado local | PP-010, PP-021 | Restauración aislada aprobada, conteos coincidentes y backend temporal saludable |
| PP-050 | Documentación de operación | Completado | PP-040 a PP-044 | Contrato, arquitectura, plan, pruebas y recuperación documentados |
| PP-051 | Ensayo de actualización escolar | Pendiente físico | PP-050 | Requiere dispositivos y red real del establecimiento; no bloquea pruebas locales |

## Fase 0: preparación

- Confirmar estado limpio del repositorio y rama base.
- Crear rama de trabajo.
- Inventariar autenticación, encabezado, usuarios, auditoría y respaldos.
- Registrar conteos de cuentas, permisos y migraciones de la base local de prueba.
- Crear datos de prueba que no correspondan a personas reales.

Salida: mapa exacto de integración y línea base de regresión.

## Fase 1: persistencia segura

- Crear migración 030.
- Crear perfiles vacíos para cuentas existentes.
- Crear entidad de archivos de perfil.
- Incorporar permisos y auditoría.
- Añadir índices y restricciones.
- Verificar ejecución repetida.

Puerta de calidad: mismos usuarios, hashes, permisos y datos escolares antes y después; perfiles nuevos sin duplicados.

## Fase 2: backend

- Separar rutas, servicios y validaciones en el dominio de perfiles.
- Implementar perfil propio.
- Implementar administración protegida.
- Implementar directorio paginado.
- Implementar archivos y variantes.
- Implementar fallback para perfiles ausentes.
- Incorporar auditoría.

Puerta de calidad: respuestas mínimas, 401 y 403 correctos, rutas físicas protegidas y ninguna posibilidad de modificar permisos desde el perfil.

## Fase 3: interfaz base

- Construir avatar y portada predeterminados.
- Crear `Mi perfil` y su editor responsive.
- Integrar el menú superior.
- Mostrar miniaturas en lugares apropiados.
- Añadir estados de carga, error, vacío y reintento.

Puerta de calidad: ninguna cuenta sin representación visual, foto opcional, cero desborde horizontal y navegación mediante teclado.

## Fase 4: directorio y disponibilidad

- Crear directorio institucional.
- Añadir filtros por nombre, cargo, área y estado.
- Crear vista de perfil ajeno.
- Implementar visibilidad de contacto.
- Añadir estados temporales.

Puerta de calidad: permisos respetados, campos restringidos ausentes sin autorización, estados con vencimiento y búsqueda tolerante a tildes.

## Fase 5: endurecimiento

- Probar imágenes malformadas y extensiones falsas.
- Medir memoria durante procesamiento.
- Verificar limpieza de archivos temporales.
- Validar entrega autenticada y política de seguridad.
- Verificar auditoría y eliminación lógica.

Puerta de calidad: ninguna imagen rompe el backend, no se aceptan archivos fuera de política y los respaldos contienen las variantes esperadas.

## Fase 6: aceptación

- Ejecutar pruebas unitarias, integración, build y lint.
- Ejecutar E2E en escritorio y móvil.
- Probar zoom 125, 150 y 200 por ciento.
- Restaurar un respaldo temporal.
- Simular actualización desde migración 029.
- Documentar evidencias y pendientes físicos.

Salida: candidata para prueba escolar, todavía sin despliegue automático.

## Orden sugerido de commits

1. `docs: documentar perfiles personales institucionales`
2. `add: crear esquema aditivo de perfiles personales`
3. `add: incorporar permisos y auditoría de perfiles`
4. `add: implementar servicio de perfil propio`
5. `add: gestionar imágenes optimizadas del personal`
6. `add: crear interfaz de perfil personal`
7. `mod: integrar avatar y menú del usuario`
8. `add: incorporar directorio institucional`
9. `add: gestionar disponibilidad y preferencias`
10. `test: cubrir perfiles personales y migración segura`
11. `docs: preparar operación y aceptación de perfiles`

Los commits se realizarán únicamente cuando exista autorización explícita durante la implementación.

## Definición de terminado

El bloque no se considerará terminado solamente porque compile. Debe cumplir migración segura, regresión de autenticación, permisos, auditoría, imágenes seguras, interfaz responsive, directorio, respaldo, restauración y documentación de operación. La aceptación física se informará separadamente de la evidencia local.
