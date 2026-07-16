import React, { useContext, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowRight, Lock, Mail, MapPin, ShieldCheck } from 'lucide-react';
import { AuthContext } from './context/AuthContext';
import InstitutionalMark from './components/InstitutionalMark';

const Login = () => {
  const [correo, setCorreo] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useContext(AuthContext);
  const navigate = useNavigate();

  const handleLogin = async (event) => {
    event.preventDefault();
    setErrorMsg('');
    setLoading(true);

    try {
      await login(correo, password);
      navigate('/');
    } catch (error) {
      setErrorMsg(error.response?.status === 401
        ? 'Las credenciales no son válidas.'
        : 'No fue posible conectar con el sistema. Intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <main className="login-shell">
        <section className="login-context" aria-label="Información institucional">
          <InstitutionalMark inverse />
          <div className="login-context__main">
            <span className="section-kicker">Plataforma institucional</span>
            <h1>Sistema de gestión de asistencia escolar</h1>
            <p>
              Registro, seguimiento y análisis de asistencia para la comunidad
              educativa del Liceo Domingo Santa María.
            </p>
          </div>
          <div className="login-context__status">
            <span className="system-status-dot" aria-hidden="true" />
            <div>
              <strong>Servicio disponible</strong>
              <small>Acceso seguro para personal autorizado</small>
            </div>
          </div>
        </section>

        <section className="login-card">
          <div className="login-card__location"><MapPin size={14} /> Concepción, Región del Biobío</div>
          <div className="login-header">
            <span className="section-kicker">Acceso al sistema</span>
            <h2 className="login-title">Iniciar sesión</h2>
            <p className="login-subtitle">Utiliza las credenciales asignadas por el establecimiento.</p>
          </div>

          {errorMsg && (
            <div className="login-error fade-in" role="alert">
              <AlertCircle size={18} />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="login-form">
            <label className="login-field">
              <span>Correo electrónico</span>
              <div className="login-input-wrapper">
                <Mail size={18} className="login-input-icon" />
                <input
                  type="email"
                  className="login-input"
                  placeholder="nombre@establecimiento.cl"
                  value={correo}
                  onChange={(event) => setCorreo(event.target.value)}
                  autoComplete="username"
                  required
                />
              </div>
            </label>

            <label className="login-field">
              <span>Contraseña</span>
              <div className="login-input-wrapper">
                <Lock size={18} className="login-input-icon" />
                <input
                  type="password"
                  className="login-input"
                  placeholder="Tu contraseña"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
            </label>

            <button type="submit" className="login-btn" disabled={loading}>
              <span>{loading ? 'Ingresando...' : 'Ingresar al sistema'}</span>
              {!loading && <ArrowRight size={18} />}
            </button>
          </form>

          <div className="login-card__footer">
            <span><ShieldCheck size={14} /> Conexión protegida</span>
            <span>RBD 4565-9</span>
          </div>
        </section>
      </main>
    </div>
  );
};

export default Login;
