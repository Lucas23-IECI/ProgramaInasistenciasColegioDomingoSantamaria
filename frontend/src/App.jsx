import React, { useState, useEffect, useContext } from 'react';
import { AuthContext } from './context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Clock, LogOut, Maximize2, Minimize2 } from 'lucide-react';
import BarcodeScanner from './components/BarcodeScanner';
import InstitutionalMark from './components/InstitutionalMark';

function formatClock() {
  const now = new Date();
  return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function App() {
  const { logout } = useContext(AuthContext);
  const navigate = useNavigate();
  const [clockTime, setClockTime] = useState(formatClock());
  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement);
  const [tipoRegistro] = useState('Entrada'); // Entrada / Salida

  useEffect(() => {
    const interval = setInterval(() => setClockTime(formatClock()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  return (
    <div className="kiosk-mode kiosk-asistencia">
      <div className="kiosk-panel">
        <div className="kiosk-panel-inner">

          <header className="kiosk-header">
            <div className="kiosk-title-group">
              <InstitutionalMark inverse />
              <div className="kiosk-divider" />
              <div>
                <span className="kiosk-eyebrow">Asistencia escolar</span>
                <h1>Terminal de registro</h1>
                <div className="kiosk-context-subtitle">Entrada de estudiantes y personal</div>
              </div>
            </div>

            <div className="kiosk-header-right">
              <div className="kiosk-clock">
                <Clock size={16} />
                <span>{clockTime}</span>
              </div>
              <button
                type="button"
                onClick={toggleFullscreen}
                className="kiosk-logout-btn"
                title={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
              >
                {isFullscreen ? <Minimize2 size={16}/> : <Maximize2 size={16}/>}
                <span>{isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}</span>
              </button>
              <button
                type="button"
                onClick={() => { logout(); navigate('/login'); }}
                className="kiosk-logout-btn"
                title="Cerrar sesión"
              >
                <LogOut size={16}/>
                <span>Cerrar sesión</span>
              </button>
            </div>
          </header>

          <BarcodeScanner tipoRegistro={tipoRegistro} />

        </div>
      </div>
    </div>
  );
}

export default App;
