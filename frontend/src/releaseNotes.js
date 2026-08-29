import { BarChart3, BellRing, ClipboardList, ContactRound, FolderArchive, HeartHandshake, Image, MessageCircle, ScanText, ShieldCheck, UserRound, UsersRound, Wifi } from 'lucide-react';

// Cambia este identificador cada vez que una actualización deba anunciarse al iniciar.
export const CURRENT_RELEASE = {
  id: '2026.08.28-cierre-operativo-v1',
  label: 'Actualización de agosto 2026',
  date: '28 de agosto de 2026',
  title: 'Analítica, alertas y continuidad verificables',
  summary: 'El sistema conecta la analítica con sus registros, conserva reportes descargables, amplía alertas y notificaciones auditables, y permite revisar la cola segura de Portería durante cortes de conexión.',
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
      description: 'Crea conversaciones directas, grupos y canales; separa mensajes por día, muestra mejor los no leídos y guarda cada adjunto junto con su mensaje para evitar registros incompletos.',
    },
    {
      icon: BellRing,
      title: 'Notificaciones dirigidas al equipo',
      description: 'Dirección puede enviar avisos a personas seleccionadas. Cada destinatario los ve dentro de la aplicación y puede habilitar avisos del navegador cuando el sistema usa HTTPS.',
    },
  ],
};
