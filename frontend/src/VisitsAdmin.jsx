import { useContext } from 'react';
import PorteriaWorkspace from './PorteriaWorkspace';
import { AuthContext } from './context/AuthContext';
import { useVisitsController } from './features/visits/useVisitsController';
import { VisitsView } from './features/visits/VisitsView';

const VisitsManagement = () => {
  const controller = useVisitsController();
  return <VisitsView {...controller} />;
};

const VisitsAdmin = () => {
  const { user } = useContext(AuthContext);
  return user?.rol === 'lector' ? <PorteriaWorkspace /> : <VisitsManagement />;
};

export default VisitsAdmin;
