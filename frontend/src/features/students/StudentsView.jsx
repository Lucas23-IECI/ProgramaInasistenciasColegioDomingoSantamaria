import { Search, X, Users, GraduationCap, Database, Upload, FileSpreadsheet, RefreshCw, ShieldCheck, User, Mail, Phone, Calendar, Hash, Shield, Clock, Activity, AlertTriangle, BellRing, UserPlus, Pencil, Archive, RotateCcw, ContactRound } from 'lucide-react';
import ModuleHeader from '../../components/ModuleHeader';
import AppSelect from '../../components/AppSelect';
import StudentManualModal from '../../components/StudentManualModal';
import StudentIdentityRegularizationModal from '../../components/StudentIdentityRegularizationModal';
import StudentGovernancePanel from '../../components/StudentGovernancePanel';
import { StudentDetailDrawer } from './StudentDetailDrawer';
import { StudentOriginBadge } from './StudentOriginBadge';
import { getStudentIdentifier, getStudentIdentifierLabel } from '../../utils/studentFormat';



export function StudentsView(controller) {
  const {
    canImport,
    canManage,
    canRegularizeIdentity,
    canExportStudents,
    canExportSensitiveStudents,
    canViewSensitiveIdentifiers,
    canImportGuardians,
    canManageFamilies,
    activeSection,
    setActiveSection,
    students,
    courses,
    loading,
    searchTerm,
    setSearchTerm,
    selectedCourse,
    setSelectedCourse,
    page,
    setPage,
    pageSize,
    setPageSize,
    courseSearch,
    setCourseSearch,
    globalStudentSearch,
    setGlobalStudentSearch,
    coursePage,
    setCoursePage,
    COURSE_PAGE_SIZE,
    filterEstado,
    setFilterEstado,
    filterRol,
    setFilterRol,
    excelRows,
    previewRows,
    importPreview,
    courseResolutions,
    identityResolutions,
    setIdentityResolutions,
    confirmNewCourses,
    setConfirmNewCourses,
    confirmMissingDeactivation,
    setConfirmMissingDeactivation,
    importMode,
    excelFileName,
    syncing,
    syncResult,
    uploadError,
    setUploadError,
    toast,
    guardianRows,
    guardianFileName,
    guardianError,
    setGuardianError,
    guardianResult,
    syncingGuardians,
    selectedStudentId,
    studentDetails,
    loadingDetails,
    manualEditor,
    setManualEditor,
    identityRegularization,
    setIdentityRegularization,
    navigate,
    contentStartRef,
    alertasMap,
    openDetails,
    closeDetails,
    handleExcelUpload,
    changeImportMode,
    resolveImportedCourse,
    createsNewCourses,
    canConfirmImport,
    syncExcelWithDatabase,
    openManualEditor,
    handleManualSaved,
    openIdentityRegularization,
    handleIdentityRegularized,
    handleGuardianUpload,
    syncGuardians,
    courseGroups,
    filtered,
    stuTotalPages,
    paginatedStudents,
    formatNullable,
    handleBack,
    handleLogout,
    selectCourse
  } = controller;

  return <div className="students-page">
      {toast && (
        <div className={`kiosk-reconnected-banner ${toast.type === 'error' ? 'bg-red-500' : ''}`} style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          zIndex: 10000,
          background: toast.type === 'error' ? '#ef4444' : '#10b981',
          color: 'white',
          padding: '12px 24px',
          borderRadius: '10px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
        }}>
          <span>{toast.text}</span>
        </div>
      )}

      <div className="students-card" ref={contentStartRef}>

        <ModuleHeader
          icon={GraduationCap}
          title={activeSection === 'listado'
            ? (selectedCourse ? `Nómina: ${selectedCourse}` : 'Personas y cursos')
            : activeSection === 'carga'
              ? 'Importación de nómina escolar'
              : activeSection === 'governance'
                ? 'Control del padrón institucional'
                : 'Importación de apoderados y autorizaciones'}
          description={activeSection === 'carga'
            ? 'Carga controlada desde el archivo ERP, con previsualización antes de sincronizar.'
            : activeSection === 'governance'
              ? 'Calidad, validación manual, historial de importaciones y duplicados.'
            : activeSection === 'apoderados'
              ? 'Ficha separada de alumnos y cuentas de acceso, preparada para múltiples personas autorizadas.'
              : 'Padrón institucional, cursos, estado de matrícula y ficha de cada integrante.'}
          onBack={handleBack}
          onLogout={handleLogout}
        >
          {canManageFamilies && (
            <button type="button" className="module-header__button" onClick={() => navigate('/admin/familias')}>
              <ContactRound size={15} /> Ficha familiar
            </button>
          )}
        </ModuleHeader>

        <div className="students-tabs" data-tour="students-navigation">
          <button
            className={`students-tab ${activeSection === 'listado' ? 'active' : ''}`}
            onClick={() => {
              setActiveSection('listado');
              setUploadError('');
            }}
          >
            <Users size={16} /> Padrón de personas
          </button>
          {canImport && <button
            className={`students-tab ${activeSection === 'carga' ? 'active' : ''}`}
            onClick={() => {
              setActiveSection('carga');
              setSelectedCourse(null);
            }}
          >
            <Database size={16} /> Importar Excel ERP
          </button>}
          {canImportGuardians && <button
            className={`students-tab ${activeSection === 'apoderados' ? 'active' : ''}`}
            onClick={() => {
              setActiveSection('apoderados');
              setSelectedCourse(null);
              setGuardianError('');
            }}
          >
            <ShieldCheck size={16} /> Importar apoderados
          </button>}
          {(canManage || canImport || canExportStudents) && <button
            className={`students-tab ${activeSection === 'governance' ? 'active' : ''}`}
            onClick={() => {
              setActiveSection('governance');
              setSelectedCourse(null);
            }}
          >
            <Shield size={16} /> Control del padrón
          </button>}
        </div>

        {activeSection === 'listado' && canManage && (
          <div className="students-manual-toolbar" data-tour="student-manual-create">
            <div>
              <strong>Gestión manual de matrícula</strong>
              <span>Para altas individuales, correcciones o cambios que no requieren importar otra planilla.</span>
            </div>
            <button type="button" onClick={() => openManualEditor('create')}>
              <UserPlus size={18} /> Agregar estudiante
            </button>
          </div>
        )}

        {activeSection === 'listado' && loading ? (
          <div className="loader">Cargando base de datos escolar...</div>
        ) : activeSection === 'listado' && !selectedCourse ? (
          <div className="fade-in">
             <p style={{color: 'var(--text-light)', marginBottom: '16px'}}>
                Seleccione un curso para inspeccionar su listado, o busque de manera global por RUT o Nombre.
             </p>

             <div className="students-filter-row" data-tour="student-search">
               <div className="students-search" style={{flex: '2', minWidth: '260px'}}>
                 <Search size={16} />
                 <input
                   type="text"
                   placeholder="Buscar globalmente (por RUT, Nombre o Usuario)..."
                   value={globalStudentSearch}
                   onChange={(e) => setGlobalStudentSearch(e.target.value)}
                 />
               </div>
               <div className="students-search" style={{flex: '1', minWidth: '180px'}}>
                 <Search size={16} />
                 <input
                   type="text"
                   placeholder="Filtrar cursos..."
                   value={courseSearch}
                   onChange={(e) => setCourseSearch(e.target.value)}
                 />
               </div>
             </div>

             {globalStudentSearch.trim().length >= 2 && (() => {
               const globalFiltered = students.filter(s =>
                 (s.nombres + ' ' + s.paterno).toLowerCase().includes(globalStudentSearch.toLowerCase()) ||
                 String(s.rut || '').toLowerCase().includes(globalStudentSearch.toLowerCase()) ||
                 String(s.documento_erp || '').toLowerCase().includes(globalStudentSearch.toLowerCase()) ||
                 String(s.uuid_erp || '').toLowerCase().includes(globalStudentSearch.toLowerCase()) ||
                 (s.nombre_usuario && s.nombre_usuario.toLowerCase().includes(globalStudentSearch.toLowerCase()))
               );
               return (
                 <div className="fade-in" style={{marginBottom: '28px', background: 'rgba(15,23,42,0.4)', borderRadius: '14px', padding: '18px', border: '1px solid rgba(59,130,246,0.15)'}}>
                   <h3 style={{margin: '0 0 12px 0', color: 'var(--text-dark)', fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '8px'}}>
                     <Users size={18} color="var(--primary)" />
                     Miembros Encontrados ({globalFiltered.length})
                   </h3>
                   {globalFiltered.length > 0 ? (
                     <div className="students-table-wrap">
                       <table className="students-table students-table--cards">
                         <thead>
                           <tr>
                             <th>Identificador</th>
                             <th>Nombre Completo</th>
                             <th>Curso</th>
                             <th>Rol</th>
                             <th style={{textAlign: 'center'}}>Estado</th>
                             <th style={{textAlign: 'right'}}>Acción</th>
                           </tr>
                         </thead>
                         <tbody>
                           {globalFiltered.slice(0, 15).map(s => (
                             <tr key={s.id_alumno}>
                               <td className="students-cell-mono" data-label={getStudentIdentifierLabel(s)}>{getStudentIdentifier(s)}</td>
                               <td className="students-cell-name" data-label="Nombre">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                            <span>{s.nombres} {s.paterno} {s.materno}</span>
                            <StudentOriginBadge student={s} />
                            {alertasMap[s.id_alumno]?.nivel === 'critica' && (
                              <span
                                className="severity-badge severity-badge--grave"
                                title={`${alertasMap[s.id_alumno].atrasos} atrasos registrados en los últimos 30 días, ${alertasMap[s.id_alumno].graves} graves`}
                                style={{ cursor: 'help', fontSize: '0.7rem', padding: '1px 5px', display: 'inline-flex', alignItems: 'center' }}
                              >
                                <AlertTriangle size={12} /> Seguimiento crítico
                              </span>
                            )}
                            {alertasMap[s.id_alumno]?.nivel === 'preventiva' && (
                              <span
                                className="severity-badge severity-badge--leve"
                                title={`${alertasMap[s.id_alumno].atrasos} atrasos registrados; racha actual de ${alertasMap[s.id_alumno].racha_atrasos}`}
                                style={{ cursor: 'help', fontSize: '0.7rem', padding: '1px 5px', display: 'inline-flex', alignItems: 'center' }}
                              >
                                <BellRing size={12} /> Seguimiento preventivo
                              </span>
                            )}
                          </div>
                        </td>
                               <td data-label="Curso">{s.grade || 'Sin Curso'}</td>
                               <td data-label="Rol">
                                 <span style={{ fontSize: '0.8rem', padding: '3px 8px', borderRadius: '8px', background: s.rol === 'Estudiante' ? 'rgba(59,130,246,0.1)' : 'rgba(245,158,11,0.1)', color: s.rol === 'Estudiante' ? '#3b82f6' : '#f59e0b' }}>
                                   {s.rol}
                                 </span>
                               </td>
                               <td style={{textAlign: 'center'}} data-label="Estado">
                                 <span className={`students-badge ${s.activo ? 'badge-active' : 'badge-inactive'}`}>
                                   {s.activo ? 'Activa' : 'Retirado'}
                                 </span>
                               </td>
                               <td style={{textAlign: 'right'}} data-label="Acción">
                                 <button onClick={() => openDetails(s.id_alumno)} className="students-ficha-btn">
                                   Ver Ficha
                                 </button>
                               </td>
                             </tr>
                           ))}
                         </tbody>
                       </table>
                     </div>
                   ) : (
                     <p style={{margin: 0, color: 'var(--text-light)', fontSize: '0.9rem', fontStyle: 'italic'}}>No se encontraron registros coincidentes.</p>
                   )}
                 </div>
               );
             })()}

             {(() => {
                const allCourses = Object.keys(courseGroups).sort().filter(c => c.toLowerCase().includes(courseSearch.toLowerCase()));
                const totalCoursePages = Math.ceil((allCourses.length + 1) / COURSE_PAGE_SIZE);
                const pagedCourses = coursePage === 1
                  ? allCourses.slice(0, COURSE_PAGE_SIZE - 1)
                  : allCourses.slice((coursePage - 1) * COURSE_PAGE_SIZE - 1, coursePage * COURSE_PAGE_SIZE - 1);
                return (
                  <>
                    <div className="students-course-grid" data-tour="course-selector">
                      {coursePage === 1 && (
                      <button
                        type="button"
                        className="hub-module students-course-option students-course-option--all"
                        onClick={() => selectCourse('Toda La Matrícula')}
                      >
                        <Users size={32} color="#3b82f6" style={{marginBottom: '10px'}}/>
                        <h3 className="hub-module-title">Matrícula Completa</h3>
                        <p className="hub-module-desc">Padrón total del Liceo ({students.length} miembros)</p>
                      </button>
                      )}

                      {pagedCourses.map(curso => (
                       <button
                         type="button"
                         key={curso}
                         className="hub-module students-course-option"
                         onClick={() => selectCourse(curso)}
                       >
                         <GraduationCap size={32} color="var(--primary)" style={{marginBottom: '10px'}}/>
                         <h3 className="hub-module-title">{curso}</h3>
                         <p className="hub-module-desc">{courseGroups[curso].length} Miembros registrados</p>
                       </button>
                      ))}
                    </div>
                    {totalCoursePages > 1 && (
                      <div className="pagination" style={{marginTop: '20px'}}>
                        <button className="pagination-btn" disabled={coursePage === 1} onClick={() => setCoursePage(p => p - 1)}>← Anterior</button>
                        <span className="pagination-info">Pág {coursePage} de {totalCoursePages} · {allCourses.length} cursos</span>
                        <button className="pagination-btn" disabled={coursePage === totalCoursePages} onClick={() => setCoursePage(p => p + 1)}>Siguiente →</button>
                      </div>
                    )}
                  </>
                );
             })()}
          </div>
        ) : activeSection === 'listado' ? (
          <div className="fade-in">
             <div className="students-filter-row" data-tour="student-search">
               <div className="students-search" style={{flex: '1', minWidth: '220px'}}>
                 <Search size={16} />
                 <input
                   type="text"
                   placeholder={`Buscar en ${selectedCourse}...`}
                   value={searchTerm}
                   onChange={(e) => setSearchTerm(e.target.value)}
                 />
               </div>
               <AppSelect ariaLabel="Filtrar por estado" value={filterEstado} onChange={setFilterEstado} options={[{ value: '', label: 'Estado: todos' }, { value: 'activo', label: 'Vigentes' }, { value: 'inactivo', label: 'Retirados' }]} />
               <AppSelect ariaLabel="Filtrar por rol" value={filterRol} onChange={setFilterRol} options={[{ value: '', label: 'Rol: todos' }, { value: 'Estudiante', label: 'Estudiante' }, { value: 'Admin', label: 'Admin' }, { value: 'Profesor(a)', label: 'Profesor(a)' }, { value: 'Asistente de educación', label: 'Asistente de educación' }]} />
             </div>

             <div className="students-table-wrap" data-tour="student-list">
               <table className="students-table students-table--cards">
                 <thead>
                   <tr>
                     <th>Identificador</th>
                     <th>Nombre Completo</th>
                     {selectedCourse === 'Toda La Matrícula' && <th>Curso</th>}
                     <th>Rol</th>
                     <th style={{textAlign: 'center'}}>Estado</th>
                     <th style={{textAlign: 'right'}}>Acción</th>
                   </tr>
                 </thead>
                 <tbody>
                    {paginatedStudents.map(s => (
                      <tr key={s.id_alumno}>
                        <td className="students-cell-mono" data-label={getStudentIdentifierLabel(s)}>{getStudentIdentifier(s)}</td>
                        <td className="students-cell-name" data-label="Nombre">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                            <span>{s.nombres} {s.paterno} {s.materno}</span>
                            <StudentOriginBadge student={s} />
                            {alertasMap[s.id_alumno]?.nivel === 'critica' && (
                              <span
                                className="severity-badge severity-badge--grave"
                                title={`${alertasMap[s.id_alumno].atrasos} atrasos registrados en los últimos 30 días, ${alertasMap[s.id_alumno].graves} graves`}
                                style={{ cursor: 'help', fontSize: '0.7rem', padding: '1px 5px', display: 'inline-flex', alignItems: 'center' }}
                              >
                                <AlertTriangle size={12} /> Seguimiento crítico
                              </span>
                            )}
                            {alertasMap[s.id_alumno]?.nivel === 'preventiva' && (
                              <span
                                className="severity-badge severity-badge--leve"
                                title={`${alertasMap[s.id_alumno].atrasos} atrasos registrados; racha actual de ${alertasMap[s.id_alumno].racha_atrasos}`}
                                style={{ cursor: 'help', fontSize: '0.7rem', padding: '1px 5px', display: 'inline-flex', alignItems: 'center' }}
                              >
                                <BellRing size={12} /> Seguimiento preventivo
                              </span>
                            )}
                          </div>
                        </td>
                        {selectedCourse === 'Toda La Matrícula' && <td data-label="Curso">{s.grade || 'Sin Curso'}</td>}
                       <td data-label="Rol">
                         <span style={{ fontSize: '0.8rem', padding: '3px 8px', borderRadius: '8px', background: s.rol === 'Estudiante' ? 'rgba(59,130,246,0.1)' : 'rgba(245,158,11,0.1)', color: s.rol === 'Estudiante' ? '#3b82f6' : '#f59e0b' }}>
                           {s.rol}
                         </span>
                       </td>
                       <td style={{textAlign: 'center'}} data-label="Estado">
                          <span className={`students-badge ${s.activo ? 'badge-active' : 'badge-inactive'}`}>
                            {s.activo ? 'Activa' : 'Retirado'}
                          </span>
                       </td>
                       <td style={{textAlign: 'right'}} data-label="Acción">
                          <button onClick={() => openDetails(s.id_alumno)} className="students-ficha-btn">
                            Ver Ficha
                          </button>
                       </td>
                     </tr>
                   ))}
                 </tbody>
               </table>
               {filtered.length === 0 && <p style={{textAlign: 'center', padding: '20px', color: 'var(--text-light)'}}>No hay resultados coincidentes en esta nómina.</p>}
               {filtered.length > 0 && (
                 <div className="pagination">
                   <button className="pagination-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Anterior</button>
                   <span className="pagination-info">Página {page} de {stuTotalPages} · {filtered.length} registros</span>
                   <button className="pagination-btn" disabled={page === stuTotalPages} onClick={() => setPage(p => p + 1)}>Siguiente →</button>
                   <AppSelect ariaLabel="Registros por página" value={String(pageSize)} onChange={(value) => { setPageSize(Number(value)); setPage(1); }} options={[10, 20, 50, 100].map((number) => ({ value: String(number), label: `${number} por página` }))} />
                 </div>
               )}
             </div>
          </div>
        ) : activeSection === 'governance' ? (
          <div className="fade-in">
            <StudentGovernancePanel
              onOpenStudent={openDetails}
              canManage={canManage}
              canExport={canExportStudents}
              canExportSensitive={canExportSensitiveStudents}
            />
          </div>
        ) : activeSection === 'carga' ? (
          <div className="fade-in">
            <div className="students-import-panel">
              <h3 style={{margin: 0, marginBottom: '8px', color: 'var(--text-dark)', display: 'flex', gap: '8px', alignItems: 'center'}}>
                <FileSpreadsheet size={18} /> Cargar Planilla ERP (`Usuarios`)
              </h3>
              <p style={{color: 'var(--text-light)', marginBottom: '12px', fontSize: '0.9rem'}}>
                Seleccione el archivo Excel exportado desde el ERP. Primero se revisarán cursos,
                duplicados y filas inválidas. Nada se guardará hasta que confirme la previsualización.
                Las columnas de contraseña se descartan y nunca se crean cuentas de acceso.
              </p>

              <div className="student-import-mode" role="group" aria-label="Alcance de la planilla">
                <button
                  type="button"
                  data-selected={importMode === 'PARCIAL' || undefined}
                  onClick={() => changeImportMode('PARCIAL')}
                  disabled={syncing}
                >
                  <strong>Actualización parcial</strong>
                  <span>Quien no aparezca en el archivo conserva su matrícula vigente.</span>
                </button>
                <button
                  type="button"
                  data-selected={importMode === 'COMPLETA' || undefined}
                  onClick={() => changeImportMode('COMPLETA')}
                  disabled={syncing}
                >
                  <strong>Nómina oficial completa</strong>
                  <span>Detecta estudiantes ausentes y propone su retiro antes de confirmar.</span>
                </button>
              </div>

              <div className="students-import-actions">
                <label className="pagination-btn students-import-select">
                  <Upload size={16} /> Seleccionar Archivo Excel
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleExcelUpload}
                    style={{display: 'none'}}
                  />
                </label>

                <button
                  className="pagination-btn students-import-submit"
                  onClick={syncExcelWithDatabase}
                  disabled={!canConfirmImport || syncing}
                >
                  {syncing ? <RefreshCw size={16} className="spin" /> : <Database size={16} />}
                  {syncing ? 'Sincronizando…' : 'Confirmar importación'}
                </button>
              </div>

              {excelFileName && (
                <p style={{marginTop: '10px', fontSize: '0.85rem', color: 'var(--text-light)'}}>
                  Planilla seleccionada: <strong style={{color: 'var(--text-dark)'}}>{excelFileName}</strong> ({excelRows.length} filas procesadas)
                </p>
              )}

              {uploadError && (
                <div className="login-error" style={{marginTop: '12px'}}>{uploadError}</div>
              )}

              {importPreview && (
                <div className="student-import-summary" aria-live="polite">
                  <div><strong>{importPreview.summary.total}</strong><span>filas revisadas</span></div>
                  <div><strong>{importPreview.summary.valid}</strong><span>listas</span></div>
                  <div><strong>{importPreview.summary.suggested}</strong><span>con equivalencia</span></div>
                  <div><strong>{importPreview.summary.unknown}</strong><span>curso desconocido</span></div>
                  {importPreview.summary.run_chile > 0 && (
                    <div>
                      <strong>{importPreview.summary.run_chile}</strong><span>RUN chilenos</span>
                    </div>
                  )}
                  {importPreview.summary.ipe_mineduc > 0 && (
                    <div>
                      <strong>{importPreview.summary.ipe_mineduc}</strong><span>IPE Mineduc</span>
                    </div>
                  )}
                  {importPreview.summary.documentos_extranjeros > 0 && (
                    <div>
                      <strong>{importPreview.summary.documentos_extranjeros}</strong><span>documentos extranjeros</span>
                    </div>
                  )}
                  {importPreview.summary.solo_id_erp > 0 && (
                    <div>
                      <strong>{importPreview.summary.solo_id_erp}</strong><span>solo con ID ERP</span>
                    </div>
                  )}
                  {importPreview.summary.without_course > 0 && (
                    <div>
                      <strong>{importPreview.summary.without_course}</strong><span>sin curso informado</span>
                    </div>
                  )}
                  {importPreview.summary.manual_links > 0 && (
                    <div className="has-manual-link">
                      <strong>{importPreview.summary.manual_links}</strong><span>se vincularán con ERP</span>
                    </div>
                  )}
                  <div className={importPreview.summary.rejected ? 'has-error' : ''}>
                    <strong>{importPreview.summary.rejected}</strong><span>rechazadas</span>
                  </div>
                </div>
              )}

              {createsNewCourses && (
                <label className="student-import-confirm">
                  <input
                    type="checkbox"
                    checked={confirmNewCourses}
                    onChange={(event) => setConfirmNewCourses(event.target.checked)}
                  />
                  <span>
                    <strong>Confirmo la creación de los cursos marcados como nuevos</strong>
                    <small>Esta acción solo afecta los nombres indicados en la tabla.</small>
                  </span>
                </label>
              )}

              {importMode === 'COMPLETA' && importPreview?.missing_students?.length > 0 && (
                <div className="student-import-missing">
                  <div>
                    <AlertTriangle size={20} />
                    <span>
                      <strong>{importPreview.missing_students.length} estudiantes vigentes no aparecen en la nómina</strong>
                      <small>Las altas manuales pendientes se conservan. Revise esta lista antes de retirar matrículas ERP.</small>
                    </span>
                  </div>
                  <details>
                    <summary>Ver retiros propuestos</summary>
                    <ul>
                      {importPreview.missing_students.map((student) => (
                        <li key={student.id_alumno}>
                          <strong>{student.nombre}</strong>
                          <span>{student.curso} · {getStudentIdentifierLabel(student)} {getStudentIdentifier(student)}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                  <label className="student-import-confirm">
                    <input
                      type="checkbox"
                      checked={confirmMissingDeactivation}
                      onChange={(event) => setConfirmMissingDeactivation(event.target.checked)}
                    />
                    <span>
                      <strong>Confirmo que esta es la nómina oficial completa</strong>
                      <small>Se cerrarán solamente las matrículas ERP indicadas en la lista.</small>
                    </span>
                  </label>
                </div>
              )}

              {syncResult && (
                <div className="students-sync-success">
                  <div><strong>Carga Finalizada Exitosamente</strong></div>
                  <div style={{marginTop: '6px', fontSize: '0.9rem'}}>Miembros nuevos: {syncResult.inserted} | Actualizados: {syncResult.updated} | Vinculados desde alta manual: {syncResult.linked_manual || 0} | Reactivados: {syncResult.reactivated || 0} | Omitidos sin cambios: {syncResult.unchanged}</div>
                  <div style={{marginTop: '4px', fontSize: '0.9rem'}}>Errores encontrados: {syncResult.errors?.length || 0}</div>
                </div>
              )}

              {syncResult?.errors?.length > 0 && (
                <div style={{marginTop: '12px', maxHeight: '160px', overflowY: 'auto', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '10px', padding: '10px', background: 'rgba(239,68,68,0.05)'}}>
                  {syncResult.errors.map((errorItem, idx) => (
                    <p key={`${errorItem.row}-${idx}`} style={{margin: '0 0 6px 0', color: '#f87171', fontSize: '0.85rem'}}>
                      Fila {errorItem.row}: {errorItem.message}
                    </p>
                  ))}
                </div>
              )}
            </div>

            {previewRows.length > 0 && (
              <div className="students-import-preview students-table-wrap">
                <table className="students-table students-table--cards students-import-table">
                  <thead>
                    <tr>
                      <th>Fila</th>
                      <th>Identificador</th>
                      <th>Nombre</th>
                      <th>Curso informado</th>
                      <th>Coincidencia</th>
                      <th>Revisión</th>
                      <th>Resolución</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.slice(0, 50).map((row) => (
                      <tr key={row.row}>
                        <td data-label="Fila">{row.row}</td>
                        <td data-label="Identificador" className="students-cell-mono">
                          <span>{getStudentIdentifierLabel(row)}</span>
                          <strong>
                            {row.rut_normalizado
                              ? `${row.rut_normalizado}${row.dv ? `-${row.dv}` : ''}`
                              : row.documento_erp || row.uuid_erp || '-'}
                          </strong>
                        </td>
                        <td data-label="Nombre" className="students-cell-name">{row.nombres || '-'}</td>
                        <td data-label="Curso informado">{row.curso_origen || '-'}</td>
                        <td data-label="Coincidencia">
                          <span className={`student-import-match match-${String(row.reconciliation?.code || 'NUEVO_ERP').toLowerCase()}`}>
                            {row.reconciliation?.label || 'Nuevo desde ERP'}
                          </span>
                          {row.existing_student && (
                            <small className="student-import-existing">
                              {row.existing_student.nombre}
                              {row.existing_student.curso ? ` · ${row.existing_student.curso}` : ''}
                            </small>
                          )}
                        </td>
                        <td data-label="Revisión">
                          <span className={`student-import-status status-${row.status.toLowerCase()}`}>
                            {row.status === 'VALIDA' && (row.curso_origen ? 'Curso reconocido' : 'Identidad ERP reconocida; sin curso')}
                            {row.status === 'EQUIVALENCIA_SUGERIDA' && `Posible: ${row.suggestion?.nombre_curso}`}
                            {row.status === 'CURSO_DESCONOCIDO' && 'Curso desconocido'}
                            {row.status === 'DUPLICADA_ARCHIVO' && 'RUT duplicado'}
                            {row.status === 'CONFLICTO_IDENTIDAD' && (row.errors?.join(' ') || 'Conflicto de identidad')}
                            {['COLISION_UUID_RUT', 'COLISION_IDENTIFICADORES'].includes(row.status)
                              && (row.errors?.join(' ') || 'Colisión entre identificadores')}
                            {row.status === 'FICHA_INACTIVA_REAPARECE' && (row.errors?.join(' ') || 'Ficha inactiva en la nómina')}
                            {row.status === 'RECHAZADA' && (row.errors?.join(' ') || 'Fila rechazada')}
                          </span>
                          {row.field_comparison?.length > 0 && (
                            <details className="student-import-field-comparison">
                              <summary>Comparar campos</summary>
                              <div>
                                {row.field_comparison.map((field) => (
                                  <p key={field.field} data-decision={field.decision}>
                                    <strong>{field.label}</strong>
                                    <span>Actual: {field.current || 'Sin dato'}</span>
                                    <span>ERP: {field.incoming || 'Sin dato'}</span>
                                    <em>{field.decision.replaceAll('_', ' ').toLowerCase()}</em>
                                  </p>
                                ))}
                              </div>
                            </details>
                          )}
                        </td>
                        <td data-label="Resolución">
                          <div className="student-import-resolution-stack">
                          {['VALIDA', 'FICHA_INACTIVA_REAPARECE'].includes(row.status) ? (
                            <span className="student-import-resolved">{row.course?.nombre_curso}</span>
                          ) : ['EQUIVALENCIA_SUGERIDA', 'CURSO_DESCONOCIDO'].includes(row.status) ? (
                            <AppSelect
                              ariaLabel={`Resolución del curso de la fila ${row.row}`}
                              value={courseResolutions[row.curso_key]?.action === 'create'
                                ? '__CREATE__'
                                : String(courseResolutions[row.curso_key]?.course_id || '')}
                              onChange={(value) => resolveImportedCourse(row, value)}
                              options={[
                                { value: '', label: 'Resolver curso…' },
                                ...(importPreview?.courses || []).map((course) => ({
                                  value: String(course.id_curso),
                                  label: course.nombre_curso
                                })),
                                { value: '__CREATE__', label: `Crear “${row.curso_origen}”` }
                              ]}
                            />
                          ) : row.status === 'CONFLICTO_IDENTIDAD' ? (
                            <label className="student-import-identity-confirm">
                              <input
                                type="checkbox"
                                checked={identityResolutions[String(row.row)] === (
                                  row.inactive_reappearance ? 'CONFIRMAR_Y_REACTIVAR' : 'CONFIRMAR_MISMA_PERSONA'
                                )}
                                onChange={(event) => setIdentityResolutions((current) => ({
                                  ...current,
                                  [String(row.row)]: event.target.checked
                                    ? (row.inactive_reappearance ? 'CONFIRMAR_Y_REACTIVAR' : 'CONFIRMAR_MISMA_PERSONA')
                                    : undefined
                                }))}
                              />
                              <span>
                                {row.inactive_reappearance
                                  ? 'Revisé la identidad y autorizo reactivar la misma ficha'
                                  : 'Revisé los campos y confirmo que es la misma persona'}
                              </span>
                            </label>
                          ) : (
                            <span className="student-import-blocked">Corrija el archivo y vuelva a cargarlo</span>
                          )}
                          {row.inactive_reappearance && row.status !== 'CONFLICTO_IDENTIDAD' && (
                            <label className="student-import-identity-confirm">
                              <input
                                type="checkbox"
                                checked={identityResolutions[String(row.row)] === 'REACTIVAR_FICHA'}
                                onChange={(event) => setIdentityResolutions((current) => ({
                                  ...current,
                                  [String(row.row)]: event.target.checked ? 'REACTIVAR_FICHA' : undefined
                                }))}
                              />
                              <span>Comprobé la reincorporación y autorizo reactivar esta ficha</span>
                            </label>
                          )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {previewRows.length > 50 && (
                  <p style={{padding: '12px', color: 'var(--text-light)', fontSize: '0.85rem'}}>
                    Previsualizando primeras 50 de {previewRows.length} filas.
                  </p>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="fade-in guardian-import" data-tour="guardian-import">
            <section className="guardian-import__intro">
              <div>
                <span className="section-kicker">Ficha institucional separada</span>
                <h2>Apoderados y personas autorizadas</h2>
                <p>
                  Esta carga vincula personas con estudiantes para apoyar los retiros. No modifica alumnos,
                  cursos ni cuentas de ingreso al sistema.
                </p>
              </div>
              <ShieldCheck size={34} />
            </section>

            <section className="guardian-import__workflow">
              <div className="guardian-import__step">
                <span>1</span>
                <div><strong>Seleccionar ficha</strong><small>Excel con una fila por vínculo o columnas para apoderado principal y suplente.</small></div>
              </div>
              <div className="guardian-import__step">
                <span>2</span>
                <div><strong>Revisar previsualización</strong><small>Comprueba estudiante, RUT, nombre, relación y teléfono antes de continuar.</small></div>
              </div>
              <div className="guardian-import__step">
                <span>3</span>
                <div><strong>Sincronizar</strong><small>Actualiza coincidencias y agrega vínculos nuevos sin desactivar personas omitidas.</small></div>
              </div>
            </section>

            <section className="guardian-import__actions">
              <label className="pagination-btn students-import-select">
                <Upload size={17} /> Seleccionar ficha Excel
                <input type="file" accept=".xlsx,.xls" onChange={handleGuardianUpload} hidden />
              </label>
              <button
                type="button"
                className="pagination-btn students-import-submit"
                onClick={syncGuardians}
                disabled={!guardianRows.length || syncingGuardians}
              >
                {syncingGuardians ? <RefreshCw size={17} className="spin" /> : <Database size={17} />}
                {syncingGuardians ? 'Sincronizando…' : 'Confirmar sincronización'}
              </button>
              {guardianFileName && (
                <span className="guardian-import__file">
                  <FileSpreadsheet size={17} />
                  <strong>{guardianFileName}</strong>
                  <small>{guardianRows.length} vínculos detectados</small>
                </span>
              )}
            </section>

            {guardianError && <div className="login-error guardian-import__message">{guardianError}</div>}
            {guardianResult && (
              <div className="students-sync-success guardian-import__message">
                <strong>Ficha procesada con trazabilidad</strong>
                <span>
                  Nuevos: {guardianResult.created} · Actualizados: {guardianResult.updated} ·
                  Observaciones: {guardianResult.errors?.length || 0}
                </span>
              </div>
            )}

            {guardianResult?.errors?.length > 0 && (
              <section className="guardian-import__errors">
                <strong>Filas que necesitan corrección</strong>
                {guardianResult.errors.slice(0, 50).map((item, index) => (
                  <p key={`${item.row}-${index}`}>Fila {item.row}: {item.message}</p>
                ))}
              </section>
            )}

            {guardianRows.length > 0 && (
              <section className="guardian-import__preview">
                <header>
                  <div><span className="section-kicker">Antes de sincronizar</span><h3>Previsualización de vínculos</h3></div>
                  <span>Primeros {Math.min(guardianRows.length, 30)} de {guardianRows.length}</span>
                </header>
                <div className="students-table-wrap">
                  <table className="students-table students-table--cards">
                    <thead>
                      <tr>
                        <th>Fila</th>
                        <th>RUT estudiante</th>
                        <th>Persona autorizada</th>
                        <th>RUT apoderado</th>
                        <th>Relación</th>
                        <th>Teléfono</th>
                      </tr>
                    </thead>
                    <tbody>
                      {guardianRows.slice(0, 30).map((row, index) => (
                        <tr key={`${row.fila}-${row.documento}-${index}`}>
                          <td data-label="Fila">{row.fila}</td>
                          <td data-label="RUT estudiante" className="students-cell-mono">{row.alumno_rut || 'Falta dato'}</td>
                          <td data-label="Persona autorizada" className="students-cell-name">{row.nombre_completo || 'Falta dato'}</td>
                          <td data-label="RUT apoderado" className="students-cell-mono">{row.documento || 'Falta dato'}</td>
                          <td data-label="Relación">{row.parentesco_codigo.replaceAll('_', ' ')}</td>
                          <td data-label="Teléfono">{row.telefono || 'No informado'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <aside className="guardian-import__safety">
              <Shield size={21} />
              <div>
                <strong>Regla de seguridad</strong>
                <span>La ficha informa una autorización vigente, pero cada retiro sigue necesitando solicitud, decisión y entrega registrada.</span>
              </div>
            </aside>
          </div>
        )}

      </div>

      {selectedStudentId && (
        <StudentDetailDrawer
          closeDetails={closeDetails}
          loadingDetails={loadingDetails}
          studentDetails={studentDetails}
          canManage={canManage}
          canRegularizeIdentity={canRegularizeIdentity}
          canViewSensitiveIdentifiers={canViewSensitiveIdentifiers}
          onToggleSensitiveIdentifiers={(reveal) => openDetails(selectedStudentId, reveal)}
          openIdentityRegularization={openIdentityRegularization}
          openManualEditor={openManualEditor}
          formatNullable={formatNullable}
        />
      )}

      <StudentManualModal
        state={manualEditor}
        courses={courses}
        onClose={() => setManualEditor(null)}
        onSaved={handleManualSaved}
      />

      <StudentIdentityRegularizationModal
        state={identityRegularization}
        onClose={() => setIdentityRegularization(null)}
        onSaved={handleIdentityRegularized}
      />

    </div>;
}
