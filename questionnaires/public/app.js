const app = document.querySelector('#app');

const state = {
  config: null,
  respondent: null,
  step: -1,
  errors: {},
  saveTimer: null,
  saveStatus: '',
  consent: false,
  turnstileToken: '',
  admin: { authenticated: false, catalog: [], invitations: [], generatedLink: '', selectedId: null }
};

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const displayValue = (value) => {
  if (Array.isArray(value)) return value.join(', ') || 'Sin respuesta';
  return String(value ?? '').trim() || 'Sin respuesta';
};

const formatDate = (value, withTime = false) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'medium',
    ...(withTime ? { timeStyle: 'short' } : {})
  }).format(date);
};

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : null;
  if (!response.ok) {
    const error = new Error(body?.error || 'No fue posible completar la operación.');
    error.status = response.status;
    error.code = body?.code;
    error.errors = body?.errors;
    error.body = body;
    throw error;
  }
  return body;
}

function header(context = 'Levantamiento institucional de asistencia') {
  return `
    <header class="site-header">
      <a class="brand" href="/" aria-label="Liceo Domingo Santa María">
        <img class="brand__crest" src="/institucional/escudo-ldsm-concepcion.jpg" width="58" height="58" alt="" decoding="async" />
        <span class="brand__copy"><strong>Liceo Domingo Santa María</strong><small>Concepción · RBD 4565-9</small></span>
      </a>
      <span class="site-header__context">${escapeHtml(context)}</span>
    </header>
  `;
}

function renderLoading(message = 'Preparando cuestionario') {
  app.innerHTML = `${header()}<main class="status-page" id="main-content"><div class="status-page__inner"><div class="loading-line" aria-hidden="true"></div><p>${escapeHtml(message)}…</p></div></main>`;
}

function renderHome() {
  app.innerHTML = `
    ${header()}
    <main class="landing" id="main-content">
      <section class="landing__main">
        <div class="landing__main-content">
          <span class="eyebrow eyebrow--inverse">Proceso institucional</span>
          <h1>Definiciones que deben quedar claras.</h1>
          <p class="landing__lead">Este espacio reúne las decisiones necesarias para configurar correctamente el registro de asistencia. El acceso se realiza mediante una invitación personal enviada por el responsable del proceso.</p>
          <span class="campus-caption">Liceo Domingo Santa María · Santa María 2350, Concepción</span>
        </div>
      </section>
      <aside class="landing__aside" aria-label="Información de acceso">
        <figure class="landing__photo">
          <img src="/institucional/biblioteca-ldsm-concepcion.jpg" width="640" height="640" alt="Biblioteca del Liceo Domingo Santa María de Concepción" decoding="async" />
          <figcaption>Espacios que acompañan el aprendizaje.</figcaption>
        </figure>
        <div class="aside-copy">
          <h2>Acceso mediante enlace personal</h2>
          <p>Abra el enlace completo recibido por correo o mensajería institucional. No se solicita una cuenta externa.</p>
        </div>
        <p class="aside-note">No ingrese contraseñas, antecedentes de estudiantes ni información clínica en las respuestas.</p>
      </aside>
    </main>
  `;
}

function renderStatus(title, message, folio = '') {
  app.innerHTML = `
    ${header()}
    <main class="status-page" id="main-content">
      <section class="status-page__inner">
        <div class="status-mark" aria-hidden="true"></div>
        <span class="eyebrow">Estado del cuestionario</span>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(message)}</p>
        ${folio ? `<div class="folio"><small>Folio de recepción</small><strong>${escapeHtml(folio)}</strong></div>` : ''}
        ${folio ? '<p><button class="button button--secondary" id="print-receipt" type="button">Imprimir comprobante</button></p>' : ''}
      </section>
    </main>
  `;
  document.querySelector('#print-receipt')?.addEventListener('click', () => window.print());
}

