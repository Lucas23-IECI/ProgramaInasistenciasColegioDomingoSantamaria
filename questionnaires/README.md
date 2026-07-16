# Cuestionarios institucionales LDSM

Portal público independiente para levantar las definiciones funcionales del sistema de asistencia. Está preparado para Cloudflare Pages, Pages Functions y D1.

## Alcance

- invitaciones personales por cargo con token de un solo uso;
- borradores y guardado automático;
- envío definitivo con folio;
- administración privada, revocación y rotación de enlaces;
- exportación CSV y auditoría mínima;
- protección contra indexación, encuadre, abuso de inicio de sesión y bots;
- interfaz accesible y adaptable a teléfono y escritorio.

El formulario no solicita contraseñas ni antecedentes de estudiantes.

## Desarrollo local

1. Copiar `.dev.vars.example` como `.dev.vars` y reemplazar ambos secretos.
2. Instalar dependencias con `npm ci`.
3. Ejecutar las migraciones con `npm run db:local`.
4. Iniciar con `npm run dev`.
5. Abrir `http://localhost:8788`; la administración está en `/administrar`.

## Publicación

1. Crear una base D1 llamada `ldsm-cuestionarios`.
2. Reemplazar `database_id` en `wrangler.toml`.
3. Crear el proyecto Pages `cuestionarios-ldsm`.
4. Configurar `ADMIN_PASSWORD` y `SESSION_SECRET` como secretos de producción.
5. Ajustar `PUBLIC_BASE_URL` al dominio definitivo.
6. Aplicar migraciones remotas y publicar.

Los valores de `.dev.vars`, tokens personales y exportaciones no se incorporan al repositorio.
