# HTTPS confiable en la red interna

El aviso «No es seguro» aparece porque el sistema se abre mediante HTTP. Un
certificado autofirmado sin confianza instalada también muestra una advertencia.
Para eliminarla de forma correcta, cada equipo debe confiar en una autoridad
local y acceder mediante un nombre o una IP incluidos en el certificado.

## Preparación del servidor Windows

1. Reserve una IP fija para el PC servidor en el router del colegio.
2. Instale `mkcert`:

   ```powershell
   winget install --id FiloSottile.mkcert -e
   ```

3. Desde la carpeta del proyecto, genere el certificado. Reemplace la IP:

   ```powershell
   .\scripts\preparar-https-red-interna.ps1 -LanIp 192.168.50.28 -InstalarAutoridadLocal
   ```

4. Configure en el DNS local o en el archivo `hosts` de cada equipo:

   ```text
   192.168.50.28 asistencia.ldsm.test
   ```

5. Inicie el sistema:

   ```powershell
   $env:HTTPS_CORS_ORIGIN='https://asistencia.ldsm.test,https://192.168.50.28'
   docker compose -f docker-compose.yml -f docker-compose.https.yml up -d --build
   ```

## Confianza en los equipos cliente

El script indica la ruta de `rootCA.pem`. Ese archivo es un certificado público;
la clave privada permanece en el servidor y nunca debe distribuirse.

En cada PC Windows, importe `rootCA.pem` en:

`Equipo local > Entidades de certificación raíz de confianza > Certificados`.

Luego abra:

`https://asistencia.ldsm.test`

Los teléfonos también deben instalar y confiar explícitamente esa autoridad.
Este paso depende de Android o iOS y debe realizarse bajo la política del
establecimiento.

## Comprobación

```powershell
docker compose -f docker-compose.yml -f docker-compose.https.yml ps
curl.exe -I https://asistencia.ldsm.test/healthz
```

El navegador debe mostrar HTTPS sin advertencia. Si todavía aparece el aviso,
compruebe la fecha y hora del equipo, el nombre utilizado, la confianza de
`rootCA.pem` y que la IP no haya cambiado.

No active HSTS hasta confirmar que todos los equipos confían en la autoridad;
así se conserva una ruta de recuperación durante la instalación.