async function loadRespondent(token) {
  renderLoading();
  try {
    const data = await api(`/api/questionnaires/${encodeURIComponent(token)}`);
    state.respondent = {
      token,
      invitation: data.invitation,
      questionnaire: data.questionnaire,
      identity: {
        fullName: data.draft.identity.fullName || data.invitation.respondentName || '',
        position: data.draft.identity.position || '',
        email: data.draft.identity.email || data.invitation.respondentEmail || '',
        unit: data.draft.identity.unit || ''
      },
      answers: data.draft.answers || {}
    };
    state.step = -1;
    renderRespondent();
  } catch (error) {
    if (error.code === 'SUBMITTED') renderStatus('Respuesta ya recibida', 'Este cuestionario fue enviado anteriormente.', error.body?.folio || '');
    else renderStatus('Enlace no disponible', error.message);
  }
}

function respondentProgress() {
  const total = state.respondent.questionnaire.questions.length + 2;
  return state.step < 0 ? 0 : Math.min(100, Math.round(((state.step + 1) / total) * 100));
}

function respondentShell(content, actions = '') {
  const { invitation, questionnaire } = state.respondent;
  const progress = respondentProgress();
  app.innerHTML = `
    ${header()}
    <main class="questionnaire-shell" id="main-content">
      <aside class="questionnaire-nav">
        <div>
          <img class="questionnaire-nav__crest" src="/institucional/escudo-ldsm-concepcion.jpg" width="72" height="72" alt="Escudo del Liceo Domingo Santa María de Concepción" decoding="async" />
          <span class="eyebrow">Cuestionario asignado</span>
          <p class="questionnaire-nav__role">${escapeHtml(questionnaire.label)}</p>
          <p class="questionnaire-nav__person">${escapeHtml(invitation.respondentName)}</p>
          <progress class="progress-track" aria-label="Avance" max="100" value="${progress}">${progress}%</progress>
          <span class="progress-copy">${progress}% completado</span>
        </div>
        <p class="nav-privacy">Las respuestas se utilizarán exclusivamente para definir el funcionamiento institucional del sistema de asistencia.</p>
      </aside>
      <section class="question-stage">
        <div class="question-stage__content">${content}</div>
        ${actions ? `<footer class="question-actions">${actions}</footer>` : ''}
      </section>
    </main>
  `;
}

function saveStatusMarkup() {
  const modifier = state.saveStatus.includes('guardado') ? 'save-status--ok' : state.saveStatus.includes('No fue') ? 'save-status--error' : '';
  return `<span class="save-status ${modifier}" id="save-status">${escapeHtml(state.saveStatus || 'Los cambios se guardan automáticamente')}</span>`;
}

function renderRespondent() {
  if (state.step === -1) return renderRespondentIntro();
  const questions = state.respondent.questionnaire.questions;
  if (state.step === 0) return renderIdentityStep();
  if (state.step <= questions.length) return renderQuestionStep(questions[state.step - 1], state.step, questions.length);
  return renderReviewStep();
}

function renderRespondentIntro() {
  const { questionnaire, invitation } = state.respondent;
  respondentShell(`
    <span class="eyebrow">Antes de comenzar</span>
    <h1 class="question-title intro-title">Su experiencia permitirá definir una regla defendible.</h1>
    <p class="question-help">Estimada/o ${escapeHtml(invitation.respondentName)}: responda desde la realidad actual del establecimiento. Si una definición todavía no existe, indíquelo expresamente.</p>
    <div class="intro-list" aria-label="Características del proceso">
      <div><strong>${questionnaire.estimatedMinutes} minutos</strong><span>Tiempo aproximado</span></div>
      <div><strong>${questionnaire.questions.length} definiciones</strong><span>Asignadas a su cargo</span></div>
      <div><strong>Guardado automático</strong><span>Puede continuar más tarde</span></div>
    </div>
  `, `<span class="save-status">Válido hasta ${escapeHtml(formatDate(invitation.expiresAt))}</span><button class="button" id="start-questionnaire" type="button">Comenzar</button>`);
  document.querySelector('#start-questionnaire').addEventListener('click', () => {
    state.step = 0;
    renderRespondent();
  });
}

