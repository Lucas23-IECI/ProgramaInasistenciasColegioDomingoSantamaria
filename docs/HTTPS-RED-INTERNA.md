# HTTPS confiable en la red interna

El aviso «No es seguro» aparece porque el sistema se abre mediante HTTP. Un
certificado autofirmado sin confianza instalada también muestra una advertencia.
Para eliminarla de forma correcta, cada equipo debe confiar en una autoridad
local y acceder mediante un nombre o una IP incluidos en el certificado.

## Preparación inicial del servidor Windows

Esta preparación se realiza una sola vez por Lucas o por soporte técnico, no
como parte de cada actualización de Andrés. Automatiza la configuración segura,
el certificado, el firewall, Docker y las actualizaciones posteriores.

Desde PowerShell como administrador, dentro del proyecto:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\preparar-servidor-recomendado.ps1
```

El script detecta la IPv4 vigente. `-LanIp` solo es necesario si el servidor
tiene varias redes. Requiere Internet únicamente si debe instalar `mkcert` por
primera vez. Los pasos siguientes describen lo que automatiza y sirven para
diagnóstico; Andrés no debe repetirlos en una actualización normal.

1. Reserve una IP fija para el PC servidor en el router del colegio.
2. Instale `mkcert`:

   ```powershell
   winget install --id FiloSottile.mkcert -e
   ```

3. Desde la carpeta del proyecto, genere el certificado. Reemplace la IP:

   ```powershell
   .\scripts\preparar-https-red-interna.ps1 -LanIp 192.168.1.10 -InstalarAutoridadLocal
   ```

4. Opcionalmente, configure en el DNS local el nombre interno:

   ```text
   192.168.1.10 asistencia.ldsm.test
   ```

5. Inicie el sistema:

   ```powershell
   $env:HTTPS_CORS_ORIGIN='https://asistencia.ldsm.test,https://192.168.50.28'
   docker compose -f docker-compose.yml -f docker-compose.https.yml up -d --build
   ```

## Confianza inicial en los equipos cliente

El script indica la ruta de `rootCA.pem`. Ese archivo es un certificado público;
la clave privada permanece en el servidor y nunca debe distribuirse.

En cada PC Windows autorizado, Lucas o soporte importa una sola vez
`certs\rootCA.pem` en:

`Equipo local > Entidades de certificación raíz de confianza > Certificados`.

Luego abra:

`https://asistencia.ldsm.test`

Los teléfonos también deben instalar y confiar explícitamente esa autoridad.
Este paso depende de Android o iOS y debe realizarse bajo la política del
establecimiento.

## Escáner con cámara del teléfono

La cámara solo se habilita al abrir el sistema mediante un origen seguro. Use
el nombre HTTPS incluido en el certificado; no utilice la dirección HTTP de la
red local.

1. Abra `https://asistencia.ldsm.test` desde el teléfono autorizado.
2. Inicie sesión con una cuenta que tenga el permiso «Registrar con cámara».
3. Entre a «Registro de estudiantes» y seleccione «Cámara del celular».
4. Autorice la cámara trasera solamente mientras utiliza el terminal.
5. Centre el código dentro de la guía y compruebe nombre, curso y resultado.
6. Repita inmediatamente el mismo código y confirme que no se genere otro
   ingreso.
7. Salga del modo cámara y compruebe que el indicador del sistema operativo se
   apague.

El navegador procesa la imagen en el dispositivo. La aplicación no guarda
fotografías ni videos. Si el permiso fue denegado, el certificado no es
confiable o la cámara no está disponible, el terminal conserva la búsqueda
manual como alternativa.

## Comprobación

```powershell
docker compose -f docker-compose.yml -f docker-compose.https.yml ps
curl.exe -I https://asistencia.ldsm.test/healthz
```

El navegador debe mostrar HTTPS sin advertencia. Si todavía aparece el aviso,
compruebe la fecha y hora del equipo, el nombre utilizado, la confianza de
`rootCA.pem` y que la IP no haya cambiado.

En la respuesta de `index.html`, la cabecera `Permissions-Policy` debe permitir
`camera=(self)` y mantener deshabilitados el micrófono y la geolocalización.

La configuración no activa HSTS durante esta etapa, para conservar una ruta de
recuperación mientras se termina de confiar la autoridad en todos los equipos.

## Actualizaciones posteriores

La preparación instala un `post-merge` local. En `main`, un pull exitoso ejecuta
automáticamente respaldo, build, migraciones, inicio HTTPS, estado y controles
de producción. Andrés solo utiliza:

```powershell
git pull --ff-only origin main
```

Debe esperar el mensaje `Actualización HTTPS completada y saludable`. Si el
hook informa un error, no debe editar `.env`, certificados ni Docker: debe
conservar la salida y enviarla a soporte.
