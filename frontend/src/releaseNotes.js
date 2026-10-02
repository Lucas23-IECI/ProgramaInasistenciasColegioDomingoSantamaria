import { BarChart3, BellRing, ClipboardList, ContactRound, FolderArchive, HeartHandshake, Image, MessageCircle, ScanText, ShieldCheck, UserRound, UsersRound, Wifi } from 'lucide-react';
import { PERMISSIONS } from './permissions';

// Cambia este identificador cada vez que una actualización deba anunciarse al iniciar.
export const CURRENT_RELEASE = {
  id: '2026.10.01-alta-manual-chat-v1',
  label: 'Actualización de octubre 2026',
  date: '1 de octubre de 2026',
  title: 'Novedades para tu trabajo diario',
  summary: 'Esta actualización corrige los selectores al agregar estudiantes, conserva el curso desde el que abriste el formulario y mejora el chat interno. También incluye mejoras de estadísticas, reportes, notificaciones y continuidad de Portería.',
  chatHighlight: {
    title: 'Chat interno para tu equipo',
    description: 'Escribe a tus compañeros y coordina el trabajo sin salir del sistema. No necesitas instalar otra aplicación.',
    location: 'Lo encuentras en el icono de conversación de la esquina superior derecha.',
    action: 'Abrir chat interno',
  },
  sections: [
    {
      icon: UsersRound,
      title: 'Corrección del alta manual de estudiantes',
      permission: PERMISSIONS.STUDENTS_MANAGE,
      description: 'Los cursos y motivos se despliegan por encima del formulario. El curso de origen queda seleccionado y, si falla la carga, se muestra la causa y se permite reintentar. Se conservan las validaciones, los registros existentes y la auditoría.',
    },
    {
      icon: UserRound,
      title: 'Mi perfil',
      description: 'Actualiza nombre mostrado, descripción, disponibilidad, ubicación y contacto institucional desde el menú de usuario.',
    },
    {
      icon: Image,
      title: 'Foto y portada con editor visual',
      description: 'Sube o vuelve a encuadrar imágenes guardadas con arrastre, zoom, rotación y previsualización exacta antes de guardar.',
    },
    {
      icon: UsersRound,
      title: 'Directorio interno',
      description: 'Encuentra al personal por nombre, cargo o área y consulta su disponibilidad sin mostrar configuraciones técnicas.',
    },
    {
      icon: ContactRound,
      title: 'Contacto institucional',
      description: 'Cada persona decide si comparte su ubicación, anexo, teléfono y horario con quienes pueden consultar el directorio.',
    },
    {
      icon: ShieldCheck,
      title: 'Perfiles de acceso administrables',
      description: 'Edita, consulta actividad, desactiva, reactiva o elimina perfiles cuando sea seguro. Administrador permanece protegido.',
    },
    {
      icon: HeartHandshake,
      title: 'Convivencia escolar protegida',
      description: 'Registra situaciones, personas, medidas, entrevistas, mediaciones, acuerdos, seguimientos, derivaciones, documentos y cierres con permisos explícitos.',
    },
    {
      icon: FolderArchive,
      title: 'Expediente documental por estudiante',
      description: 'Conserva certificados, justificaciones, autorizaciones, actas y antecedentes con vigencia, responsable e historial de versiones.',
    },
    {
      icon: ScanText,
      title: 'PDF, OCR y revisión humana',
      description: 'Genera documentos desde plantillas institucionales y extrae texto de imágenes mediante OCR local antes de una aprobación humana obligatoria.',
    },
    {
      icon: BarChart3,
      title: 'Analítica institucional explicable',
      description: 'Compara períodos, cursos y bloques horarios; muestra mejoras, retiros, visitas, convivencia y carga de trabajo con reglas visibles y exportación PDF o Excel.',
    },
    {
      icon: Wifi,
      title: 'Aplicación instalable y continuidad de Portería',
      description: 'Puede instalarse con el escudo oficial, avisa cuando existe una nueva versión y muestra una bandeja con ingresos pendientes, fallidos y sincronizados, incluido el reintento seguro sin duplicarlos.',
    },
    {
      icon: ClipboardList,
      title: 'Seguimiento institucional',
      description: 'Coordina casos preventivos con responsables, prioridades, plazos, tareas, notas, contactos, acuerdos, documentos y una línea de tiempo auditable.',
    },
    {
      icon: MessageCircle,
      title: 'Chat interno vinculado al trabajo',
      permission: PERMISSIONS.CHAT_ACCESS,
      description: 'Usa el chat completo o flotante sin perder el borrador. Incluye fotos con visor, administración de grupos, fondos personales y un editor compacto adaptable a celular; conserva menciones, urgencia, fijados y adjuntos.',
    },
    {
      icon: BellRing,
      title: 'Notificaciones dirigidas al equipo',
      description: 'Dirección puede enviar avisos a personas seleccionadas. Cada destinatario los ve dentro de la aplicación y puede habilitar avisos del navegador cuando el sistema usa HTTPS.',
    },
  ],
};