function renderIdentityStep() {
  const identity = state.respondent.identity;
  respondentShell(`
    <span class="question-number">Identificación</span>
    <h1 class="question-title">Confirme quién responde.</h1>
    <p class="question-help">Estos datos permiten atribuir correctamente las definiciones. No se publicarán ni se utilizarán con fines comerciales.</p>
    <div class="field-grid">
      ${textField('fullName', 'Nombre completo', identity.fullName, true, 'Nombre y apellidos')}
      ${textField('position', 'Cargo o función', identity.position, true, 'Ejemplo: Inspectora General')}
      ${textField('email', 'Correo institucional', identity.email, false, 'nombre@dominio.cl', 'email')}
      ${textField('unit', 'Unidad o área', identity.unit, false, 'Ejemplo: Inspectoría')}
    </div>
  `, `<button class="button button--secondary" id="back" type="button">Volver</button>${saveStatusMarkup()}<button class="button" id="next" type="button">Continuar</button>`);
  bindIdentityInputs();
  bindNavigation();
}

function textField(id, label, value, required, placeholder, type = 'text') {
  const error = state.errors[id];
  return `
    <div class="field">
      <label for="${id}">${escapeHtml(label)}${required ? ' <span class="required">*</span>' : ''}</label>
      <input class="text-input" id="${id}" name="${id}" type="${type}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" ${required ? 'required' : ''} ${error ? 'aria-invalid="true" aria-describedby="' + id + '-error"' : ''} />
      ${error ? `<p class="field-error" id="${id}-error">${escapeHtml(error)}</p>` : ''}
    </div>
  `;
}

function bindIdentityInputs() {
  ['fullName', 'position', 'email', 'unit'].forEach((id) => {
    document.querySelector(`#${id}`).addEventListener('input', (event) => {
      state.respondent.identity[id] = event.target.value;
      delete state.errors[id];
      queueSave();
    });
  });
}

function renderQuestionStep(question, position, total) {
  respondentShell(`
    <span class="question-number">Definición ${position} de ${total}</span>
    <h1 class="question-title">${escapeHtml(question.label)}</h1>
    ${question.help ? `<p class="question-help">${escapeHtml(question.help)}</p>` : ''}
    ${questionInput(question)}
    ${state.errors[question.id] ? `<p class="field-error" id="${question.id}-error">${escapeHtml(state.errors[question.id])}</p>` : ''}
  `, `<button class="button button--secondary" id="back" type="button">Anterior</button>${saveStatusMarkup()}<button class="button" id="next" type="button">Continuar</button>`);
  bindQuestionInput(question);
  bindNavigation();
}

function questionInput(question) {
  const value = state.respondent.answers[question.id];
  if (question.type === 'radio' || question.type === 'checkbox') {
    const selected = Array.isArray(value) ? value : [value];
    return `<fieldset class="choice-list" ${state.errors[question.id] ? `aria-describedby="${question.id}-error"` : ''}>
      <legend class="sr-only">${escapeHtml(question.label)}</legend>
      ${question.options.map((option, index) => `
        <label class="choice" for="${question.id}-${index}">
          <input id="${question.id}-${index}" name="${question.id}" type="${question.type}" value="${escapeHtml(option)}" ${selected.includes(option) ? 'checked' : ''} />
          <span>${escapeHtml(option)}</span>
        </label>
      `).join('')}
    </fieldset>`;
  }
  if (question.type === 'textarea') {
    return `<textarea class="textarea-input" id="${question.id}" maxlength="${question.maxLength || 900}" placeholder="${escapeHtml(question.placeholder || '')}" ${state.errors[question.id] ? `aria-invalid="true" aria-describedby="${question.id}-error"` : ''}>${escapeHtml(value || '')}</textarea>`;
  }
  return `<input class="text-input" id="${question.id}" type="${question.type || 'text'}" maxlength="${question.maxLength || 300}" value="${escapeHtml(value || '')}" placeholder="${escapeHtml(question.placeholder || '')}" ${state.errors[question.id] ? `aria-invalid="true" aria-describedby="${question.id}-error"` : ''} />`;
}

function bindQuestionInput(question) {
  if (question.type === 'radio' || question.type === 'checkbox') {
    document.querySelectorAll(`input[name="${question.id}"]`).forEach((input) => input.addEventListener('change', () => {
      if (question.type === 'radio') {
        state.respondent.answers[question.id] = input.value;
      } else {
        state.respondent.answers[question.id] = [...document.querySelectorAll(`input[name="${question.id}"]:checked`)].map((item) => item.value);
      }
      delete state.errors[question.id];
      queueSave();
    }));
  } else {
    document.querySelector(`#${question.id}`).addEventListener('input', (event) => {
      state.respondent.answers[question.id] = event.target.value;
      delete state.errors[question.id];
      queueSave();
    });
  }
}

