# Instalación en un PC Windows del establecimiento

Esta guía instala el sistema de atrasos en un computador fijo del Liceo Domingo Santa María y lo deja disponible para otros equipos conectados a la misma red local.

## Requisitos previos

- Windows 10 u 11 de 64 bits con actualizaciones vigentes.
- 8 GB de RAM como mínimo; 16 GB recomendados.
- 20 GB libres en disco, más espacio para respaldos.
- Cuenta de Windows con permisos de administrador para la instalación inicial.
- Docker Desktop con WSL 2 habilitado y configurado para iniciarse con Windows.
- Conexión por cable de red para el PC servidor, idealmente con una dirección IP reservada por el router.

No se requiere Ubuntu instalado directamente. Docker Desktop administra el entorno Linux necesario.

## Instalación asistida

1. Copiar la carpeta completa del proyecto al PC que quedará como servidor.
2. Iniciar Docker Desktop y esperar hasta que indique que el motor está activo.
3. Abrir PowerShell como administrador en la carpeta del proyecto.
4. Ejecutar:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\instalar-windows.ps1
```

El instalador genera secretos aleatorios, detecta la IP del PC, crea la regla de firewall para el puerto 80, construye los contenedores y comprueba el frontend y la API.

Al terminar muestra dos direcciones:

- `http://localhost` para el propio PC servidor.
- `http://IP-DEL-PC` para teléfonos y computadores de la red escolar.

Las credenciales iniciales quedan en `credenciales-iniciales.txt`. Ese archivo no se versiona: debe copiarse a un lugar administrativo seguro, cambiar las claves iniciales y eliminar la copia del PC cuando ya no sea necesaria.

## Condiciones de red que debe confirmar el encargado técnico

- La red de funcionarios debe poder alcanzar la IP del servidor por TCP 80.
- El aislamiento de clientes Wi-Fi no debe bloquear la comunicación entre dispositivos autorizados.
- El router o servidor DHCP debe reservar la IP del PC para que el enlace no cambie.
- El PC no debe suspenderse durante la jornada ni cerrar Docker Desktop.
- No se debe publicar el puerto 80 hacia Internet mediante redirección del router.

Si el establecimiento necesita acceso desde fuera de su red, debe agregarse HTTPS con un dominio institucional y `COOKIE_SECURE=true`. No corresponde exponer directamente el PC interno.

## Comprobación

En el servidor:

```powershell
.\scripts\estado.ps1
```

En un teléfono conectado a la misma red, abrir la dirección indicada por el instalador. Si aparece la pantalla pero el inicio de sesión falla, verificar que la dirección IP actual esté incluida en `CORS_ORIGIN` dentro de `.env` y reiniciar con `docker compose up -d`.

## Inicio automático y energía

- Habilitar “Start Docker Desktop when you sign in”.
- Mantener una cuenta operativa iniciada tras reinicios del PC.
- Configurar Windows para no suspenderse cuando esté conectado a corriente.
- Conectar el PC y el equipo de red a un UPS si el establecimiento dispone de uno.

Los contenedores tienen política `unless-stopped`, por lo que vuelven a iniciar al arrancar Docker Desktop.

## Actualización controlada

Antes de actualizar:

```powershell
.\scripts\respaldo-ahora.ps1
git pull --ff-only
docker compose up -d --build
.\scripts\estado.ps1
```

Nunca actualizar durante el horario de entrada de estudiantes. Conservar una copia de la versión anterior o una rama de respaldo hasta completar la comprobación.
