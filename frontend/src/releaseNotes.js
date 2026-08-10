import { BarChart3, ClipboardList, ContactRound, FolderArchive, HeartHandshake, Image, MessageCircle, ScanText, ShieldCheck, UserRound, UsersRound, Wifi } from 'lucide-react';

// Cambia este identificador cada vez que una actualización deba anunciarse al iniciar.
export const CURRENT_RELEASE = {
  id: '2026.08.09-seguimiento-chat-v1',
  label: 'Actualización de agosto 2026',
  date: '9 de agosto de 2026',
  title: 'Gestión institucional, analítica y operación resiliente',
  summary: 'El sistema incorpora seguimiento institucional coordinado, chat interno vinculado al trabajo, perfiles personales, convivencia protegida, expedientes documentales y operación resiliente.',
  sections: [
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
      description: 'Puede instalarse con el escudo oficial en computador o celular, avisa cuando existe una nueva versión y permite encolar temporalmente registros de puntualidad durante cortes breves sin duplicarlos.',
    },
    {
      icon: ClipboardList,
      title: 'Seguimiento institucional',
      description: 'Coordina casos preventivos con responsables, prioridades, plazos, tareas, notas, contactos, acuerdos, documentos y una línea de tiempo auditable.',
    },
    {
      icon: MessageCircle,
      title: 'Chat interno vinculado al trabajo',
      description: 'Crea conversaciones directas, grupos y canales; menciona al equipo, fija antecedentes, envía mensajes urgentes y reutiliza la conversación asociada a cada seguimiento.',
    },
  ],
};