function bindNavigation() {
  document.querySelector('#back').addEventListener('click', () => {
    state.errors = {};
    state.step -= 1;
    renderRespondent();
  });
  document.querySelector('#next').addEventListener('click', nextStep);
}

function validateCurrentStep() {
  const errors = {};
  if (state.step === 0) {
    if (state.respondent.identity.fullName.trim().length < 5) errors.fullName = 'Ingrese el nombre completo.';
    if (state.respondent.identity.position.trim().length < 3) errors.position = 'Ingrese el cargo o función.';
    if (state.respondent.identity.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.respondent.identity.email.trim())) errors.email = 'Ingrese un correo válido.';
  } else {
    const question = state.respondent.questionnaire.questions[state.step - 1];
    if (question?.required) {
      const value = state.respondent.answers[question.id];
      const empty = Array.isArray(value) ? value.length === 0 : !String(value ?? '').trim();
      if (empty) errors[question.id] = 'Esta respuesta es necesaria para continuar.';
    }
  }
  state.errors = errors;
  return Object.keys(errors).length === 0;
}

async function nextStep() {
  if (!validateCurrentStep()) return renderRespondent();
  await saveDraft(true);
  state.step += 1;
  state.errors = {};
  renderRespondent();
}

function queueSave() {
  clearTimeout(state.saveTimer);
  state.saveStatus = 'Guardando cambios…';
  const status = document.querySelector('#save-status');
  if (status) status.textContent = state.saveStatus;
  state.saveTimer = setTimeout(() => saveDraft(false), 900);
}

async function saveDraft(showErrors) {
  clearTimeout(state.saveTimer);
  try {
    const result = await api(`/api/questionnaires/${encodeURIComponent(state.respondent.token)}`, {
      method: 'PUT',
      body: JSON.stringify({ identity: state.respondent.identity, answers: state.respondent.answers })
    });
    state.saveStatus = `Último guardado: ${new Intl.DateTimeFormat('es-CL', { timeStyle: 'short' }).format(new Date(result.savedAt))}`;
  } catch (error) {
    state.saveStatus = 'No fue posible guardar. Verifique su conexión.';
    if (showErrors && error.errors) state.errors = error.errors;
  }
  const status = document.querySelector('#save-status');
  if (status) {
    status.textContent = state.saveStatus;
    status.className = `save-status ${state.saveStatus.includes('No fue') ? 'save-status--error' : 'save-status--ok'}`;
  }
}

function renderReviewStep() {
  const { identity, answers, questionnaire } = state.respondent;
  const items = [
    ['Nombre', identity.fullName],
    ['Cargo', identity.position],
    ...questionnaire.questions.map((question) => [question.label, answers[question.id]])
  ];
  respondentShell(`
    <span class="question-number">Revisión final</span>
    <h1 class="question-title">Revise antes de enviar.</h1>
    <p class="question-help">Después del envío, este enlace quedará cerrado. Si detecta un error, vuelva a la pregunta correspondiente con el botón anterior.</p>
    <dl class="review-list">
      ${items.map(([label, value]) => `<div class="review-item"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(displayValue(value))}</dd></div>`).join('')}
    </dl>
    <label class="consent"><input id="consent" type="checkbox" ${state.consent ? 'checked' : ''} /><span>Confirmo que revisé las respuestas y que representan, según mi conocimiento, el funcionamiento o las definiciones de mi área.</span></label>
    <div id="turnstile-container"></div>
    ${state.errors._form ? `<p class="field-error">${escapeHtml(state.errors._form)}</p>` : ''}
  `, `<button class="button button--secondary" id="back" type="button">Anterior</button>${saveStatusMarkup()}<button class="button" id="submit" type="button">Enviar respuesta definitiva</button>`);

  document.querySelector('#back').addEventListener('click', () => {
    state.step -= 1;
    renderRespondent();
  });
  document.querySelector('#consent').addEventListener('change', (event) => { state.consent = event.target.checked; });
  document.querySelector('#submit').addEventListener('click', submitQuestionnaire);
  mountTurnstile();
}

