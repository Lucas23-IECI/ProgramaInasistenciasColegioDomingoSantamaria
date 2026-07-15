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
- Respaldo diario de PostgreSQL al ejecutar con Docker Compose.

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
  init.sql          Esquema inicial
  seed.js           Configuración y usuarios iniciales
  server.js         API REST
frontend/
  public/           Recursos estáticos
  src/              Interfaz React
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

Al crear una base nueva se generan cuentas locales para `lector@colegio.cl` y `admin@colegio.cl`. Ambas utilizan inicialmente el valor de `DEFAULT_USER_PASSWORD`; debe cambiarse después del primer acceso.

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
| `DEFAULT_USER_PASSWORD` | Clave inicial para cuentas creadas por bootstrap o importación |
| `NODE_ENV` | Entorno de ejecución |

## Validación

```powershell
Set-Location frontend
npm run lint
npm run build

Set-Location ../backend
node --check server.js
node --check seed.js
```

El backend todavía no cuenta con una suite automatizada de pruebas. La comprobación actual cubre sintaxis, compilación del frontend, lint y validación de Docker Compose.

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
