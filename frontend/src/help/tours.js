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
    description: 'Desde aquí puedes repetir esta ayuda, cambiar el tema visual y administrar tu sesión.',
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
        description: 'Busca por nombre, cargo o area institucional. Solo se muestran cuentas activas y perfiles visibles.',
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
          description: 'Busca registros y abre Gestionar para corregir, justificar, anular o revisar su historial.',
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
          description: 'Cambia entre nómina, carga ERP, apoderados y control del padrón. Las importaciones nunca crean cuentas de acceso.',
          side: 'bottom',
        },
      },
      {
        element: '[data-tour="student-manual-create"]',
        popover: {
          title: 'Gestión manual',
          description: 'Agrega una matrícula individual sin importar otra planilla. Desde cada ficha también puedes editar, retirar o reactivar al estudiante con trazabilidad.',
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
          description: 'Revisa calidad, altas manuales, historial y duplicados. Desde el encabezado puedes exportar el padrón operativo, administrativo o sus casos de calidad.',
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
        title: 'Filtros del análisis',
        description: 'Ajusta el período, curso y clasificación para actualizar todos los indicadores.',
        side: 'bottom',
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
        description: 'Pulsa cualquier parte de una tarjeta para revisar sus cuentas, permisos recomendados y opciones de administración.',
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
        description: 'La consulta parte con los últimos 30 días. Puedes cambiar el período y, al revisar una cuenta, separar lo que hizo de los cambios administrativos aplicados sobre ella.',
        side: 'bottom',
      },
    }, {
      element: '[data-tour="audit-list"]',
      popover: {
        title: 'Registro de actividad',
        description: 'Cada fila conserva quién realizó la acción, cuándo ocurrió y qué entidad fue afectada.',
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
        description: 'Aquí defines el nombre de la jornada y cuándo se activan las alertas por atrasos reiterados.',
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
        description: 'Cada indicador es interactivo: abre directamente las personas dentro, los movimientos del día o los retiros registrados.',
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
        description: 'Registra la salida desde esta lista. El sistema conserva la hora, la cuenta responsable y la trazabilidad.',
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
    steps: [commonHeaderStep, {
      element: '[data-tour="coexistence-summary"]',
      popover: {
        title: 'Situacion protegida de los casos',
        description: 'Los indicadores abren los casos activos, urgentes o con revisión pendiente sin exponer antecedentes a perfiles no autorizados.',
        side: 'bottom',
      },
    }, {
      element: '[data-tour="coexistence-cases"]',
      popover: {
        title: 'Bandeja institucional',
        description: 'Busca y filtra casos por estado o prioridad. Solo las cuentas con permisos explícitos pueden consultar esta información.',
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
        description: 'Revisa documentos activos, vencimientos, propuestas OCR pendientes y versiones que todavía no tienen firma interna.',
        side: 'bottom',
      },
    }, {
      element: '[data-tour="documents-student-search"]',
      popover: {
        title: 'Expediente por estudiante',
        description: 'Busca a una persona para consultar, incorporar o generar documentos dentro de su expediente protegido.',
        side: 'bottom',
      },
    }, {
      element: '[data-tour="documents-list"]',
      popover: {
        title: 'Consulta transversal',
        description: 'Filtra los documentos registrados por estudiante, título, categoría, estado o vencimiento.',
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
        description: 'Resume las tareas visibles y confirma si el respaldo diario sigue vigente.',
        side: 'bottom',
      },
    }, {
      element: '[data-tour="operations-list"]',
      popover: {
        title: 'Pendientes accionables',
        description: 'Cada fila muestra una responsabilidad concreta y abre directamente el módulo donde se resuelve.',
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
        description: 'Busca conversaciones o mensajes y crea comunicaciones directas, grupales o vinculadas al trabajo según tus permisos.',
        side: 'right',
      },
    }, {
      element: '[data-tour="chat-thread"]',
      popover: {
        title: 'Coordinación con trazabilidad',
        description: 'Envía mensajes, menciona integrantes, fija antecedentes relevantes y ajusta tus notificaciones sin usar cuentas personales.',
        side: 'left',
      },
    }, commonToolsStep],
  },
  '/scanner': {
    title: 'Recorrido del lector',
    steps: [{
      element: '[data-tour="scanner-status"]',
      popover: {
        title: 'Elige cómo registrar',
        description: 'Puedes utilizar la pistola conectada, la cámara del dispositivo o la búsqueda manual, según los permisos de tu cuenta.',
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
        description: 'Puedes utilizar la pistola conectada, la cámara del dispositivo o la búsqueda manual, según los permisos de tu cuenta.',
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
    steps: [commonHeaderStep, {
      element: '[data-tour="coexistence-actions"]',
      popover: {
        title: 'Acciones controladas',
        description: 'Edita, cierra o reabre el caso según tus permisos. Cada cambio queda trazado sin copiar relatos sensibles en la auditoría general.',
        side: 'bottom',
      },
    }, {
      element: '[data-tour="coexistence-timeline"]',
      popover: {
        title: 'Historial del caso',
        description: 'Registra medidas, entrevistas, mediaciones, acuerdos, seguimientos, derivaciones y revisiones en orden cronologico.',
        side: 'top',
      },
    }, commonToolsStep],
  };
  if (/^\/admin\/documentos\/estudiante\/\d+$/.test(pathname)) return {
    title: 'Recorrido del expediente documental',
    steps: [commonHeaderStep, {
      element: '[data-tour="documents-student-file"]',
      popover: {
        title: 'Ficha documental del estudiante',
        description: 'Consulta la identidad, incorpora archivos protegidos o genera un PDF desde una plantilla institucional.',
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
        description: 'Consulta el motivo, la prioridad y la línea de tiempo; registra notas, tareas, contactos y acuerdos antes de cerrar o escalar el seguimiento.',
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
