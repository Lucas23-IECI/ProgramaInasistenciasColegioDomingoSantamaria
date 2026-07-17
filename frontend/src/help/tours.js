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
          description: 'Selecciona una función para registrar atrasos, consultar personas, revisar indicadores o administrar el sistema.',
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
      element: '[data-tour="users-list"]',
      popover: {
        title: 'Cuentas del sistema',
        description: 'Crea cuentas individuales, asigna roles y administra accesos autorizados.',
        side: 'top',
      },
    }, commonToolsStep],
  },
  '/admin/auditoria': {
    title: 'Recorrido de auditoría',
    steps: [commonHeaderStep, {
      element: '[data-tour="audit-filters"]',
      popover: {
        title: 'Búsqueda de actividad',
        description: 'Filtra los eventos por persona, acción y período.',
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
        title: 'Reglas institucionales',
        description: 'Define la hora de entrada, el inicio del atraso, la severidad y los umbrales preventivos. Cada cambio queda auditado.',
        side: 'top',
      },
    }, commonToolsStep],
  },
  '/scanner': {
    title: 'Recorrido del lector',
    steps: [{
      element: '[data-tour="scanner-status"]',
      popover: {
        title: 'Estado del lector',
        description: 'Confirma el horario vigente y si el lector está disponible para registrar ingresos.',
        side: 'bottom',
      },
    }, {
      element: '[data-tour="scanner-input"]',
      popover: {
        title: 'Registrar una persona',
        description: 'Escanea el código del carnet o utiliza la búsqueda manual por nombre o RUT.',
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

export const getTourForPath = (pathname) => tours[pathname] || {
  title: 'Ayuda de esta página',
  steps: [commonHeaderStep, commonToolsStep],
};
