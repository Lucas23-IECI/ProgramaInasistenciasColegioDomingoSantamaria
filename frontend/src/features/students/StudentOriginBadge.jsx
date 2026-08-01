import { studentOriginMeta } from './studentUtils';

export function StudentOriginBadge({ student }) {
  const meta = studentOriginMeta(student);
  return (
    <span className={`student-origin-badge student-origin-badge--${meta.code}`} title={meta.title}>
      {meta.label}
    </span>
  );
}
