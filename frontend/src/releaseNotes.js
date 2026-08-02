import { DoorOpen, FileSpreadsheet, FileText, ShieldCheck, UserPlus } from 'lucide-react';

// Cambia este identificador cada vez que una actualización deba anunciarse al iniciar.
export const CURRENT_RELEASE = {
  id: '2026.07.28-gobernanza-padron-v6',
  label: 'Actualización de julio 2026',
  date: '28 de julio de 2026',
  title: 'Padrón escolar verificable',
  summary: 'La matrícula manual y las importaciones ERP ahora se comparan, revisan y auditan antes de modificar el padrón institucional.',
  sections: [
    {
      icon: DoorOpen,
      title: 'Dos operaciones claras',
      description: 'La cuenta de Portería muestra solamente Registro de estudiantes y Visitas/retiros, con permisos fijos.',
    },
    {
      icon: FileSpreadsheet,
      title: 'Ficha de apoderados',
      description: 'Busca a una persona conocida por nombre o RUT y permite seleccionar a uno o varios hermanos vinculados.',
    },
    {
      icon: UserPlus,
      title: 'Gestión manual de estudiantes',
      description: 'Permite agregar, editar, retirar y reactivar matrículas individuales sin borrar historial ni crear cursos improvisados.',
    },
    {
      icon: FileSpreadsheet,
      title: 'Importación ERP controlada',
      description: 'Compara cada campo, distingue nóminas parciales y completas, bloquea colisiones UUID/RUT y exige confirmar reactivaciones.',
    },
    {
      icon: ShieldCheck,
      title: 'Calidad e historial del padrón',
      description: 'Reúne altas manuales pendientes, indicadores de calidad, historial por archivo y una herramienta auditada para unir duplicados.',
    },
    {
      icon: ShieldCheck,
      title: 'Retiros más seguros',
      description: 'Portería completa el retiro en el mismo puesto. Solo solicita validación adicional cuando la ficha no cubre a la persona o al estudiante.',
    },
    {
      icon: FileText,
      title: 'Reportes institucionales',
      description: 'Exporta visitas y retiros por período, además del padrón operativo, administrativo y sus casos de calidad. Los identificadores estudiantiles se incluyen completos.',
    },
  ],
};
