# Programa de Inasistencias - Liceo Domingo Santa María

Sistema web para registrar entradas, atrasos e inasistencias de estudiantes mediante lector de código de barras. Incluye paneles administrativos, justificaciones, reportes, analítica y auditoría.

## Funcionalidades principales

- Inicio de sesión con JWT almacenado en cookie `HttpOnly`.
- Roles de lector, secretaría y administración.
- Registro de entrada por código de barras y detección de atrasos.
- Consulta y gestión de inasistencias y justificaciones.
- Gestión de estudiantes, cursos y usuarios.
- Importación masiva desde Excel.
- Reportes en Excel, indicadores y panel de analítica.
- Registro de auditoría para acciones administrativas.
- Tema claro/oscuro y modo de pantalla completa para el lector.
- Certificados médicos validados por formato, tamaño y firma de archivo, con metadatos y hash SHA-256.
- Respaldo diario verificado de PostgreSQL y certificados al ejecutar con Docker Compose.
- Interfaz institucional de pantalla completa, con controles amplios y foco visible.

## Tecnologías

| Capa | Tecnologías |
| --- | --- |
| Frontend | React 19, Vite 8, React Router, Axios, XLSX, JsBarcode |
| Backend | Node.js, Express 5, PostgreSQL, JWT, bcrypt |
| Despliegue | Docker Compose, Nginx, PostgreSQL 16 |

## Estructura

```text
backend/
  middleware/       Autenticación y autorización
  migrations/       Migraciones SQL versionadas
  services/         Persistencia segura de documentos
  test/             Pruebas automatizadas del backend
  init.sql          Esquema inicial
  seed.js           Bootstrap no destructivo
  server.js         API REST
frontend/
  public/           Recursos estáticos
  src/              Interfaz React
questionnaires/
  functions/        API pública y administración sobre Cloudflare Pages
  migrations/       Esquema D1 para invitaciones, respuestas y auditoría
  public/           Portal accesible de cuestionarios institucionales
docker-compose.yml  Servicios de base de datos, API, web y respaldo
```

## Puesta en marcha con Docker

1. Crear el archivo de entorno:

   ```powershell
   Copy-Item .env.example .env
   ```

2. Reemplazar todas las claves de ejemplo de `.env`, en especial `DB_PASSWORD`, `JWT_SECRET` y `DEFAULT_USER_PASSWORD`.

3. Construir e iniciar los servicios:

   ```powershell
   docker compose up --build
   ```

4. Abrir `http://localhost`.

Al crear una base nueva se generan cuentas locales para `lector@ldsm.local` y `admin@ldsm.local`. Ambas utilizan inicialmente el valor de `DEFAULT_USER_PASSWORD`; debe ser una clave de al menos 12 caracteres con mayúsculas, minúsculas y números, y debe cambiarse después del primer acceso.

Las importaciones ERP crean o actualizan estudiantes y matrículas, pero ignoran columnas de contraseña y nunca crean cuentas de acceso al sistema. Las cuentas se administran exclusivamente desde el módulo **Usuarios y permisos**.

## Desarrollo local

Requisitos: Node.js 20 o superior, npm y PostgreSQL 16 o compatible.

```powershell
Copy-Item backend/.env.example backend/.env

Set-Location backend
npm ci
npm start

Set-Location ../frontend
npm ci
npm run dev
```

El frontend queda disponible en `http://localhost:5173` y la API en `http://localhost:5000/api`.

El portal independiente de cuestionarios se ejecuta desde `questionnaires/` y queda disponible en `http://localhost:8788`. Su administración privada está en `/administrar`; los pasos de configuración y publicación están documentados en `questionnaires/README.md`.

La instancia pública del levantamiento institucional está disponible en `https://cuestionarios-ldsm.pages.dev`.

## Variables de entorno

| Variable | Uso |
| --- | --- |
| `DB_USER` | Usuario de PostgreSQL |
| `DB_PASSWORD` | Contraseña de PostgreSQL |
| `DB_NAME` | Base de datos de la aplicación |
| `DB_HOST` | Host de PostgreSQL |
| `DB_PORT` | Puerto de PostgreSQL |
| `PORT` | Puerto del backend |
| `JWT_SECRET` | Secreto obligatorio para firmar sesiones |
| `CORS_ORIGIN` | Orígenes permitidos, separados por coma |
| `DEFAULT_USER_PASSWORD` | Clave inicial para las cuentas locales de bootstrap |
| `NODE_ENV` | Entorno de ejecución |
| `TZ` | Zona horaria; se recomienda `America/Santiago` |
| `DB_POOL_MAX` | Máximo de conexiones del pool del backend |
| `UPLOADS_DIR` | Directorio persistente para certificados |

## Validación

```powershell
Set-Location frontend
npm run lint
npm run build

Set-Location ../backend
npm run check
npm test

Set-Location ..
docker compose config --quiet
```

La comprobación cubre lint y compilación del frontend, auditoría de dependencias, sintaxis y pruebas automatizadas del backend, validación de Docker Compose, migraciones reales, salud de los contenedores y un flujo de certificados con descarga, reutilización y revocación.

## Respaldos y restauración

El servicio `backup` genera al iniciar y luego diariamente:

- un `pg_dump` en formato personalizado, validado con `pg_restore --list`;
- un archivo comprimido del volumen de certificados, también validado;
- un manifiesto SHA-256 de ambos artefactos.

La restauración es deliberadamente explícita. Revise primero el respaldo y ejecute `backend/restore.sh` con las variables indicadas en el propio script. El proceso exige una confirmación textual para evitar restauraciones accidentales.

## Decisión funcional pendiente

El cálculo actual de presentes, ausentes y alertas tempranas se mantiene sin cambios en esta etapa. Antes de modificarlo, el establecimiento debe definir calendario escolar, hora y responsable del cierre diario, estados oficiales, reglas de ausencia inferida y vigencia histórica de las matrículas. El alcance y los criterios de aceptación están documentados en `docs/PLAN_INTEGRACION_INSTITUCIONAL.md`.

## Protección de datos

Este repositorio no debe contener nóminas, planillas de asistencia, carnets, respaldos, archivos `.env` ni exportaciones con datos personales. Los patrones correspondientes están excluidos en `.gitignore`.

Para pruebas se deben usar registros ficticios. No se deben publicar RUT, nombres, correos, teléfonos, fechas de nacimiento, contraseñas ni información de apoderados reales.

## Flujo de ramas y commits

- `main`: versión estable.
- `test`: integración y validación previa.
- `agent/*`, `feature/*` o `fix/*`: cambios acotados.
- `respaldo/*`: puntos de recuperación antes de publicaciones amplias.

Los commits usan mensajes convencionales en español, por ejemplo:

```text
feat: incorporar panel de inasistencias
fix: evitar exposición de credenciales en registros
docs: actualizar guía de instalación
chore: excluir datos operacionales del repositorio
```
