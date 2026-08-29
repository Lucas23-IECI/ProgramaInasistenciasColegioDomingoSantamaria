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

El instalador genera secretos aleatorios, detecta la IP del PC, crea la regla de firewall para el puerto 80, construye los contenedores y comprueba el frontend y la API. Esa primera apertura HTTP sirve para comprobar conectividad, pero no habilita instalación PWA, cámara ni avisos del navegador en otros equipos.

Al terminar muestra dos direcciones:

- `http://localhost` para el propio PC servidor.
- `http://IP-DEL-PC` para teléfonos y computadores de la red escolar.

Las credenciales iniciales quedan en `credenciales-iniciales.txt`. Ese archivo no se versiona: debe copiarse a un lugar administrativo seguro, cambiar las claves iniciales y eliminar la copia del PC cuando ya no sea necesaria.

## HTTPS obligatorio para instalar la aplicación

La dirección recomendada para el uso cotidiano es `https://asistencia.ldsm.test`. HTTPS habilita la instalación como aplicación, la cámara y los avisos del navegador. El sistema puede seguir abriéndose por HTTP, pero el navegador bloqueará esas funciones; no se trata de un fallo de descarga.

La preparación inicial la ejecuta Lucas o soporte, una sola vez, en PowerShell
como administrador y dentro de la carpeta del proyecto:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\preparar-servidor-recomendado.ps1
```

El script detecta la IP, instala `mkcert` si falta, genera el certificado,
configura producción, inicia HTTPS y habilita las actualizaciones posteriores.
Conviene reservar esa IP para que el enlace cotidiano no cambie.

Cada computador administrado debe:

1. Confiar una sola vez en `certs\rootCA.pem`. Distribuya únicamente ese certificado público; nunca copie `rootCA-key.pem` ni `ldsm-lan-key.pem` a otros equipos.
2. Abrir la IP HTTPS indicada por el script y comprobar que el navegador no muestre una advertencia.
3. Opcionalmente, resolver `asistencia.ldsm.test` mediante DNS interno para usar un nombre estable.
4. Recién entonces usar **Instalar aplicación** y habilitar cámara o avisos si la persona los necesita.

No use excepciones del navegador, certificados vencidos ni opciones como “continuar de todos modos” como solución permanente.

### Alternativas de certificado

- **Recomendada para la red actual:** nombre interno estable, IP reservada, `mkcert` o una autoridad interna y distribución administrada de la raíz a los equipos del colegio.
- **Mejor a largo plazo si el colegio ya administra dominio y DNS:** subdominio institucional y certificado de una autoridad pública, manteniendo el servidor protegido y sin exponer directamente la base de datos.
- **Solo para pruebas en el mismo servidor:** `https://localhost`. No soluciona el acceso seguro desde otros computadores y no debe presentarse como despliegue institucional.

## Condiciones de red que debe confirmar el encargado técnico

- La red de funcionarios debe poder alcanzar la IP del servidor por TCP 80 y 443.
- El aislamiento de clientes Wi-Fi no debe bloquear la comunicación entre dispositivos autorizados.
- El router o servidor DHCP debe reservar la IP del PC para que el enlace no cambie.
- El PC no debe suspenderse durante la jornada ni cerrar Docker Desktop.
- No se deben publicar los puertos 80, 443 ni 5432 hacia Internet mediante redirección directa del router.

Si el establecimiento necesita acceso desde fuera de su red, se requiere un diseño separado con dominio institucional, HTTPS, control de acceso y revisión técnica. No corresponde exponer directamente el PC interno.

## Comprobación

En el servidor:

```powershell
.\scripts\estado.ps1
```

En un teléfono conectado a la misma red, abrir la dirección HTTPS indicada por
el script. Si aparece la pantalla pero el inicio de sesión falla, enviar la
salida de `estado.ps1` a soporte; no editar `.env` ni los certificados.

Antes de declarar el servidor listo para uso institucional, ejecutar:

```powershell
.\scripts\verificar-produccion.ps1
```

Todos los controles obligatorios deben aparecer como correctos. No publique una actualización si el script informa valores de desarrollo, cookies sin seguridad, contraseñas débiles u orígenes HTTP.

## Inicio automático y energía

- Habilitar “Start Docker Desktop when you sign in”.
- Mantener una cuenta operativa iniciada tras reinicios del PC.
- Configurar Windows para no suspenderse cuando esté conectado a corriente.
- Conectar el PC y el equipo de red a un UPS si el establecimiento dispone de uno.

Los contenedores tienen política `unless-stopped`, por lo que vuelven a iniciar al arrancar Docker Desktop.

## Actualización controlada

Después de la preparación inicial, Andrés actualiza desde `main` con:

```powershell
git pull --ff-only origin main
```

El `post-merge` ejecuta automáticamente el respaldo antes de modificar los
servicios, construye las imágenes, aplica migraciones y comprueba salud y
producción. Debe aparecer `Actualización HTTPS completada y saludable`.

Nunca actualizar durante el horario de entrada de estudiantes. Conservar una copia de la versión anterior o una rama de respaldo hasta completar la comprobación.
