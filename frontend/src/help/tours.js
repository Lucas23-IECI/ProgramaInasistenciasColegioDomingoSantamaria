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
      description: 'Edita la recomendación general o crea una cuenta personal asociada a este perfil.',
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
  return tours[pathname] || {
    title: 'Ayuda de esta página',
    steps: [commonHeaderStep, commonToolsStep],
  };
};
