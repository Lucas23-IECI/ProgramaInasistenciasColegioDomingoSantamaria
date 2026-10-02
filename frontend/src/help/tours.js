const commonHeaderStep = {
  element: '[data-tour="page-header"]',
  popover: {
    title: 'Identificación del módulo',
    description: 'Aquí puedes confirmar en qué sección estás y cuál es su propósito principal.',
    side: 'bottom',
    align: 'start',
  },
};

const commonToolsStep = {
  element: '[data-tour="global-tools"]',
  popover: {
    title: 'Herramientas globales',
    description: 'Desde aquí puedes buscar registros habilitados por tus permisos (también con Ctrl + K), repetir esta ayuda y cambiar el tema. El icono de conversación y el botón Mensajes abajo a la derecha abren un chat flotante sin salir de tu trabajo, si tu cuenta tiene permiso. Puedes minimizarlo o abrir el chat completo. También tienes notificaciones, instalación y el menú de tu cuenta, donde puedes volver a abrir Novedades de la versión.',
    side: 'bottom',
    align: 'end',
  },
};

const profileDetailTour = {
  title: 'Recorrido del perfil de usuario',
  steps: [commonHeaderStep, {
    element: '[data-tour="profile-summary"]',
    popover: {
      title: 'Resumen del perfil',
      description: 'Aquí puedes revisar la finalidad del perfil, sus cuentas activas y las funciones recomendadas para nuevas cuentas.',
      side: 'bottom',
    },
  }, {
    element: '[data-tour="profile-actions"]',
    popover: {
      title: 'Administrar el perfil',
      description: 'Edita su recomendación, revisa la actividad consolidada y administra su estado. La eliminación solo está disponible cuando no tiene cuentas asociadas.',
      side: 'left',
    },
  }, {
    element: '[data-tour="profile-accounts"]',
    popover: {
      title: 'Cuentas del perfil',
      description: 'Busca personas, ajusta sus accesos, consulta su actividad, desactiva o elimina cuentas sin borrar la trazabilidad.',
      side: 'top',
    },
  }, {
    element: '[data-tour="account-history"]',
    popover: {
      title: 'Actividad individual',
      description: 'Abre la auditoría filtrada para ver lo que hizo esta cuenta y los cambios administrativos aplicados sobre ella.',
      side: 'left',
    },
  }, commonToolsStep],
};

