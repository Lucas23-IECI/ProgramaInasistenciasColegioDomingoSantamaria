// Run with playwright-cli run-code --filename from the repository root.
// Browser-only regression: every API request is intercepted; no DB writes.
async (page) => {
  const origin = 'http://127.0.0.1:4174';
  const artifacts = 'output/playwright/student-manual-20260930';
  const checks = [];
  const pageErrors = [];
  const recordPageError = (error) => pageErrors.push(error.message);
  page.on('pageerror', recordPageError);
  const check = (condition, name) => {
    if (!condition) throw new Error(`FAIL: ${name}`);
    checks.push(name);
  };
  const courses = [{ id_curso: 1, nombre_curso: '1° Medio' }, { id_curso: 2, nombre_curso: '2° Medio' }];
  const student = { id_alumno: 90001, nombres: 'Estudiante ficticio', paterno: 'Prueba', materno: '', rut: '12345678', dv: '5', grade: '1° Medio', activo: true, rol: 'Estudiante' };
  const state = { courseMode: 'ok', saveMode: 'ok', posts: [], courseGate: null };
  await page.unroute('**/api/**');
  await page.addInitScript(() => {
    localStorage.setItem('ldsm-theme', 'light');
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = function(key) { return String(key).startsWith('ldsm-release:') ? 'seen' : original.call(this, key); };
  });
  await page.route('**/api/**', async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const json = (data, status = 200) => route.fulfill({ json: data, status });
    if (path === '/api/auth/me') return json({ user: { id: 90001, nombre: 'Cuenta ficticia QA', rol: 'inspector', permissions: ['students.view', 'students.manage'] } });
    if (path === '/api/courses') {
      if (state.courseGate) await state.courseGate;
      if (state.courseMode === 'error') return json({ message: 'No fue posible cargar la lista de cursos.' }, 503);
      if (state.courseMode === 'invalid') return json({ invalid: true });
      return json(state.courseMode === 'empty' ? [] : courses);
    }
    if (path === '/api/students' && request.method() === 'GET') return json([student]);
    if (path === '/api/students/90001/details') return json({ alumno: student, ingresos: [], registros: [], historial: [], matriculas: [], identificadores: [], regularizaciones: [] });
    if (path === '/api/students' && request.method() === 'POST') {
      state.posts.push(request.postDataJSON());
      return state.saveMode === 'error'
        ? json({ message: 'No fue posible guardar el cambio. Intenta nuevamente.' }, 503)
        : json({ message: 'Alta simulada verificada; no se escribió en la base de datos.' }, 201);
    }
    if (path.endsWith('/eventos')) return route.fulfill({ status: 204 });
    if (path === '/api/notificaciones') return json({ items: [], unread: 0 });
    return json({});
  });
  const modal = () => page.locator('.student-manual-modal');
  const combo = (name) => page.getByRole('combobox', { name, exact: true });
  const open = async () => {
    await page.getByRole('button', { name: 'Agregar estudiante', exact: true }).click();
    await modal().waitFor({ state: 'visible' });
  };
  const choose = async (name, option) => {
    await combo(name).click();
    await page.getByRole('option', { name: option, exact: true }).click();
    await page.waitForFunction(({ name, option }) => [...document.querySelectorAll('[role=combobox]')]
      .some(el => el.getAttribute('aria-label') === name && el.textContent.includes(option)), { name, option });
  };
  const submit = () => modal().getByRole('button', { name: 'Agregar estudiante manualmente', exact: true }).click();
  const visibleMessage = async (text) => {
    await modal().getByRole('alert').filter({ hasText: text }).waitFor({ state: 'visible' });
  };
  const measureMenu = () => page.locator('.app-select-content').evaluate((menu) => {
    const first = menu.querySelector('[role=option]');
    const bounds = first.getBoundingClientRect();
    const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    const rect = menu.getBoundingClientRect();
    const overlay = document.querySelector('.student-manual-overlay');
    return { receivesPointer: first.contains(hit), options: menu.querySelectorAll('[role=option]').length,
      aboveModal: Number(getComputedStyle(menu.parentElement).zIndex) > Number(getComputedStyle(overlay).zIndex),
      inViewport: rect.left >= 0 && rect.right <= innerWidth + 1 && rect.top >= 0 && rect.bottom <= innerHeight + 1 };
  });

  for (const [device, width, height] of [['desktop', 1366, 900], ['mobile-layout', 390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.goto(`${origin}/admin/estudiantes`);
    await page.getByRole('heading', { name: '1° Medio', exact: true }).waitFor();
    await open();
    check((await combo('Curso del estudiante').innerText()).includes('Seleccionar curso'), `${device}: placeholder de curso visible`);
    check((await combo('Motivo del alta manual').innerText()).includes('Seleccionar motivo'), `${device}: placeholder de motivo visible`);
    await modal().getByRole('textbox', { name: 'Nombres', exact: true }).fill('Registro QA ficticio');
    await combo('Motivo del alta manual').click();
    const menu = await measureMenu();
    check(menu.options === 6 && menu.receivesPointer && menu.inViewport && menu.aboveModal, `${device}: seis motivos visibles, tocables y sobre el modal`);
    check(await modal().evaluate(el => getComputedStyle(el).backgroundColor.startsWith('rgb(')), `${device}: fondo del formulario opaco y legible`);
    await page.screenshot({ path: `${artifacts}/motivos-${device}.png`, animations: 'disabled' });
    await page.keyboard.press('Escape');
    check(await modal().isVisible() && await modal().getByRole('textbox', { name: 'Nombres', exact: true }).inputValue() === 'Registro QA ficticio', `${device}: Escape cierra solo el menú y conserva lo escrito`);
    await combo('Curso del estudiante').click();
    const courseMenu = await measureMenu();
    check(courseMenu.options === 2 && courseMenu.receivesPointer && courseMenu.inViewport && courseMenu.aboveModal, `${device}: cursos visibles y seleccionables`);
    await page.keyboard.press('End');
    await page.waitForFunction(() => document.activeElement?.textContent === '2° Medio');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[aria-label="Curso del estudiante"]').textContent.includes('2° Medio'));
    check((await combo('Curso del estudiante').innerText()).includes('2° Medio'), `${device}: seleccionar curso con teclado`);
    await modal().getByRole('button', { name: 'Cancelar', exact: true }).click();

    await page.getByRole('button').filter({ has: page.getByRole('heading', { name: '1° Medio', exact: true }) }).click();
    await open();
    await page.waitForFunction(() => document.querySelector('[aria-label="Curso del estudiante"]').textContent.includes('1° Medio'));
    await modal().getByRole('textbox', { name: 'Nombres', exact: true }).fill('Registro QA ficticio');
    check((await combo('Curso del estudiante').innerText()).includes('1° Medio'), `${device}: curso de origen persiste tras escribir`);
    await modal().getByPlaceholder('12.345.678-5', { exact: true }).fill('12.345.678-5');
    await modal().getByRole('textbox', { name: 'Apellido paterno', exact: true }).fill('Prueba');
    const postStart = state.posts.length;
    await submit();
    await visibleMessage('Seleccione el motivo del alta manual.');
    check(state.posts.length === postStart, `${device}: no envía un alta sin motivo`);
    await choose('Motivo del alta manual', 'Otro motivo');
    await submit();
    await visibleMessage('Explique el motivo del alta manual.');
    check(state.posts.length === postStart, `${device}: Otro exige detalle`);
    await choose('Motivo del alta manual', 'Matrícula reciente');
    state.saveMode = 'error';
    await submit();
    await visibleMessage('No fue posible guardar');
    check(await modal().getByRole('textbox', { name: 'Nombres', exact: true }).inputValue() === 'Registro QA ficticio'
      && (await combo('Motivo del alta manual').innerText()).includes('Matrícula reciente'), `${device}: fallo de guardado conserva formulario`);
    state.saveMode = 'ok';
    await submit();
    await modal().waitFor({ state: 'hidden' });
    const payload = state.posts.at(-1);
    check(payload.grade === '1° Medio' && payload.motivo_alta_manual === 'MATRICULA_RECIENTE' && state.posts.length === postStart + 2, `${device}: envío y reintento llevan curso y motivo correctos`);

    // Adjacent filters with an intentional empty option must still clear.
    await choose('Filtrar por estado', 'Vigentes');
    await choose('Filtrar por estado', 'Estado: todos');
    check((await combo('Filtrar por estado').innerText()).includes('Estado: todos'), `${device}: filtro vacío explícito sigue funcionando`);
    await page.getByRole('button', { name: 'Ver Ficha', exact: true }).click();
    await page.getByRole('button', { name: 'Editar ficha', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Curso del estudiante"]').textContent.includes('1° Medio'));
    check((await combo('Curso del estudiante').innerText()).includes('1° Medio'), `${device}: edición conserva curso preexistente`);
    await modal().getByRole('button', { name: 'Cancelar', exact: true }).click();
    await page.getByRole('button', { name: 'Cerrar ficha', exact: true }).click();

    await page.goto(`${origin}/admin/estudiantes`);
    await open();
    await choose('Tipo de identificación del estudiante', 'Pasaporte');
    check((await combo('País emisor del documento').innerText()).includes('Seleccionar país'), `${device}: país muestra placeholder`);
    await choose('País emisor del documento', 'Argentina');
    check((await combo('País emisor del documento').innerText()).includes('Argentina'), `${device}: selector adicional de país funciona`);
    check(await modal().evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${device}: formulario sin desborde horizontal`);
    await modal().getByRole('button', { name: 'Cancelar', exact: true }).click();
  }

  for (const mode of ['error', 'invalid']) {
    state.courseMode = mode;
    await page.goto(`${origin}/admin/estudiantes`);
    await page.getByRole('button', { name: 'Reintentar carga', exact: true }).waitFor();
    check(await page.getByRole('button', { name: 'Agregar estudiante', exact: true }).isDisabled(), `${mode}: carga fallida o inválida bloquea alta y ofrece reintento`);
    state.courseMode = 'ok';
    await page.getByRole('button', { name: 'Reintentar carga', exact: true }).click();
    await open();
    await modal().getByRole('button', { name: 'Cancelar', exact: true }).click();
    check(true, `${mode}: reintento recupera el formulario`);
  }
  state.courseMode = 'empty';
  await page.goto(`${origin}/admin/estudiantes`);
  await open();
  await visibleMessage('No hay cursos institucionales disponibles');
  check(await combo('Curso del estudiante').isDisabled()
    && await modal().getByRole('button', { name: 'Agregar estudiante manualmente', exact: true }).isDisabled(), 'catálogo realmente vacío se explica y no permite guardar');
  await modal().getByRole('textbox', { name: 'Nombres', exact: true }).fill('Conservar durante reintento');
  state.courseMode = 'ok';
  await modal().getByRole('button', { name: 'Reintentar cursos', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[aria-label="Curso del estudiante"]').disabled);
  check(await modal().getByRole('textbox', { name: 'Nombres', exact: true }).inputValue() === 'Conservar durante reintento', 'reintentar cursos no borra los datos escritos');
  await choose('Curso del estudiante', '1° Medio');
  check((await combo('Curso del estudiante').innerText()).includes('1° Medio'), 'catálogo vacío recuperado permite elegir curso');
  await modal().getByRole('button', { name: 'Cancelar', exact: true }).click();

  let releaseCourses;
  state.courseGate = new Promise(resolve => { releaseCourses = resolve; });
  try {
    await page.goto(`${origin}/admin/estudiantes`);
    await page.getByText('Cargando base de datos escolar...', { exact: true }).waitFor();
    check(await page.getByRole('button', { name: 'Agregar estudiante', exact: true }).isDisabled(), 'carga lenta no abre un formulario incompleto');
  } finally { releaseCourses(); state.courseGate = null; }
  await open();
  check(await combo('Curso del estudiante').isEnabled(), 'el formulario se habilita al terminar la carga');
  await modal().getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.getByRole('button', { name: 'Activar modo oscuro', exact: true }).click();
  await page.setViewportSize({ width: 320, height: 740 });
  await open();
  await combo('Motivo del alta manual').click();
  const darkMenu = await measureMenu();
  check(darkMenu.inViewport && darkMenu.receivesPointer && darkMenu.aboveModal, 'modo oscuro a 320px: opciones visibles y seleccionables');
  check(await modal().evaluate(el => getComputedStyle(el).backgroundColor.startsWith('rgb(')), 'modo oscuro: formulario sin transparencia');
  await page.screenshot({ path: `${artifacts}/motivos-dark-320.png`, animations: 'disabled' });
  await page.getByRole('option', { name: 'Matrícula reciente', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Motivo del alta manual"]').textContent.includes('Matrícula reciente'));
  check((await combo('Motivo del alta manual').innerText()).includes('Matrícula reciente'), 'modo oscuro: elección persiste');
  await modal().getByRole('button', { name: 'Cancelar', exact: true }).click();
  page.off('pageerror', recordPageError);
  check(pageErrors.length === 0, `sin excepciones JavaScript inesperadas: ${pageErrors.join('; ')}`);
  return { passed: checks.length, checks, scope: 'Navegador real y API simulada; sin escrituras de base de datos. Móvil aquí es viewport estrecho, no dispositivo físico.' };
}
