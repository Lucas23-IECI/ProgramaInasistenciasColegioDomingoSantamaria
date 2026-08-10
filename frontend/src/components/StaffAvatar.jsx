import { UserRound } from 'lucide-react';
import { resolveApiAssetUrl } from '../utils/apiAssetUrl';

const StaffAvatar = ({ profile, name, size = 'md', className = '' }) => {
  const imageUrl = resolveApiAssetUrl(profile?.avatar_url);
  const shared = profile?.cuenta_compartida === true;
  const accessibleName = name || profile?.nombre_mostrado || 'Personal institucional';

  return (
    <span className={`staff-avatar staff-avatar--${size} ${className}`.trim()} data-shared={shared || undefined}>
      {imageUrl ? (
        <img src={imageUrl} alt={`Foto de ${accessibleName}`} />
      ) : shared ? (
        <img src="/institucional/escudo-ldsm-concepcion.jpg" alt="Escudo del Liceo Domingo Santa Maria" />
      ) : (
        <UserRound aria-label={`Perfil sin foto de ${accessibleName}`} />
      )}
    </span>
  );
};

export default StaffAvatar;
