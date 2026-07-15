import React, { useState, useEffect, useContext } from 'react';
import { AuthContext } from './context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Clock, LogOut, ShieldCheck, LogIn, Maximize2, Minimize2 } from 'lucide-react';
import BarcodeScanner from './components/BarcodeScanner';
import './index.css';

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
              <div className="kiosk-logo-wrapper">
                <ShieldCheck size={38} className="text-blue-500" style={{ color: '#3b82f6' }} />
              </div>
              <div className="kiosk-divider" />
              <div>
                <h1>Registro de Atrasos</h1>
                <div className="kiosk-meal-subtitle" style={{ color: '#94a3b8' }}>
                  Liceo Domingo Santa María
                </div>
              </div>
            </div>

            <div className="kiosk-header-right">
              <div className="kiosk-clock" style={{ fontFamily: 'Space Mono, monospace' }}>
                <Clock size={16} />
                <span>{clockTime}</span>
              </div>
              <button
                onClick={toggleFullscreen}
                className="kiosk-logout-btn"
                title={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
              >
                {isFullscreen ? <Minimize2 size={16}/> : <Maximize2 size={16}/>}
              </button>
              <button
                onClick={() => { logout(); navigate('/login'); }}
                className="kiosk-logout-btn"
                title="Cerrar sesión"
              >
                <LogOut size={16}/>
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
