# Lectura MRZ de pasaportes

## Alcance

El sistema admite la zona MRZ TD3 de pasaportes como ayuda de transcripción al crear una ficha manual. La función:

- valida las dos líneas de 44 caracteres;
- comprueba número de pasaporte, nacimiento, vencimiento, datos opcionales y dígito compuesto;
- completa número, país, nombres y apellidos cuando el formulario todavía está vacío;
- exige declarar que el documento físico fue revisado;
- registra en auditoría solo formato, país y controles superados;
- no carga ni guarda fotografías, video, texto MRZ, nombre ni número de pasaporte en el evento de lectura.

## Límites

Una MRZ matemáticamente correcta no acredita autenticidad, vigencia migratoria ni identidad de quien presenta el documento. La persona operadora debe revisar físicamente fotografía, estado del documento y coincidencia de los datos.

La lectura requiere el permiso crítico **Leer MRZ de pasaporte**. El permiso aparece en **Usuarios y permisos** y puede retirarse individualmente.

## Procedimiento

1. Abrir **Personas y cursos → Agregar estudiante**.
2. Seleccionar **Pasaporte**.
3. Tocar **Leer zona MRZ**.
4. Leer o pegar exactamente las dos líneas inferiores.
5. Resolver cualquier error de largo, fecha o dígito antes de continuar.
6. Comparar físicamente los datos y marcar la revisión.
7. Aplicar los datos y completar curso, motivo institucional y contacto.

La importación ERP oficial no cambia: esta ayuda pertenece solo al ingreso manual.
