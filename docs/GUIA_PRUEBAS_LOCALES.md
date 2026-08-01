# Guía de pruebas locales

## Acceso

- En el PC servidor: `http://127.0.0.1`
- Desde otro equipo de la misma red: `http://IP_DEL_SERVIDOR`
- Para probar la cámara del celular: utilice la dirección HTTPS interna y confíe primero la autoridad certificadora institucional.

Las credenciales se administran en el sistema y en `.env`; este documento no contiene contraseñas.

## Validación automática completa

Desde PowerShell, en la raíz del proyecto:

```powershell
.\scripts\validar-calidad-local.ps1
```

Para agregar el ensayo aislado del respaldo vigente:

```powershell
.\scripts\validar-calidad-local.ps1 -IncluirRestauracion
```

La validación comprueba backend, frontend, lint, pruebas unitarias, compilación, presupuesto de rendimiento, flujos E2E de escritorio y Android, planilla ERP oficial y dependencias. No modifica el padrón. El ensayo de restauración crea y destruye solamente contenedores temporales.

## Pruebas funcionales recomendadas

### Administración

1. Inicie sesión con una cuenta administrativa.
2. Abra **Personas y cursos**.
3. Compruebe búsqueda, cursos, estados vacíos y paginación.
4. Abra **Agregar estudiante** y verifique RUN, IPE, pasaporte, DNI, cédula extranjera y ficha sin documento.
5. Seleccione **Pasaporte**. La acción **Leer zona MRZ** debe aparecer únicamente si la cuenta posee ese permiso.
6. Revise que los documentos permanezcan enmascarados para cuentas sin permiso sensible.
7. Previsualice la planilla oficial antes de confirmar; no confirme una importación durante una prueba exploratoria.

### Portería

1. Inicie sesión con una cuenta del perfil Portería/Lector.
2. El panel debe mostrar solo **Registro de estudiantes** y **Control de visitas y retiros**.
3. En el terminal compruebe pistola, cámara y búsqueda manual.
4. El botón **Panel principal** debe regresar al puesto de Portería.
5. En retiros, busque primero al responsable; si existe, deben aparecer todos los hermanos vinculados.
6. Registre una visita de prueba y luego su salida para no dejar personas abiertas.

### Vista móvil

1. Pruebe a 320, 375 y 414 píxeles de ancho.
2. No debe existir desplazamiento horizontal.
3. Los botones deben poder tocarse sin ampliar la pantalla.
4. La cámara debe detenerse al cambiar de método, volver al panel o cerrar sesión.
5. Denegar el permiso de cámara debe ofrecer búsqueda manual, sin bloquear el terminal.

## Pruebas que requieren el colegio

- Confiar la CA institucional en cada dispositivo autorizado.
- Probar la cámara en Android y, si existe, iPhone físicos.
- Probar la pistola real conectada al PC de Portería.
- Reservar IP o DNS interno y validar acceso desde las VLAN/redes definitivas.
- Comprobar reinicio de Windows, arranque automático, cifrado y recuperación.
- Aprobar responsables, retención de datos y procedimiento de incidentes.
