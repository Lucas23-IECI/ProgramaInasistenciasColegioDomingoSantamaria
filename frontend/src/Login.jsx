import React, { useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from './context/AuthContext';
import { AlertCircle, Mail, Lock, ShieldCheck } from 'lucide-react';
import './index.css';

const Login = () => {
  const [correo, setCorreo] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useContext(AuthContext);
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setLoading(true);

    try {
      await login(correo, password);
      navigate('/');
    } catch (err) {
      if (err.response && err.response.status === 401) {
        setErrorMsg('Credenciales inválidas');
      } else {
        setErrorMsg('Error de red. Intenta más tarde.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        {/* Hero logo — full width */}
        <div className="login-hero" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '24px 0', background: 'rgba(59,130,246,0.05)' }}>
          <ShieldCheck size={72} style={{ color: '#3b82f6', filter: 'drop-shadow(0 0 12px rgba(59,130,246,0.35))' }} />
        </div>

        <div className="login-header">
          <h1 className="login-title">Registro de Atrasos</h1>
          <h2 className="login-title-accent">Liceo Domingo Santa María</h2>
        </div>

        {errorMsg && (
          <div className="login-error fade-in">
            <AlertCircle size={18} />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className="login-form">
          <div className="login-input-wrapper">
            <Mail size={18} className="login-input-icon" />
            <input
              type="email"
              className="login-input"
              placeholder="Correo electrónico"
              value={correo}
              onChange={(e) => setCorreo(e.target.value)}
              required
            />
          </div>
          <div className="login-input-wrapper">
            <Lock size={18} className="login-input-icon" />
            <input
              type="password"
              className="login-input"
              placeholder="Contraseña"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button type="submit" className="login-btn" disabled={loading}>
            {loading ? 'Ingresando...' : 'Iniciar Sesión'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Login;
