import React, { useContext, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowRight, CheckCircle2, KeyRound, LockKeyhole, LogOut, ShieldCheck } from 'lucide-react';
import { AuthContext } from './context/AuthContext';
import InstitutionalMark from './components/InstitutionalMark';

const PASSWORD_RULES = [
  { label: '12 caracteres como mínimo', test: (value) => value.length >= 12 },
  { label: 'Una letra mayúscula', test: (value) => /[A-ZÁÉÍÓÚÑ]/.test(value) },
  { label: 'Una letra minúscula', test: (value) => /[a-záéíóúñ]/.test(value) },
  { label: 'Al menos un número', test: (value) => /\d/.test(value) }
];

const ChangePassword = () => {
  const { user, changePassword, logout } = useContext(AuthContext);
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const rulesPass = PASSWORD_RULES.every((rule) => rule.test(newPassword));
  const matches = newPassword && newPassword === confirmation;

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    if (!rulesPass) return setError('La nueva contraseña todavía no cumple todos los requisitos.');
    if (!matches) return setError('La confirmación no coincide con la nueva contraseña.');

    setSaving(true);
    try {
      await changePassword(currentPassword, newPassword);
      navigate('/', { replace: true });
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'No fue posible actualizar la contraseña.');
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="password-page">
      <main className="password-shell">
        <aside className="password-context">
          <InstitutionalMark inverse />
          <div>
            <span className="section-kicker">Protección de la cuenta</span>
            <h1>Define una contraseña personal</h1>
            <p>
              La clave entregada por administración es temporal. Debes reemplazarla antes de utilizar
              los módulos institucionales.
            </p>
          </div>
          <div className="password-context__identity">
            <ShieldCheck size={18} />
            <span><small>Cuenta protegida</small><strong>{user?.correo}</strong></span>
          </div>
        </aside>

        <section className="password-card">
          <div className="password-card__icon"><KeyRound size={24} /></div>
          <span className="section-kicker">Cambio obligatorio</span>
          <h2>Crear nueva contraseña</h2>
          <p className="password-card__lead">Usa una clave exclusiva que no compartas con otras personas.</p>

          {error && <div className="password-error" role="alert"><AlertCircle size={18} /><span>{error}</span></div>}

          <form className="password-form" onSubmit={handleSubmit}>
            <label>
              <span>Contraseña temporal o actual</span>
              <div className="password-input-wrap"><LockKeyhole size={18} /><input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" required /></div>
            </label>
            <label>
              <span>Nueva contraseña</span>
              <div className="password-input-wrap"><KeyRound size={18} /><input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" required /></div>
            </label>
            <label>
              <span>Confirmar nueva contraseña</span>
              <div className="password-input-wrap"><CheckCircle2 size={18} /><input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" required /></div>
            </label>

            <div className="password-rules" aria-label="Requisitos de contraseña">
              {PASSWORD_RULES.map((rule) => {
                const passed = rule.test(newPassword);
                return <span key={rule.label} data-passed={passed}><CheckCircle2 size={15} /> {rule.label}</span>;
              })}
              <span data-passed={Boolean(matches)}><CheckCircle2 size={15} /> La confirmación coincide</span>
            </div>

            <button className="password-submit" type="submit" disabled={saving || !rulesPass || !matches}>
              {saving ? 'Guardando cambio…' : 'Guardar y continuar'} {!saving && <ArrowRight size={18} />}
            </button>
          </form>

          <button className="password-logout" type="button" onClick={handleLogout}><LogOut size={16} /> Cerrar sesión</button>
        </section>
      </main>
    </div>
  );
};

export default ChangePassword;
