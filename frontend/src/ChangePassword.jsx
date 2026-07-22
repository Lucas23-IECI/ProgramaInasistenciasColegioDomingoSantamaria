import React, { useContext, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowRight, CheckCircle2, Eye, EyeOff, KeyRound, LockKeyhole, LogOut, ShieldCheck } from 'lucide-react';
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
  const [visibleFields, setVisibleFields] = useState({ current: false, next: false, confirmation: false });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const rulesPass = PASSWORD_RULES.every((rule) => rule.test(newPassword));
  const matches = newPassword && newPassword === confirmation;

  const toggleVisibility = (field) => {
    setVisibleFields((current) => ({ ...current, [field]: !current[field] }));
  };

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
            <div className="password-field">
              <label htmlFor="current-password">Contraseña temporal o actual</label>
              <div className="password-input-wrap">
                <LockKeyhole size={18} aria-hidden="true" />
                <input id="current-password" type={visibleFields.current ? 'text' : 'password'} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" required />
                <button type="button" className="password-visibility-toggle" onClick={() => toggleVisibility('current')} aria-label={visibleFields.current ? 'Ocultar contraseña temporal o actual' : 'Mostrar contraseña temporal o actual'} aria-pressed={visibleFields.current}>
                  {visibleFields.current ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            <div className="password-field">
              <label htmlFor="new-password">Nueva contraseña</label>
              <div className="password-input-wrap">
                <KeyRound size={18} aria-hidden="true" />
                <input id="new-password" type={visibleFields.next ? 'text' : 'password'} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" required />
                <button type="button" className="password-visibility-toggle" onClick={() => toggleVisibility('next')} aria-label={visibleFields.next ? 'Ocultar nueva contraseña' : 'Mostrar nueva contraseña'} aria-pressed={visibleFields.next}>
                  {visibleFields.next ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            <div className="password-field">
              <label htmlFor="password-confirmation">Confirmar nueva contraseña</label>
              <div className="password-input-wrap">
                <CheckCircle2 size={18} aria-hidden="true" />
                <input id="password-confirmation" type={visibleFields.confirmation ? 'text' : 'password'} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" required />
                <button type="button" className="password-visibility-toggle" onClick={() => toggleVisibility('confirmation')} aria-label={visibleFields.confirmation ? 'Ocultar confirmación de contraseña' : 'Mostrar confirmación de contraseña'} aria-pressed={visibleFields.confirmation}>
                  {visibleFields.confirmation ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

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
