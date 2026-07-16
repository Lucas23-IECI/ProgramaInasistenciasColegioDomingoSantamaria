export const QUESTIONNAIRES = {
  direccion: {
    label: 'Dirección',
    shortDescription: 'Definiciones institucionales, responsables y aprobación final.',
    estimatedMinutes: 7,
    questions: [
      {
        id: 'responsable_operacion_diaria',
        type: 'radio',
        required: true,
        label: '¿Qué unidad debe ser responsable de consolidar la asistencia diaria?',
        help: 'La unidad elegida revisará pendientes, resolverá excepciones y ejecutará el cierre.',
        options: ['Inspectoría General', 'Secretaría', 'UTP', 'Dirección', 'Responsabilidad compartida']
      },
      {
        id: 'modalidad_cierre',
        type: 'radio',
        required: true,
        label: '¿Cómo debe cerrarse oficialmente cada jornada?',
        help: 'El cierre es el momento desde el cual un estudiante sin registro podría pasar de pendiente a ausente.',
        options: ['Automáticamente a una hora definida', 'Manualmente por un responsable', 'Automático con revisión y confirmación manual']
      },
      {
        id: 'autoridad_correcciones',
        type: 'checkbox',
        required: true,
        label: '¿Qué cargos pueden corregir una jornada después de su cierre?',
        help: 'Toda corrección posterior quedará registrada en auditoría.',
        options: ['Dirección', 'Inspectoría General', 'Secretaría', 'UTP', 'Administrador técnico']
      },
      {
        id: 'estados_oficiales',
        type: 'checkbox',
        required: true,
        label: '¿Qué estados deben utilizarse oficialmente en el sistema?',
        help: 'La propuesta técnica mínima es: pendiente, presente, atrasado, ausente y justificado.',
        options: ['Pendiente', 'Presente', 'Atrasado', 'Ausente', 'Justificado', 'Retiro anticipado', 'Actividad institucional']
      },
      {
        id: 'aprobacion_politica',
        type: 'textarea',
        required: true,
        label: '¿Quién aprobará la política definitiva y cómo debe quedar respaldada?',
        placeholder: 'Ejemplo: aprobación de Dirección mediante acta, con revisión anual…',
        maxLength: 700
      }
    ]
  },
  inspectoria: {
    label: 'Inspectoría General',
    shortDescription: 'Horarios, atrasos, pendientes, cierre y correcciones operativas.',
    estimatedMinutes: 9,
    questions: [
      {
        id: 'horarios_ingreso',
        type: 'textarea',
        required: true,
        label: 'Indique los horarios oficiales de ingreso que utiliza el establecimiento.',
        help: 'Incluya diferencias por jornada, nivel o día de la semana, si existen.',
        placeholder: 'Ejemplo: jornada mañana 08:00; jornada tarde 13:30…',
        maxLength: 900
      },
      {
        id: 'regla_atraso',
        type: 'textarea',
        required: true,
        label: '¿Desde qué momento un ingreso se considera atraso y qué excepciones existen?',
        placeholder: 'Indique minutos de tolerancia, autorizaciones y casos excepcionales…',
        maxLength: 700
      },
      {
        id: 'hora_cierre_sugerida',
        type: 'time',
        required: true,
        label: '¿A qué hora sugiere consolidar y cerrar la jornada principal?',
        help: 'Antes de esta hora, un estudiante sin registro seguirá apareciendo como pendiente.'
      },
      {
        id: 'verificacion_sin_marcacion',
        type: 'textarea',
        required: true,
        label: '¿Cómo se verifica hoy a un estudiante que no registró ingreso?',
        placeholder: 'Ejemplo: consulta al profesor, revisión de libro de clases, llamado al curso…',
        maxLength: 800
      },
      {
        id: 'situaciones_especiales',
        type: 'checkbox',
        required: true,
        label: '¿Qué situaciones deben impedir que una falta de marcación se transforme en ausencia?',
        options: ['Actividad institucional', 'Salida pedagógica', 'Atención interna', 'Ingreso autorizado por otra dependencia', 'Jornada parcial', 'Suspensión de clases', 'Otra situación documentada']
      },
      {
        id: 'plazo_correccion',
        type: 'radio',
        required: true,
        label: '¿Hasta cuándo debería permitirse corregir una asistencia cerrada?',
        options: ['Hasta el final del mismo día', 'Hasta el siguiente día hábil', 'Durante la semana', 'Sin límite, siempre con motivo y auditoría']
      }
    ]
  },
  utp_sige: {
    label: 'UTP / Encargado SIGE',
    shortDescription: 'Calendario oficial, reglas de cálculo y conciliación con registros ministeriales.',
    estimatedMinutes: 7,
    questions: [
      {
        id: 'fuente_calendario',
        type: 'textarea',
        required: true,
        label: '¿Cuál es la fuente oficial del calendario escolar que debe usar el sistema?',
        help: 'Considere feriados, recuperaciones, suspensiones, interferiados y cambios excepcionales.',
        placeholder: 'Indique documento, plataforma o responsable que mantiene el calendario…',
        maxLength: 700
      },
      {
        id: 'regla_asistencia_oficial',
        type: 'textarea',
        required: true,
        label: '¿Qué registro define finalmente la asistencia oficial informada a SIGE?',
        placeholder: 'Explique qué ocurre si el lector, el libro de clases y SIGE no coinciden…',
        maxLength: 900
      },
      {
        id: 'efecto_justificacion',
        type: 'radio',
        required: true,
        label: 'Para estadísticas internas, ¿cómo debe tratarse una ausencia justificada?',
        options: ['Sigue siendo ausencia, pero se distingue como justificada', 'No debe contabilizarse como ausencia', 'Depende del tipo de justificación', 'Requiere validación normativa antes de decidir']
      },
      {
        id: 'periodicidad_conciliacion',
        type: 'radio',
        required: true,
        label: '¿Con qué frecuencia debe compararse el sistema con la fuente oficial?',
        options: ['Diariamente', 'Semanalmente', 'Mensualmente', 'Antes de cada cierre de período']
      },
      {
        id: 'reportes_requeridos',
        type: 'checkbox',
        required: true,
        label: '¿Qué reportes necesita revisar UTP?',
        options: ['Resumen diario', 'Por curso', 'Por estudiante', 'Diferencias con SIGE', 'Cambios posteriores al cierre', 'Tendencias y alertas tempranas']
      }
    ]
  },
  matricula: {
    label: 'Secretaría / Matrícula',
    shortDescription: 'Vigencia de matrícula, retiros, traslados y fuente maestra de estudiantes.',
    estimatedMinutes: 7,
    questions: [
      {
        id: 'fuente_matricula',
        type: 'radio',
        required: true,
        label: '¿Cuál debe ser la fuente maestra de estudiantes y cursos?',
        options: ['SIGE', 'Planilla institucional', 'Sistema ERP', 'Registro de Secretaría', 'Conciliación entre varias fuentes']
      },
      {
        id: 'fechas_vigencia',
        type: 'textarea',
        required: true,
        label: '¿Qué fechas se registran actualmente para matrículas, retiros y traslados?',
        help: 'Necesitamos saber desde qué día y hasta qué día un estudiante debe contarse en un curso.',
        placeholder: 'Describa las fechas disponibles y dónde se encuentran…',
        maxLength: 800
      },
      {
        id: 'cambio_curso',
        type: 'radio',
        required: true,
        label: 'Si un estudiante cambia de curso, ¿debe conservarse su historial en el curso anterior?',
        options: ['Sí, siempre', 'Solo dentro del año escolar', 'No, todo debe verse en el curso actual', 'Debe definirse caso a caso']
      },
      {
        id: 'actualizacion_retroactiva',
        type: 'textarea',
        required: true,
        label: '¿Cómo se resuelven retiros o matrículas informados con fecha retroactiva?',
        placeholder: 'Indique responsable, respaldo requerido y efecto esperado en estadísticas…',
        maxLength: 800
      },
      {
        id: 'frecuencia_sincronizacion',
        type: 'radio',
        required: true,
        label: '¿Con qué frecuencia debería actualizarse la matrícula en el sistema?',
        options: ['En cuanto se registra un cambio', 'Diariamente', 'Semanalmente', 'Mediante una carga manual cuando sea necesario']
      }
    ]
  },
  convivencia: {
    label: 'Convivencia Escolar',
    shortDescription: 'Alertas tempranas, responsables, contactos y cierre de seguimientos.',
    estimatedMinutes: 6,
    questions: [
      {
        id: 'umbrales_alerta',
        type: 'textarea',
        required: true,
        label: '¿Qué situaciones deberían generar una alerta temprana?',
        help: 'Puede considerar días consecutivos, porcentaje mensual, atrasos reiterados u otros patrones.',
        placeholder: 'Ejemplo: tres ausencias consecutivas o cinco atrasos durante el mes…',
        maxLength: 800
      },
      {
        id: 'efecto_justificadas_alerta',
        type: 'radio',
        required: true,
        label: '¿Las ausencias justificadas deben activar alertas de seguimiento?',
        options: ['Sí, con una prioridad distinta', 'No', 'Solo desde un umbral especial', 'Depende del tipo de justificación']
      },
      {
        id: 'responsables_seguimiento',
        type: 'checkbox',
        required: true,
        label: '¿Quiénes deberían recibir y gestionar las alertas?',
        options: ['Profesor jefe', 'Inspectoría', 'Convivencia Escolar', 'Dupla psicosocial', 'Dirección', 'Otro responsable designado']
      },
      {
        id: 'flujo_contacto',
        type: 'textarea',
        required: true,
        label: 'Describa el flujo esperado desde una alerta hasta el contacto con el apoderado.',
        placeholder: 'Indique quién contacta, plazo, medios permitidos y cómo se registra el resultado…',
        maxLength: 900
      },
      {
        id: 'cierre_seguimiento',
        type: 'textarea',
        required: true,
        label: '¿Qué condición permite cerrar una alerta o un seguimiento?',
        placeholder: 'Ejemplo: contacto realizado, entrevista, derivación, normalización de asistencia…',
        maxLength: 700
      }
    ]
  },
  informatica: {
    label: 'Administración técnica',
    shortDescription: 'Dominio, correo institucional, responsables técnicos y continuidad operativa.',
    estimatedMinutes: 6,
    questions: [
      {
        id: 'dominio_institucional',
        type: 'text',
        required: false,
        label: '¿El establecimiento posee un dominio web institucional?',
        placeholder: 'Ejemplo: liceodomingosantamaria.cl o “No disponible”',
        maxLength: 180
      },
      {
        id: 'correo_envio',
        type: 'text',
        required: false,
        label: '¿Qué correo institucional debería enviar notificaciones del sistema?',
        placeholder: 'Ejemplo: asistencia@dominio.cl',
        maxLength: 180
      },
      {
        id: 'responsables_tecnicos',
        type: 'textarea',
        required: true,
        label: '¿Quiénes estarán autorizados para administrar configuración, usuarios y respaldos?',
        help: 'No escriba contraseñas en este formulario.',
        placeholder: 'Indique cargos o responsables, sin incluir credenciales…',
        maxLength: 700
      },
      {
        id: 'continuidad',
        type: 'radio',
        required: true,
        label: 'Si falla Internet, ¿qué continuidad operativa necesita el establecimiento?',
        options: ['Registro local y sincronización posterior', 'Planilla manual y carga posterior', 'No se ha definido', 'Otra alternativa institucional']
      },
      {
        id: 'respaldo_retencion',
        type: 'textarea',
        required: true,
        label: '¿Dónde deberían conservarse los respaldos y por cuánto tiempo?',
        placeholder: 'Indique ubicación autorizada, responsables y retención esperada…',
        maxLength: 700
      }
    ]
  }
};

export const ROLE_OPTIONS = Object.entries(QUESTIONNAIRES).map(([value, item]) => ({
  value,
  label: item.label,
  description: item.shortDescription,
  estimatedMinutes: item.estimatedMinutes
}));

export function getQuestionnaire(role) {
  return QUESTIONNAIRES[role] || null;
}

export function getRequiredQuestionIds(role) {
  return (getQuestionnaire(role)?.questions || [])
    .filter((question) => question.required)
    .map((question) => question.id);
}
