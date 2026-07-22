import { CircleHelp, ShieldCheck, UsersRound } from 'lucide-react';

// Cambia este identificador cada vez que una actualización deba anunciarse al iniciar.
export const CURRENT_RELEASE = {
  id: '2026.07.22-accesos-auditoria-v2',
  label: 'Actualización de julio 2026',
  date: '22 de julio de 2026',
  title: 'Perfiles, cuentas y trazabilidad',
  summary: 'La administración de accesos ahora es más clara, configurable y segura.',
  sections: [
    {
      icon: UsersRound,
      title: 'Usuarios y permisos',
      description: 'Los perfiles agrupan sus cuentas y cada persona puede conservar permisos personalizados.',
    },
    {
      icon: ShieldCheck,
      title: 'Eliminación y auditoría',
      description: 'La actividad individual parte con los últimos 30 días y separa lo que hizo la cuenta de los cambios administrativos sobre ella.',
    },
    {
      icon: CircleHelp,
      title: 'Ayuda contextual',
      description: 'Los recorridos explican el catálogo de perfiles, las cuentas y la auditoría paso a paso.',
    },
  ],
};