const tours = {
  '/mi-perfil': {
    title: 'Recorrido de mi perfil',
    steps: [commonHeaderStep, {
      element: '[data-tour="staff-profile-hero"]',
      popover: {
        title: 'Tu presentacion interna',
        description: 'Aqui se muestran tu foto, cargo, area y disponibilidad. Puedes cambiar o volver a encuadrar la foto y la portada; si no subes una imagen se utiliza una silueta neutra.',
        side: 'bottom',
      },
    }, {
      element: '[data-tour="staff-profile-editor"]',
      popover: {
        title: 'Información que puedes editar',
        description: 'Actualiza tu presentacion, disponibilidad y contacto interno. El cargo y los permisos siguen bajo control administrativo.',
        side: 'top',
      },
    }, commonToolsStep],
  },
  '/directorio': {
    title: 'Recorrido del directorio interno',
    steps: [commonHeaderStep, {
      element: '[data-tour="staff-directory-search"]',
      popover: {
        title: 'Encontrar a una persona',
        description: 'Busca por nombre, cargo o área institucional. Solo se muestran cuentas activas y perfiles visibles. Si la consulta falla, se muestra el problema y puedes reintentar; no se informa como cero coincidencias.',
        side: 'bottom',
      },
    }, {
      element: '[data-tour="staff-directory-list"]',
      popover: {
        title: 'Equipo institucional',
        description: 'Abre una fila para consultar el perfil, la ubicacion y los datos internos que la persona decidio compartir.',
        side: 'top',
      },
    }, commonToolsStep],
  },
  '/admin': {
    title: 'Recorrido del panel principal',
    steps: [
      {
        element: '[data-tour="hub-intro"]',
        popover: {
          title: 'Panel institucional',
          description: 'Este espacio resume el contexto de trabajo y los módulos disponibles para tu perfil.',
          side: 'bottom',
        },
      },
      {
        element: '[data-tour="role-overview"]',
        popover: {
          title: 'Prioridades de tu jornada',
          description: 'Resume tareas reales según tu cargo y permisos. Dirección también compara las dos mitades del mes y puede abrir el historial completo de avisos enviados.',
          side: 'bottom',
        },
      },
      {
        element: '[data-tour="hub-modules"]',
        popover: {
          title: 'Módulos de trabajo',
          description: 'Los módulos están agrupados por recepción, puntualidad, comunidad y administración. Cada cuenta ve únicamente las funciones que tiene habilitadas.',
          side: 'top',
        },
      },
      commonToolsStep,
    ],
  },
  '/admin/atrasos': {
    title: 'Recorrido del control de atrasos',
    steps: [
      commonHeaderStep,
      {
        element: '[data-tour="late-summary"]',
        popover: {
          title: 'Resumen del día',
          description: 'Consulta ingresos registrados, llegadas a tiempo y atrasos sin inferir asistencia por falta de escaneo.',
          side: 'bottom',
        },
      },
      {
        element: '[data-tour="late-list"]',
        popover: {
          title: 'Atrasos registrados',
          description: 'Busca registros y abre Gestionar para corregir, justificar, anular o revisar su historial. Si la carga falla, verás la causa y un reintento; nunca se mostrará como una lista vacía.',
          side: 'top',
        },
      },
      {
        element: '[data-tour="pending-justifications"]',
        popover: {
          title: 'Justificaciones pendientes',
          description: 'Busca un atraso anterior por estudiante, curso o período. La justificación se aplica al registro seleccionado y conserva la fecha original del atraso. Un fallo de consulta se muestra por separado y no se interpreta como cero pendientes.',
          side: 'top',
        },
      },
      {
        element: '[data-tour="report-builder"]',
        popover: {
          title: 'Reportes',
          description: 'Configura el período, alcance y formato antes de descargar un informe institucional.',
          side: 'top',
        },
      },
      commonToolsStep,
    ],
  },
  '/admin/estudiantes': {
    title: 'Recorrido de personas y cursos',
    steps: [
      commonHeaderStep,
      {
        element: '[data-tour="students-navigation"]',
        popover: {
          title: 'Padrón e importaciones',
          description: 'Cambia entre nómina, carga ERP, apoderados y control del padrón. Puedes descargar plantillas vacías, previsualizar cada carga y detectar si el mismo archivo ya fue importado. Las importaciones nunca crean cuentas de acceso.',
          side: 'bottom',
        },
      },
      {
        element: '[data-tour="student-manual-create"]',
        popover: {
          title: 'Gestión manual',
          description: 'Agrega una matrícula individual sin importar otra planilla. Si entras desde un curso, el formulario lo conserva y puedes cambiarlo. Selecciona un motivo de alta; Otro motivo exige un detalle. Si los cursos no cargan, reintenta antes de guardar. Escape cierra primero el selector abierto, sin perder el formulario. Desde cada ficha también puedes editar, retirar o reactivar al estudiante con trazabilidad.',
          side: 'bottom',
        },
      },
      {
        element: '[data-tour="student-search"]',
        popover: {
          title: 'Búsqueda de personas',
          description: 'Busca por nombre, apellido, RUT o usuario institucional.',
          side: 'bottom',
        },
      },
      {
        element: '[data-tour="course-selector"]',
        popover: {
          title: 'Cursos',
          description: 'Selecciona un curso para revisar su nómina o consulta la matrícula completa.',
          side: 'top',
        },
      },
      {
        element: '[data-tour="student-list"]',
        popover: {
          title: 'Nómina',
          description: 'Filtra la lista y abre la ficha de una persona para revisar su información institucional.',
          side: 'top',
        },
      },
      {
        element: '[data-tour="student-governance"]',
        popover: {
          title: 'Control del padrón',
          description: 'Revisa calidad, altas manuales, historial y duplicados. La reversión segura se bloquea si hubo cambios posteriores y nunca borra fichas ni actividad institucional. Si una carga rechaza filas, conserva las válidas y muestra las causas por fila. Nombre Usuario es opcional: no se inventa cuando viene vacío. También puedes exportar el padrón.',
          side: 'top',
        },
      },
      commonToolsStep,
    ],
  },
  '/admin/analiticas': {
    title: 'Recorrido de estadísticas',
    steps: [commonHeaderStep, {
      element: '[data-tour="analytics-filters"]',
      popover: {
        title: 'Período y filtros',
        description: 'El período se aplica a toda la página. Curso, justificación y severidad filtran los indicadores de puntualidad y las exportaciones; visitas, retiros y Convivencia permanecen institucionales dentro de esas mismas fechas. Si una consulta falla, la pantalla muestra la causa segura y permite reintentar sin confundirla con cero resultados.',
        side: 'bottom',
      },
    }, {
      element: '[data-tour="analytics-summary"]',
      popover: {
        title: 'Resumen de puntualidad registrada',
        description: 'Estos indicadores cuentan únicamente ingresos realmente registrados. Los cuatro se pueden abrir y conservan el período, curso, justificación y severidad visibles.',
        side: 'bottom',
      },
    }, {
      element: '[data-tour="analytics-daily-chart"]',
      popover: {
        title: 'Evolución diaria interactiva',
        description: 'Cambia entre línea, barras o tabla. Puedes mostrar cantidades, fijar un día con clic, toque o Enter y luego abrir exactamente sus registros.',
        side: 'bottom',
      },
    }, {
      element: '[data-tour="analytics-breakdowns"]',
      popover: {
        title: 'Distribución y cursos',
        description: 'Compara rangos de minutos y cursos. Cada fila abre los registros exactos que la componen; la lista de cursos se pagina cuando supera ocho resultados.',
        side: 'top',
      },
    }, {
      element: '[data-tour="analytics-recurrence"]',
      popover: {
        title: 'Recurrencia observada',
        description: 'Muestra estudiantes con atrasos dentro del alcance activo. “Ver registros” abre solamente los ingresos de esa persona en el período; no es un diagnóstico ni una inferencia de asistencia.',
        side: 'top',
      },
    }, {
      element: '[data-tour="analytics-institutional"]',
      popover: {
        title: 'Analítica institucional explicable',
        description: 'Reúne puntualidad filtrada, visitas, retiros y Convivencia. Sus indicadores y barras abren las listas reales filtradas; cada módulo vuelve a comprobar tus permisos antes de mostrar datos.',
        side: 'top',
      },
    }, {
      element: '[data-tour="analytics-export"]',
      popover: {
        title: 'Exportar el alcance actual',
        description: 'PDF y Excel conservan el período, curso, justificación y severidad visibles. El PDF incluye tablas y metodología; el Excel separa resumen, evolución, cursos, bloques, estudiantes, visitas, retiros, Convivencia, equipos y reglas en hojas revisables. Ambos declaran qué secciones siguen mostrando totales institucionales.',
        side: 'left',
      },
    }, {
      element: '[data-tour="analytics-schedules"]',
      popover: {
        title: 'Reportes automáticos',
        description: 'Programa un informe del período anterior cerrado. El historial conserva resultado y archivo; permite descargar ejecuciones correctas y reintentar fallos con una causa clara, evitando reintentos simultáneos o repetidos después de un resultado correcto. No reutiliza filtros temporales de pantalla.',
        side: 'top',
      },
    }, commonToolsStep],
  },
  '/admin/usuarios': {
    title: 'Recorrido de usuarios y permisos',
    steps: [commonHeaderStep, {
      element: '[data-tour="profiles-catalog"]',
      popover: {
        title: 'Catálogo de perfiles',
        description: 'Los perfiles son tipos reutilizables de acceso, como Administrador, Inspectoría o Portería. No corresponden a alumnos ni cursos.',
        side: 'bottom',
      },
    }, {
      element: '[data-tour="profiles-grid"]',
      popover: {
        title: 'Abrir un perfil',
        description: 'Pulsa cualquier parte de una tarjeta para revisar sus cuentas, permisos recomendados y opciones de administración. Al habilitar una acción, el sistema incorpora también el acceso necesario a su módulo; al retirar ese acceso base, retira sus acciones dependientes para evitar pantallas visibles que luego no puedan operar.',
        side: 'top',
      },
    }, commonToolsStep],
  },
  '/admin/auditoria': {
    title: 'Recorrido de auditoría',
    steps: [commonHeaderStep, {
      element: '[data-tour="audit-subject"]',
      popover: {
        title: 'Cuenta seleccionada',
        description: 'Cuando llegas desde Usuarios, esta franja confirma qué cuenta estás revisando y si sigue activa, desactivada o eliminada.',
        side: 'bottom',
      },
    }, {
      element: '[data-tour="audit-filters"]',
      popover: {
        title: 'Búsqueda de actividad',
        description: 'La consulta parte con los últimos 30 días. Puedes filtrar por categoría, acción, sección, persona y período; los catálogos se actualizan con los eventos reales del sistema.',
        side: 'bottom',
      },
    }, {
      element: '[data-tour="audit-list"]',
      popover: {
        title: 'Registro de actividad',
        description: 'Cada fila indica quién hizo la acción, cuándo ocurrió, qué sección o registro afectó y desde qué equipo o red. El detalle se presenta con etiquetas legibles y las exportaciones respetan exactamente los filtros visibles.',
        side: 'top',
      },
    }, commonToolsStep],
  },
  '/admin/configuracion': {
    title: 'Recorrido de configuración',
    steps: [commonHeaderStep, {
      element: '[data-tour="punctuality-settings"]',
      popover: {
        title: 'Jornada institucional',
        description: 'Aquí defines el nombre de la jornada y cuándo se activan las alertas por atrasos reiterados. Si la configuración vigente no puede cargarse, la edición se bloquea hasta recuperarla para evitar sobrescribirla con valores incompletos.',
        side: 'top',
      },
    }, {
      element: '[data-tour="punctuality-controls"]',
      popover: {
        title: 'Controles durante el día',
        description: 'Agrega ingreso, regresos de recreo, almuerzo o talleres. Cada control puede tener horarios, días y cursos distintos.',
        side: 'top',
      },
    }, {
      element: '[data-tour="punctuality-preview"]',
      popover: {
        title: 'Vista previa operativa',
        description: 'Comprueba el orden del día y las ventanas que propondrá automáticamente el terminal de registro.',
        side: 'left',
      },
    }, commonToolsStep],
  },
  '/admin/visitas': {
    title: 'Recorrido de visitas y retiros',
    steps: [commonHeaderStep, {
      element: '[data-tour="visits-summary"]',
      popover: {
        title: 'Situación del establecimiento',
        description: 'Cada indicador es interactivo: abre directamente las personas dentro, los movimientos del día o los retiros registrados. Si no se puede confirmar el estado vigente, Portería bloquea cifras, listas y formularios hasta que la recarga funcione.',
        side: 'bottom',
      },
    }, {
      element: '[data-tour="visits-navigation"]',
      popover: {
        title: 'Un solo puesto de Portería',
        description: 'Desde este computador puedes registrar visitas, confirmar salidas y completar retiros sin cambiar de cuenta ni depender de otro equipo.',
        side: 'bottom',
      },
    }, {
      element: '[data-tour="visits-list"]',
      popover: {
        title: 'Personas dentro',
        description: 'Registra la salida desde esta lista. Si llegas desde Seguimiento, la pantalla aísla la visita o el retiro exacto y ofrece volver al historial completo sin perder trazabilidad.',
        side: 'top',
      },
    }, {
      element: '[data-tour="visits-reports"]',
      popover: {
        title: 'Reportes institucionales',
        description: 'Define un período y exporta visitas, retiros o ambos en Excel, PDF o Markdown. Los documentos se mantienen enmascarados.',
        side: 'top',
      },
    }, commonToolsStep],
  },
  '/admin/convivencia': {
    title: 'Recorrido de convivencia escolar',
    steps: [{
      element: '[data-tour="page-header"]',
      popover: {
        title: 'Convivencia escolar protegida',
        description: 'Este módulo reúne situaciones, actuaciones y documentos reservados. Las acciones disponibles dependen de tus permisos y cada modificación queda trazada.',
        side: 'bottom',
      },
    }, {
      element: '[data-tour="coexistence-alerts"]',
      popover: {
        title: 'Avisos automáticos y privados',
        description: 'Las revisiones vencidas avisan al responsable. Un caso urgente sin una cuenta responsable activa avisa solamente a quienes pueden consultar Convivencia. El sistema evita repetir el mismo aviso mientras el problema siga abierto.',
        side: 'bottom',
      },
    }, {
      element: '[data-tour="coexistence-summary"]',
      popover: {
        title: 'Situación protegida de los casos',
        description: 'Los indicadores filtran casos activos, en seguimiento, con revisión pendiente o cerrados durante el mes. Las cifras no exponen antecedentes a perfiles no autorizados.',
        side: 'bottom',
      },
    }, {
      element: '[data-tour="coexistence-filters"]',
      popover: {
        title: 'Búsqueda y filtros',
        description: 'Busca por código, título o persona vinculada y combina estado y prioridad. El resumen y los filtros siempre actúan sobre la misma bandeja paginada.',
        side: 'bottom',
      },
    }, {
      element: '[data-tour="coexistence-cases"]',
      popover: {
        title: 'Bandeja institucional',
        description: 'Abre la ficha reservada para revisar responsable, próxima revisión y actividad. Solo las cuentas con permisos explícitos pueden consultar esta información. Si la carga falla, la bandeja y la ficha lo distinguen de un resultado vacío y permiten reintentar.',
        side: 'top',
      },
    }, commonToolsStep],
  },
  '/admin/documentos': {
    title: 'Recorrido de gestión documental',
    steps: [commonHeaderStep, {
      element: '[data-tour="documents-summary"]',
      popover: {
        title: 'Estado de los expedientes',
        description: 'Revisa documentos activos, vencimientos, propuestas OCR pendientes y versiones sin firma interna. Un documento vencido o próximo a vencer puede abrir un único seguimiento y aviso vigente, con enlace a su ficha.',
        side: 'bottom',
      },
    }, {
      element: '[data-tour="documents-student-search"]',
      popover: {
        title: 'Expediente por estudiante',
        description: 'Busca a una persona para consultar o incorporar archivos protegidos. Los PDF generados desde plantilla nacen pendientes y deben revisarse antes de marcarlos vigentes o firmarlos.',
        side: 'bottom',
      },
    }, {
      element: '[data-tour="documents-list"]',
      popover: {
        title: 'Consulta transversal',
        description: 'Filtra los documentos registrados por estudiante, título, categoría, estado o vencimiento. La lista se divide en páginas para conservar todos los resultados; si el servidor no responde, verás la causa y una acción para reintentar en lugar de una lista vacía.',
        side: 'top',
      },
    }, commonToolsStep],
  },
  '/admin/operacion': {
    title: 'Recorrido de tareas operativas',
    steps: [commonHeaderStep, {
      element: '[data-tour="operations-status"]',
      popover: {
        title: 'Estado de la jornada',
        description: 'Resume las tareas visibles y confirma si el respaldo diario sigue vigente. Si la bandeja no carga, el sistema bloquea el cierre: nunca interpreta el fallo como cero pendientes.',
        side: 'bottom',
      },
    }, {
      element: '[data-tour="operations-list"]',
      popover: {
        title: 'Pendientes accionables',
        description: 'Cada fila muestra una responsabilidad concreta y abre directamente el módulo donde se resuelve. Las tareas internas permiten consultar su responsable, plazo e historial sin alterar los registros que les dieron contexto.',
        side: 'top',
      },
    }, {
      element: '[data-tour="operations-internal-tasks"]',
      popover: {
        title: 'Coordinación trazable',
        description: 'Si tu perfil tiene permiso, aquí puedes crear una tarea, asignarla y fijar un plazo. Cada cambio conserva quién lo realizó, cuándo ocurrió y el motivo de cierre.',
        side: 'top',
      },
    }, {
      element: '[data-tour="operations-close"]',
      popover: {
        title: 'Cierre operacional',
        description: 'Cierra exclusivamente visitas y retiros cuando ya no quedan movimientos abiertos. No calcula asistencia.',
        side: 'top',
      },
    }, commonToolsStep],
  },
  '/admin/visitas/configuracion': {
    title: 'Recorrido de configuración de visitas',
    steps: [commonHeaderStep, {
      element: '[data-tour="visits-general-settings"]',
      popover: {
        title: 'Reglas de Portería',
        description: 'Define el horario de revisión y las validaciones generales del módulo.',
        side: 'bottom',
      },
    }, {
      element: '[data-tour="visits-catalogs"]',
      popover: {
        title: 'Opciones institucionales',
        description: 'Administra motivos, destinos y relaciones sin eliminar las referencias históricas.',
        side: 'top',
      },
    }, commonToolsStep],
  },
  '/admin/familias': {
    title: 'Recorrido de ficha familiar',
    steps: [commonHeaderStep, {
      element: '[data-tour="family-directory"]',
      popover: {
        title: 'Directorio de responsables',
        description: 'Busca una persona por nombre o RUT y revisa todos los hermanos vinculados.',
        side: 'top',
      },
    }, commonToolsStep],
  },
  '/admin/gobierno-datos': {
    title: 'Recorrido de gobierno de datos',
    steps: [commonHeaderStep, {
      element: '[data-tour="data-governance"]',
      popover: {
        title: 'Políticas sin borrado automático',
        description: 'Documenta períodos y revisa cuántos registros quedarían fuera, sin eliminar información.',
        side: 'top',
      },
    }, commonToolsStep],
  },
  '/admin/seguimiento': {
    title: 'Recorrido de seguimiento institucional',
    steps: [commonHeaderStep, {
      element: '[data-tour="follow-automation-actions"]',
      popover: {
        title: 'Reglas con confirmación explícita',
        description: 'Configura umbrales, plazos, responsables y escalamiento. “Revisar ahora” solo previsualiza las condiciones detectadas; los casos se crean o actualizan después de una confirmación separada.',
        side: 'bottom',
      },
    }, {
      element: '[data-tour="follow-summary"]',
      popover: {
        title: 'Prioridades operativas',
        description: 'Abre directamente los casos activos, prioritarios, vencidos o todavía sin responsable.',
        side: 'bottom',
      },
    }, {
      element: '[data-tour="follow-list"]',
      popover: {
        title: 'Casos y tareas coordinadas',
        description: 'Cada fila resume el estudiante, el responsable, el plazo y las tareas pendientes. Abre un caso para registrar contactos, acuerdos, documentos y su conversación vinculada.',
        side: 'top',
      },
    }, commonToolsStep],
  },
  '/chat': {
    title: 'Recorrido del chat interno',
    steps: [commonHeaderStep, {
      element: '[data-tour="chat-sidebar"]',
      popover: {
        title: 'Conversaciones institucionales',
        description: 'Busca conversaciones o mensajes en la columna izquierda. El botón + inicia una conversación directa, un grupo o un canal según tus permisos. Panel principal vuelve al menú; Usar chat flotante vuelve a tu trabajo manteniendo la conversación. Al minimizar o ampliar se conserva el borrador, la urgencia y las menciones en esta pestaña; se borran al cerrar sesión o recargar. En celular, usa la flecha para volver a la lista.',
        side: 'right',
      },
    }, {
      element: '[data-tour="chat-thread"]',
      popover: {
        title: 'Coordinación con trazabilidad',
        description: 'Los mensajes se agrupan por día; los tuyos aparecen a la derecha. Una marca indica envío confirmado; dos indican lecturas registradas. Enter envía y Mayús + Enter agrega una línea. El clip adjunta archivos de hasta 8 MB y @ menciona integrantes. Toca una foto JPG o PNG para verla, ampliarla o descargarla; Escape cierra el visor. Solo propietarios y moderadores (administradores del grupo) pueden fijar mensajes. Si falla el envío, se conserva el texto para reintentar. Un chat contextual permite volver directamente al registro original.',
        side: 'left',
      },
    }, {
      element: '[data-tour="chat-thread"]',
      popover: {
        title: 'Opciones del grupo y avisos',
        description: 'En Preferencias puedes ajustar tus avisos y horarios de silencio. En grupos manuales, los administradores cambian foto, nombre, descripción y quién puede escribir. Solo los propietarios cambian roles; el último debe asignar otro antes de salir. Los canales institucionales automáticos se administran desde los equipos: el chat no ofrece cambios que la sincronización reemplazaría. La política de retención permanece desactivada hasta que se apruebe y guarde expresamente; no se activa al cambiar la apariencia.',
        side: 'left',
      },
    }, {
      element: '[data-tour="chat-sidebar"]',
      popover: {
        title: 'Tu apariencia personal',
        description: 'El botón Apariencia del chat (paleta) permite elegir un fondo y el tamaño del texto solo para tu cuenta. Puedes usar una imagen JPG o PNG de hasta 4 MB. Guardar aplica el cambio en tus dispositivos; Cancelar descarta la selección. Restablecer apariencia vuelve al fondo institucional y elimina tu imagen guardada al confirmar. Un error no se presenta como guardado exitoso.',
        side: 'right',
      },
    }, commonToolsStep],
  },
  '/agenda': {
    title: 'Recorrido de la agenda interna',
    steps: [commonHeaderStep, {
      element: '[data-tour="agenda-period"]',
      popover: {
        title: 'Tu semana de coordinación',
        description: 'Avanza entre semanas para consultar únicamente reuniones, revisiones y recordatorios personales o donde fuiste invitado. Los eventos de otras cuentas no son visibles.',
        side: 'bottom',
      },
    }, {
      element: '[data-tour="agenda-grid"]',
      popover: {
        title: 'Eventos y respuestas',
        description: 'Abre un evento para ver horario, lugar, participantes y recordatorio. Si recibiste una invitación puedes aceptarla o rechazarla; quien organiza puede cancelarla dejando el motivo en el historial.',
        side: 'top',
      },
    }, commonToolsStep],
  },
  '/admin/recursos': {
    title: 'Recorrido de recursos internos',
    steps: [commonHeaderStep, {
      element: '[data-tour="resources-overview"]',
      popover: {
        title: 'Inventario con trazabilidad',
        description: 'El resumen distingue recursos, unidades disponibles, préstamos y solicitudes. Una solicitud no descuenta stock: la disponibilidad cambia únicamente cuando se confirma la entrega.',
        side: 'bottom',
      },
    }, {
      element: '[data-tour="resources-tabs"]',
      popover: {
        title: 'Catálogo, préstamos y solicitudes',
        description: 'Consulta el inventario y, según tus permisos, solicita recursos o administra entregas y devoluciones. Cada cuenta sin administración ve solamente sus propios préstamos y solicitudes; las decisiones y entregas generan avisos dentro de la aplicación.',
        side: 'bottom',
      },
    }, {
      element: '[data-tour="resources-catalog"]',
      popover: {
        title: 'Disponibilidad comprobada',
        description: 'Busca por nombre, código o categoría. Al agregar o editar un recurso puedes elegir una categoría institucional sugerida o escribir una propia. Al registrar una entrega, el sistema bloquea el recurso y vuelve a comprobar el stock para impedir cantidades negativas o préstamos simultáneos incompatibles.',
        side: 'top',
      },
    }, commonToolsStep],
  },
  '/scanner': {
    title: 'Recorrido del lector',
    steps: [{
      element: '[data-tour="scanner-status"]',
      popover: {
        title: 'Elige cómo registrar',
        description: 'Puedes utilizar la pistola conectada, la cámara del dispositivo o la búsqueda manual, según tus permisos. Ante un corte, la bandeja del dispositivo separa ingresos pendientes, sincronizados y con error, y permite reintentar sin duplicarlos. Si el almacenamiento local falla, la pantalla lo distingue de una bandeja vacía y bloquea nuevos registros offline.',
        side: 'bottom',
      },
    }, {
      element: '[data-tour="scanner-input"]',
      popover: {
        title: 'Registrar una persona',
        description: 'La pistola registra al leer el carnet. En búsqueda manual escribe el nombre o cualquier identificador disponible.',
        side: 'bottom',
      },
    }, {
      element: '[data-tour="scanner-summary"]',
      popover: {
        title: 'Resumen de la jornada',
        description: 'Consulta la cantidad de ingresos procesados y los atrasos detectados.',
        side: 'top',
      },
    }, commonToolsStep],
  },
  '/': {
    title: 'Recorrido del lector',
    steps: [{
      element: '[data-tour="scanner-status"]',
      popover: {
        title: 'Elige cómo registrar',
        description: 'Puedes utilizar la pistola conectada, la cámara del dispositivo o la búsqueda manual, según tus permisos. Ante un corte, la bandeja del dispositivo separa ingresos pendientes, sincronizados y con error, y permite reintentar sin duplicarlos. Si el almacenamiento local falla, la pantalla lo distingue de una bandeja vacía y bloquea nuevos registros offline.',
        side: 'bottom',
      },
    }, {
      element: '[data-tour="scanner-input"]',
      popover: {
        title: 'Registrar una persona',
        description: 'La pistola registra al leer el carnet. En búsqueda manual escribe el nombre o cualquier identificador disponible.',
        side: 'bottom',
      },
    }, {
      element: '[data-tour="scanner-summary"]',
      popover: {
        title: 'Resumen de la jornada',
        description: 'Consulta la cantidad de ingresos procesados y los atrasos detectados.',
        side: 'top',
      },
    }, commonToolsStep],
  },
};

