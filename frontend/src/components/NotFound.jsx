import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const NotFound = () => {
  const navigate = useNavigate();
  return (
    <main className="not-found">
      <span>Error 404</span>
      <h1>La sección solicitada no existe</h1>
      <p>Regresa al panel principal para continuar trabajando.</p>
      <button type="button" onClick={() => navigate('/')}>
        <ArrowLeft size={18} /> Volver al inicio
      </button>
    </main>
  );
};

export default NotFound;