function mountTurnstile() {
  if (!state.config?.turnstileSiteKey) return;
  const renderWidget = () => {
    if (!window.turnstile || document.querySelector('#turnstile-container iframe')) return;
    window.turnstile.render('#turnstile-container', {
      sitekey: state.config.turnstileSiteKey,
      callback: (token) => { state.turnstileToken = token; },
      'expired-callback': () => { state.turnstileToken = ''; }
    });
  };
  if (window.turnstile) return renderWidget();
  if (!document.querySelector('script[data-turnstile]')) {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.dataset.turnstile = 'true';
    script.addEventListener('load', renderWidget);
    document.head.appendChild(script);
  }
}

async function submitQuestionnaire() {
  if (!state.consent) {
    state.errors = { _form: 'Confirme la revisión para realizar el envío definitivo.' };
    return renderReviewStep();
  }
  if (state.config?.turnstileSiteKey && !state.turnstileToken) {
    state.errors = { _form: 'Complete la validación de seguridad.' };
    return renderReviewStep();
  }

  const button = document.querySelector('#submit');
  button.disabled = true;
  button.textContent = 'Enviando respuesta…';
  try {
    const result = await api(`/api/questionnaires/${encodeURIComponent(state.respondent.token)}/submit`, {
      method: 'POST',
      body: JSON.stringify({
        identity: state.respondent.identity,
        answers: state.respondent.answers,
        consent: true,
        turnstileToken: state.turnstileToken
      })
    });
    renderStatus('Respuesta recibida', `El envío quedó registrado el ${formatDate(result.submittedAt, true)}. Conserve el folio como respaldo.`, result.folio);
  } catch (error) {
    state.errors = { ...(error.errors || {}), _form: error.message };
    renderReviewStep();
  }
}

async function renderAdmin() {
  renderLoading('Verificando acceso administrativo');
  try {
    await api('/api/admin/session');
    state.admin.authenticated = true;
    await loadAdminData();
  } catch {
    state.admin.authenticated = false;
    renderAdminLogin();
  }
}

function renderAdminLogin(errorMessage = '') {
  app.innerHTML = `
    ${header('Administración del levantamiento institucional')}
    <main class="login-admin" id="main-content">
      <section class="login-admin__context">
        <span class="eyebrow eyebrow--inverse">Acceso restringido</span>
        <h1>Control de respuestas.</h1>
        <p>Desde aquí se generan invitaciones personales, se verifica el avance y se exporta el levantamiento institucional.</p>
        <span class="campus-caption">Liceo Domingo Santa María · Concepción</span>
      </section>
      <section class="login-admin__form">
        <form id="admin-login-form">
          <span class="eyebrow">Administración</span>
          <h2>Ingrese la clave del proceso</h2>
          ${errorMessage ? `<p class="notice">${escapeHtml(errorMessage)}</p>` : ''}
          <div class="field">
            <label for="admin-password">Clave administrativa</label>
            <input class="text-input" id="admin-password" type="password" autocomplete="current-password" required />
          </div>
          <button class="button" type="submit">Ingresar</button>
        </form>
      </section>
    </main>
  `;
  document.querySelector('#admin-login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    try {
      await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: document.querySelector('#admin-password').value }) });
      state.admin.authenticated = true;
      await loadAdminData();
    } catch (error) {
      renderAdminLogin(error.message);
    }
  });
}

async function loadAdminData() {
  try {
    const [catalog, invitations] = await Promise.all([api('/api/admin/catalog'), api('/api/admin/invitations')]);
    state.admin.catalog = catalog.roles;
    state.admin.invitations = invitations.invitations;
    renderAdminDashboard();
  } catch (error) {
    if (error.status === 401) return renderAdminLogin('La sesión venció. Ingrese nuevamente.');
    renderStatus('No fue posible cargar la administración', error.message);
  }
}

function statusLabel(status) {
  return ({ invited: 'Enviada', opened: 'Abierta', draft: 'En borrador', submitted: 'Respondida', revoked: 'Revocada', expired: 'Vencida' })[status] || status;
}