export const getTourForPath = (pathname) => {
  if (/^\/admin\/usuarios\/[^/]+$/.test(pathname)) return profileDetailTour;
  if (/^\/admin\/convivencia\/\d+$/.test(pathname)) return {
    title: 'Recorrido del caso de convivencia',
    steps: [{
      element: '[data-tour="page-header"]',
      popover: {
        title: 'Ficha reservada del caso',
        description: 'El encabezado identifica el código, categoría, prioridad y estado sin sacar información del entorno protegido.',
        side: 'bottom',
      },
    }, {
      element: '[data-tour="coexistence-actions"]',
      popover: {
        title: 'Acciones y coordinación',
        description: 'Según tus permisos puedes coordinar por chat, editar la ficha, registrar actuaciones, adjuntar documentos o cerrar y reabrir el caso. Cada cambio queda trazado sin copiar relatos sensibles en la auditoría general.',
        side: 'bottom',
      },
    }, {
      element: '[data-tour="coexistence-facts"]',
      popover: {
        title: 'Responsabilidad y próxima revisión',
        description: 'Aquí se muestran la cuenta responsable, la próxima revisión, las personas vinculadas y la actividad. Estos datos determinan cuándo corresponde emitir un aviso automático.',
        side: 'bottom',
      },
    }, {
      element: '[data-tour="coexistence-timeline"]',
      popover: {
        title: 'Historial del caso',
        description: 'Registra medidas, entrevistas, mediaciones, acuerdos, seguimientos, derivaciones y revisiones en orden cronológico. Una nueva fecha de revisión reemplaza el vencimiento anterior.',
        side: 'top',
      },
    }, {
      element: '[data-tour="coexistence-protected-data"]',
      popover: {
        title: 'Personas y documentos protegidos',
        description: 'Las personas vinculadas y los archivos permanecen dentro del caso. La descarga exige permiso específico y deja trazabilidad institucional.',
        side: 'left',
      },
    }, commonToolsStep],
  };
  if (/^\/admin\/documentos\/estudiante\/\d+$/.test(pathname)) return {
    title: 'Recorrido del expediente documental',
    steps: [commonHeaderStep, {
      element: '[data-tour="documents-student-file"]',
      popover: {
        title: 'Ficha documental del estudiante',
        description: 'Consulta la identidad, coordina por chat, incorpora archivos protegidos o genera un PDF pendiente de revisión desde una plantilla institucional.',
        side: 'bottom',
      },
    }, {
      element: '[data-tour="documents-file-summary"]',
      popover: {
        title: 'Resumen del expediente',
        description: 'Muestra documentos, vigencias y todas las versiones conservadas sin sobrescribir archivos anteriores.',
        side: 'bottom',
      },
    }, commonToolsStep],
  };
  if (/^\/admin\/documentos\/ficha\/\d+$/.test(pathname)) return {
    title: 'Recorrido de la ficha documental',
    steps: [commonHeaderStep, {
      element: '[data-tour="documents-detail"]',
      popover: {
        title: 'Metadatos y vigencia',
        description: 'Revisa la categoría, el nivel de acceso, la vigencia y el estado institucional del documento.',
        side: 'bottom',
      },
    }, {
      element: '[data-tour="documents-versions"]',
      popover: {
        title: 'Versiones, OCR y firmas',
        description: 'Cada archivo conserva su huella digital. El OCR requiere revisión humana y las firmas internas quedan asociadas a una versión exacta.',
        side: 'top',
      },
    }, commonToolsStep],
  };
  if (/^\/admin\/seguimiento\/\d+$/.test(pathname)) return {
    title: 'Recorrido del caso de seguimiento',
    steps: [commonHeaderStep, {
      element: '[data-tour="follow-detail"]',
      popover: {
        title: 'Historia completa del caso',
        description: 'Consulta el motivo, la prioridad, el antecedente exacto y la línea de tiempo. Desde aquí puedes volver al registro de origen, coordinar por chat, notificar al responsable y registrar notas, tareas, contactos o acuerdos antes de cerrar o escalar.',
        side: 'top',
      },
    }, commonToolsStep],
  };
  if (/^\/chat\/\d+$/.test(pathname)) return tours['/chat'];
  if (/^\/directorio\/\d+$/.test(pathname)) return {
    title: 'Recorrido del perfil institucional',
    steps: [commonHeaderStep, {
      element: '[data-tour="staff-profile-hero"]',
      popover: {
        title: 'Ficha del equipo',
        description: 'Consulta cargo, area, disponibilidad y contacto interno sin ver configuraciones tecnicas de permisos.',
        side: 'bottom',
      },
    }, commonToolsStep],
  };
  return tours[pathname] || {
    title: 'Ayuda de esta página',
    steps: [commonHeaderStep, commonToolsStep],
  };
};
