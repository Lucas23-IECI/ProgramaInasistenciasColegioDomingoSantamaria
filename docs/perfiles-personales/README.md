# Perfiles personales del equipo institucional

## Estado

Implementado y validado localmente en la rama `Testing`. Pendiente de commit, integración y aceptación física; no desplegado en el colegio.

Este directorio contiene el contrato funcional y técnico del primer bloque de la próxima expansión del sistema. Su objetivo es incorporar una identidad personal interna para cada integrante del equipo sin confundirla con la cuenta de acceso, el cargo institucional o la plantilla de permisos.

La planificación original se preparó sobre el estado de `main` identificado por el commit `1580d67`. La implementación conserva este contrato y su evidencia local está registrada en los documentos de plan y pruebas.

## Resultado esperado

Cada integrante que inicia sesión tendrá un perfil personal interno con fotografía opcional, portada, presentación, datos de contacto institucionales, disponibilidad y preferencias. Las cuentas actuales seguirán utilizando los mismos correos, contraseñas, cargos, perfiles de acceso, permisos y registros de auditoría.

## Documentos del bloque

1. [Contexto y decisiones](01_CONTEXTO_Y_DECISIONES.md)
2. [Arquitectura y migración segura](02_ARQUITECTURA_Y_MIGRACION.md)
3. [Plan de implementación y tracker](03_PLAN_IMPLEMENTACION.md)
4. [Pruebas, despliegue y recuperación](04_PRUEBAS_Y_DESPLIEGUE.md)
5. [Roadmap posterior](05_ROADMAP_POSTERIOR.md)

## Definiciones obligatorias

### Cuenta

Credenciales y seguridad de ingreso: correo, contraseña, bloqueo, sesiones, estado y auditoría.

### Cargo institucional

Responsabilidad real de la persona dentro del establecimiento, por ejemplo Inspector General, Directora o Encargado de Portería.

### Perfil de acceso

Plantilla técnica reutilizable que recomienda permisos y módulos. Ejemplos: Administrador, Inspectoría, Dirección o Portería/Lector.

### Perfil personal

Identidad visible del integrante: fotografía, portada, nombre visible, presentación, área, ubicación, contacto, horario y estado.

Estas cuatro entidades no se reemplazan entre sí.

## Invariantes

- La implementación no borra ni reemplaza cuentas existentes.
- La implementación no modifica estudiantes, matrículas, atrasos, visitas, retiros, familias, justificaciones o documentos escolares.
- La ausencia de un perfil personal nunca impide iniciar sesión.
- La ausencia de fotografía utiliza un avatar predeterminado.
- Un usuario no puede cambiar su cargo, perfil de acceso o permisos desde su perfil personal.
- Cada modificación sensible conserva autor, fecha y valores relevantes en auditoría.
- Las imágenes forman parte del respaldo y de la restauración institucional.
- La interfaz sigue siendo operable en escritorio, tablet, celular y con zoom elevado.

## Valores predeterminados

- Persona sin fotografía: silueta neutra institucional.
- Cuenta compartida o institucional: escudo del Liceo Domingo Santa María.
- Persona sin portada: composición discreta con identidad visual del liceo.
- Persona sin perfil persistido: respuesta de compatibilidad generada desde `usuarios.nombre` y `usuarios.cargo`.

## Fuera de alcance de este primer bloque

- Chat interno.
- Seguimiento institucional de casos.
- Portal para apoderados.
- Agenda de entrevistas.
- Convivencia escolar.
- Cambios al cálculo de atrasos o asistencia.
- Perfiles públicos fuera de la red y de las cuentas autorizadas.
- Seguidores, publicaciones sociales, reacciones o funciones ajenas al trabajo escolar.

Estos elementos permanecen en el roadmap posterior y dependen de que la identidad del personal quede estable primero.