function renderAdminDashboard() {
  const invitations = state.admin.invitations;
  const metrics = {
    total: invitations.length,
    submitted: invitations.filter((item) => item.status === 'submitted').length,
    draft: invitations.filter((item) => ['opened', 'draft'].includes(item.status)).length,
    pending: invitations.filter((item) => item.status === 'invited').length
  };
  app.innerHTML = `
    ${header('Administración del levantamiento institucional')}
    <main class="admin-page" id="main-content">
      <header class="admin-header">
        <div><span class="eyebrow">Control institucional</span><h1 class="admin-title">Cuestionarios</h1></div>
        <div class="admin-actions">
          <a class="button button--secondary" href="/api/admin/export.csv">Exportar CSV</a>
          <button class="button button--quiet" id="refresh-admin" type="button">Actualizar</button>
          <button class="button button--quiet" id="logout-admin" type="button">Cerrar sesión</button>
        </div>
      </header>
      <section class="admin-metrics" aria-label="Resumen">
        ${metric(metrics.total, 'Invitaciones')}${metric(metrics.submitted, 'Respondidas')}${metric(metrics.draft, 'En proceso')}${metric(metrics.pending, 'Sin abrir')}
      </section>
      <section class="admin-content">
        <div class="admin-section-heading"><h2>Crear invitación personal</h2><p>El enlace se muestra una sola vez; cópielo antes de continuar.</p></div>
        ${invitationForm()}
        ${state.admin.generatedLink ? generatedLinkMarkup(state.admin.generatedLink) : ''}
        <div class="admin-section-heading"><h2>Seguimiento de respuestas</h2><p>${invitations.length} registros</p></div>
        ${invitationsTable(invitations)}
      </section>
      ${responseDetailMarkup()}
    </main>
  `;
  bindAdminEvents();
}

const metric = (value, label) => `<div class="metric"><strong>${value}</strong><span>${escapeHtml(label)}</span></div>`;

function invitationForm() {
  return `
    <form class="admin-form" id="invitation-form">
      <div class="field"><label for="invite-name">Nombre completo</label><input class="text-input" id="invite-name" required /></div>
      <div class="field"><label for="invite-email">Correo, opcional</label><input class="text-input" id="invite-email" type="email" /></div>
      <div class="field"><label for="invite-role">Cargo o área</label><select class="select-input" id="invite-role" required><option value="">Seleccione…</option>${state.admin.catalog.map((role) => `<option value="${escapeHtml(role.value)}">${escapeHtml(role.label)}</option>`).join('')}</select></div>
      <div class="field"><label for="invite-days">Vigencia</label><select class="select-input" id="invite-days"><option value="7">7 días</option><option value="14" selected>14 días</option><option value="30">30 días</option></select></div>
      <button class="button" type="submit">Generar enlace</button>
    </form>
  `;
}

function generatedLinkMarkup(url) {
  return `<section class="generated-link"><h3>Invitación creada correctamente</h3><p>Copie este enlace ahora. Por seguridad, el token completo no se almacena y no volverá a mostrarse.</p><div class="generated-link__row"><code id="generated-url">${escapeHtml(url)}</code><button class="button button--secondary" id="copy-generated" type="button">Copiar enlace</button></div></section>`;
}

function invitationsTable(invitations) {
  if (!invitations.length) return '<p class="empty-state">Todavía no hay invitaciones. Cree la primera usando el formulario anterior.</p>';
  return `<div class="table-wrap"><table class="admin-table"><thead><tr><th>Responsable</th><th>Cuestionario</th><th>Estado</th><th>Vigencia</th><th>Folio</th><th>Acciones</th></tr></thead><tbody>${invitations.map((item) => `
    <tr>
      <td><strong>${escapeHtml(item.respondentName)}</strong><small>${escapeHtml(item.respondentEmail || 'Sin correo registrado')}</small></td>
      <td>${escapeHtml(item.roleLabel)}<small>${item.progress}% completado</small></td>
      <td><span class="badge badge--${escapeHtml(item.status)}">${escapeHtml(statusLabel(item.status))}</span></td>
      <td>${escapeHtml(formatDate(item.expiresAt))}<small>${item.submittedAt ? `Enviado ${escapeHtml(formatDate(item.submittedAt, true))}` : ''}</small></td>
      <td>${escapeHtml(item.folio || '—')}</td>
      <td><div class="table-actions">
        ${['draft', 'submitted', 'opened'].includes(item.status) ? `<button class="button button--quiet" data-action="view" data-id="${item.id}" type="button">Ver</button>` : ''}
        ${!['submitted'].includes(item.status) ? `<button class="button button--quiet" data-action="rotate" data-id="${item.id}" type="button">Nuevo enlace</button>` : ''}
        ${!['submitted', 'revoked'].includes(item.status) ? `<button class="button button--danger button--quiet" data-action="revoke" data-id="${item.id}" type="button">Revocar</button>` : ''}
      </div></td>
    </tr>`).join('')}</tbody></table></div>`;
}

function responseDetailMarkup() {
  const item = state.admin.invitations.find((invitation) => invitation.id === state.admin.selectedId);
  if (!item) return '';
  const questionnaire = state.admin.catalog.find((role) => role.value === item.role);
  const questionLabels = Object.fromEntries((questionnaire?.questions || []).map((question) => [question.id, question.label]));
  const entries = Object.entries(item.answers || {});
  return `<section class="response-detail"><div class="response-detail__inner"><div class="admin-section-heading"><h3>Respuesta de ${escapeHtml(item.respondentName)}</h3><button class="button button--quiet" id="close-detail" type="button">Cerrar</button></div><dl class="review-list">${entries.length ? entries.map(([key, value]) => `<div class="review-item"><dt>${escapeHtml(questionLabels[key] || key.replaceAll('_', ' '))}</dt><dd>${escapeHtml(displayValue(value))}</dd></div>`).join('') : '<p>El cuestionario fue abierto, pero todavía no contiene respuestas guardadas.</p>'}</dl></div></section>`;
}

function bindAdminEvents() {
  document.querySelector('#refresh-admin').addEventListener('click', loadAdminData);
  document.querySelector('#logout-admin').addEventListener('click', async () => {
    await api('/api/admin/logout', { method: 'POST', body: '{}' });
    state.admin.authenticated = false;
    renderAdminLogin();
  });
  document.querySelector('#invitation-form').addEventListener('submit', createInvitation);
  document.querySelector('#copy-generated')?.addEventListener('click', async () => {
    await navigator.clipboard.writeText(state.admin.generatedLink);
    document.querySelector('#copy-generated').textContent = 'Enlace copiado';
  });
  document.querySelector('#close-detail')?.addEventListener('click', () => {
    state.admin.selectedId = null;
    renderAdminDashboard();
  });
  document.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', handleInvitationAction));
}

async function createInvitation(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const result = await api('/api/admin/invitations', {
      method: 'POST',
      body: JSON.stringify({
        respondentName: document.querySelector('#invite-name').value,
        respondentEmail: document.querySelector('#invite-email').value,
        role: document.querySelector('#invite-role').value,
        expiresInDays: document.querySelector('#invite-days').value
      })
    });
    state.admin.generatedLink = result.invitation.url;
    await loadAdminData();
  } catch (error) {
    window.alert(error.message);
    button.disabled = false;
  }
}

async function handleInvitationAction(event) {
  const action = event.currentTarget.dataset.action;
  const id = Number(event.currentTarget.dataset.id);
  if (action === 'view') {
    state.admin.selectedId = id;
    renderAdminDashboard();
    document.querySelector('.response-detail')?.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  if (action === 'revoke') {
    if (!window.confirm('¿Revocar esta invitación? El enlace dejará de funcionar inmediatamente.')) return;
    await api(`/api/admin/invitations/${id}`, { method: 'DELETE' });
    return loadAdminData();
  }
  if (action === 'rotate') {
    if (!window.confirm('Se invalidará el enlace anterior y también se eliminará su borrador. ¿Continuar?')) return;
    const result = await api(`/api/admin/invitations/${id}/rotate`, { method: 'POST', body: '{}' });
    state.admin.generatedLink = result.url;
    return loadAdminData();
  }
}

async function bootstrap() {
  try {
    state.config = await api('/api/config');
  } catch {
    state.config = { turnstileSiteKey: '' };
  }

  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/administrar') return renderAdmin();
  if (path.startsWith('/responder/')) {
    const token = decodeURIComponent(path.slice('/responder/'.length));
    if (token) return loadRespondent(token);
  }
  renderHome();
}

bootstrap();
