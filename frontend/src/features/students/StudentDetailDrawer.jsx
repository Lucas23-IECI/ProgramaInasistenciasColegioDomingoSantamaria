import { X, User, GraduationCap, Activity, Clock, Pencil, Archive, RotateCcw, Fingerprint, FileDown, History } from 'lucide-react';
import { StudentOriginBadge } from './StudentOriginBadge';
import { getStudentIdentifier, getStudentIdentifierLabel } from '../../utils/studentFormat';
import { API_URL } from '../../config';

const identifierTypeLabel = {
  RUN_CHILE: 'RUN chileno',
  IPE_MINEDUC: 'IPE Mineduc',
  PASAPORTE: 'Pasaporte',
  DNI: 'DNI extranjero',
  CEDULA: 'Cédula extranjera',
  DOCUMENTO_EXTRANJERO: 'Documento extranjero',
  ID_ERP: 'ID ERP',
  CODIGO_INTERNO: 'Código interno',
  CODIGO_BARRAS: 'Código de barras'
};

const supportTypeLabel = {
  CEDULA_IDENTIDAD: 'Cédula de identidad',
  CERTIFICADO_NACIMIENTO: 'Certificado de nacimiento',
  COMPROBANTE_REGULARIZACION: 'Comprobante de regularización',
  DOCUMENTO_MINEDUC: 'Documento Mineduc',
  OTRO: 'Otro respaldo institucional'
};

const validationResultLabel = {
  VERIFICADO: 'Regla oficial comprobada',
  ESTRUCTURAL: 'Formato comprobado',
  DECLARADO: 'Antecedente declarado',
  SISTEMA: 'Identificador interno',
  PENDIENTE: 'Revisión pendiente',
  RECHAZADO: 'Validación rechazada'
};

export function StudentDetailDrawer({
  closeDetails,
  loadingDetails,
  studentDetails,
  canManage,
  canRegularizeIdentity,
  openIdentityRegularization,
  openManualEditor,
  formatNullable
}) {
  return <div className="student-detail-overlay" onClick={closeDetails}>
           <div className="student-detail-drawer" role="dialog" aria-modal="true" aria-labelledby="student-detail-title" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={closeDetails}
                className="student-detail-close"
                aria-label="Cerrar ficha"
              >
                <X size={20} />
              </button>

              {loadingDetails ? (
                 <div className="loader" style={{margin: '50px auto'}}>Atrayendo ficha del miembro...</div>
              ) : studentDetails ? (
                 <div className="fade-in">
                    {/* Header with Avatar and Basic Info */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
                      <div style={{
                        width: '64px',
                        height: '64px',
                        borderRadius: '50%',
                        background: 'var(--primary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#ffffff',
                        fontSize: '1.4rem',
                        fontWeight: 'bold',
                        boxShadow: '0 4px 12px rgba(59, 130, 246, 0.25)'
                      }}>
                        {(() => {
                          const n = studentDetails.alumno.nombres ? studentDetails.alumno.nombres.trim().charAt(0) : '';
                          const p = studentDetails.alumno.paterno ? studentDetails.alumno.paterno.trim().charAt(0) : '';
                          return (n + p).toUpperCase() || '?';
                        })()}
                      </div>
                      <div>
                        <h3 id="student-detail-title" style={{ margin: 0, fontSize: '1.35rem', fontWeight: 700, color: 'var(--text-dark)' }}>
                          {studentDetails.alumno.nombres} {studentDetails.alumno.paterno} {studentDetails.alumno.materno || ''}
                        </h3>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '6px' }}>
                          <span style={{
                            background: 'rgba(59,130,246,0.12)',
                            color: 'var(--primary)',
                            padding: '3px 10px',
                            borderRadius: '8px',
                            fontSize: '0.75rem',
                            fontWeight: 600
                          }}>
                            {studentDetails.alumno.rol || 'Estudiante'}
                          </span>
                          <StudentOriginBadge student={studentDetails.alumno} />
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-light)', fontWeight: 500 }}>
                            {studentDetails.alumno.grade || 'Sin Curso'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Datos Personales Panel */}
                    <div style={{
                      background: 'var(--panel-bg)',
                      border: '1px solid var(--panel-border)',
                      borderRadius: '16px',
                      padding: '20px',
                      marginBottom: '20px',
                      boxShadow: '0 4px 20px rgba(0,0,0,0.02)'
                    }}>
                      <h4 style={{
                        margin: '0 0 16px 0',
                        color: 'var(--primary)',
                        fontSize: '0.92rem',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        borderBottom: '1px solid var(--panel-border)',
                        paddingBottom: '8px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em'
                      }}>
                        <User size={16} /> Datos Personales
                      </h4>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 20px', fontSize: '0.88rem' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span style={{ color: 'var(--text-light)', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em' }}>{getStudentIdentifierLabel(studentDetails.alumno)}</span>
                          <span style={{ color: 'var(--text-dark)', fontFamily: 'Space Mono, monospace', fontWeight: 600 }}>{getStudentIdentifier(studentDetails.alumno)}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span style={{ color: 'var(--text-light)', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em' }}>Estado</span>
                          <span style={{
                            color: studentDetails.alumno.activo ? '#10b981' : '#ef4444',
                            fontWeight: 600,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}>
                            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: studentDetails.alumno.activo ? '#10b981' : '#ef4444', display: 'inline-block' }} />
                            {studentDetails.alumno.activo ? 'Vigente' : 'Inactivo'}
                          </span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span style={{ color: 'var(--text-light)', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em' }}>Curso / Grado</span>
                          <span style={{ color: 'var(--text-dark)', fontWeight: 500 }}>{formatNullable(studentDetails.alumno.grade)}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span style={{ color: 'var(--text-light)', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em' }}>Sección / Letra</span>
                          <span style={{ color: 'var(--text-dark)', fontWeight: 500 }}>{formatNullable(studentDetails.alumno.seccion)}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span style={{ color: 'var(--text-light)', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em' }}>Código de Barra</span>
                          <span style={{ color: 'var(--primary)', fontFamily: 'Space Mono, monospace', fontWeight: 600 }}>{formatNullable(studentDetails.alumno.codigo_barra)}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span style={{ color: 'var(--text-light)', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em' }}>Género</span>
                          <span style={{ color: 'var(--text-dark)', fontWeight: 500 }}>{formatNullable(studentDetails.alumno.genero)}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span style={{ color: 'var(--text-light)', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em' }}>Fecha de Nacimiento</span>
                          <span style={{ color: 'var(--text-dark)', fontWeight: 500 }}>{studentDetails.alumno.fecha_nacimiento ? new Date(studentDetails.alumno.fecha_nacimiento).toLocaleDateString('es-CL') : 'N/D'}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span style={{ color: 'var(--text-light)', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em' }}>Usuario ERP</span>
                          <span style={{ color: 'var(--text-dark)', fontWeight: 500 }}>{formatNullable(studentDetails.alumno.nombre_usuario)}</span>
                        </div>
                      </div>
                    </div>

                    {Array.isArray(studentDetails.identificadores) && studentDetails.identificadores.length > 0 && (
                      <section className="student-identity-panel">
                        <header>
                          <div><Fingerprint size={17} /><span><strong>Identificadores de la ficha</strong><small>Todos permiten reconocer a la misma persona.</small></span></div>
                          {canRegularizeIdentity
                            && studentDetails.identificadores.some((identifier) => identifier.tipo === 'IPE_MINEDUC' && identifier.es_principal)
                            && (
                              <button type="button" onClick={openIdentityRegularization}>
                                Vincular nuevo RUN
                              </button>
                            )}
                        </header>
                        <div className="student-identity-list">
                          {studentDetails.identificadores.map((identifier) => (
                            <article key={identifier.id_identificador} data-previous={identifier.estado === 'ANTERIOR' || undefined}>
                              <span>{identifierTypeLabel[identifier.tipo] || identifier.tipo}</span>
                              <strong>{identifier.valor_mostrado}</strong>
                              <small>
                                {identifier.es_principal ? 'Principal' : identifier.estado === 'ANTERIOR' ? 'Anterior' : 'Adicional'}
                                {' · '}
                                Fuente {String(identifier.fuente || 'sistema').toLowerCase()}
                              </small>
                              {identifier.resultado_validacion && (
                                <small title={identifier.validador_id
                                  ? `${identifier.validador_id} v${identifier.validador_version || 'sin versión'}`
                                  : 'Sin regla versionada registrada'}>
                                  {validationResultLabel[identifier.resultado_validacion]
                                    || identifier.resultado_validacion}
                                </small>
                              )}
                            </article>
                          ))}
                        </div>
                      </section>
                    )}

                    {Array.isArray(studentDetails.regularizaciones_identidad) && studentDetails.regularizaciones_identidad.length > 0 && (
                      <section className="student-identity-history">
                        <h4><History size={16} /> Historial de regularización</h4>
                        {studentDetails.regularizaciones_identidad.map((regularization) => (
                          <article key={regularization.id_regularizacion}>
                            <div>
                              <strong>{regularization.identificador_anterior_mostrado} → {regularization.identificador_nuevo_mostrado}</strong>
                              <span>{regularization.motivo}</span>
                              <small>
                                {supportTypeLabel[regularization.tipo_respaldo] || regularization.tipo_respaldo}
                                {' · '}
                                {new Date(regularization.realizado_en).toLocaleString('es-CL')}
                              </small>
                            </div>
                            {canRegularizeIdentity && (
                              <a
                                href={`${API_URL}/students/${studentDetails.alumno.id_alumno}/identity-regularizations/${regularization.id_regularizacion}/document`}
                                download
                              >
                                <FileDown size={16} /> Respaldo
                              </a>
                            )}
                          </article>
                        ))}
                      </section>
                    )}

                    {Array.isArray(studentDetails.historial_matricula) && studentDetails.historial_matricula.length > 0 && (
                      <section className="student-enrollment-history">
                        <h4><GraduationCap size={16} /> Historial de matrícula</h4>
                        {studentDetails.historial_matricula.map((enrollment) => (
                          <div key={enrollment.id_matricula}>
                            <strong>{enrollment.nombre_curso}</strong>
                            <span>
                              Desde {new Date(`${String(enrollment.vigente_desde).slice(0, 10)}T12:00:00`).toLocaleDateString('es-CL')}
                              {' · '}
                              {enrollment.vigente_hasta
                                ? `hasta ${new Date(`${String(enrollment.vigente_hasta).slice(0, 10)}T12:00:00`).toLocaleDateString('es-CL')}`
                                : 'vigente'}
                            </span>
                            {enrollment.motivo_cambio && <small>{enrollment.motivo_cambio}</small>}
                          </div>
                        ))}
                      </section>
                    )}

                    {/* Contacto e Información Extra Panel */}
                    <div style={{
                      background: 'var(--panel-bg)',
                      border: '1px solid var(--panel-border)',
                      borderRadius: '16px',
                      padding: '20px',
                      boxShadow: '0 4px 20px rgba(0,0,0,0.02)'
                    }}>
                      <h4 style={{
                        margin: '0 0 16px 0',
                        color: 'var(--primary)',
                        fontSize: '0.92rem',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        borderBottom: '1px solid var(--panel-border)',
                        paddingBottom: '8px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em'
                      }}>
                        <Activity size={16} /> Contacto y Sincronización
                      </h4>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 20px', fontSize: '0.88rem' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', gridColumn: 'span 2' }}>
                          <span style={{ color: 'var(--text-light)', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em' }}>Email de Contacto</span>
                          <span style={{ color: 'var(--text-dark)', fontWeight: 500, wordBreak: 'break-all' }}>{formatNullable(studentDetails.alumno.email)}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span style={{ color: 'var(--text-light)', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em' }}>Teléfono</span>
                          <span style={{ color: 'var(--text-dark)', fontWeight: 500 }}>{formatNullable(studentDetails.alumno.telefono)}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span style={{ color: 'var(--text-light)', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em' }}>RUT Apoderado</span>
                          <span style={{ color: 'var(--text-dark)', fontFamily: 'Space Mono, monospace' }}>{formatNullable(studentDetails.alumno.rut_apoderado)}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', gridColumn: 'span 2' }}>
                          <span style={{ color: 'var(--text-light)', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em' }}>ID ERP (UUID)</span>
                          <span style={{ color: 'var(--text-light)', fontSize: '0.82rem', fontFamily: 'Space Mono, monospace', wordBreak: 'break-all' }}>{formatNullable(studentDetails.alumno.uuid_erp)}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', gridColumn: 'span 2' }}>
                          <span style={{ color: 'var(--text-light)', fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em' }}>Última Sincronización</span>
                          <span style={{ color: 'var(--text-dark)', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Clock size={12} style={{ color: 'var(--text-light)' }} />
                            {studentDetails.alumno.fecha_actualizacion ? new Date(studentDetails.alumno.fecha_actualizacion).toLocaleString('es-CL') : 'N/D'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {canManage && (
                      <div className="student-detail-actions">
                        <button type="button" className="is-secondary" onClick={() => openManualEditor('edit', studentDetails)}>
                          <Pencil size={17} /> Editar ficha
                        </button>
                        {studentDetails.alumno.activo ? (
                          <button type="button" className="is-danger" onClick={() => openManualEditor('retire', studentDetails)}>
                            <Archive size={17} /> Retirar matrícula
                          </button>
                        ) : (
                          <button type="button" className="is-reactivate" onClick={() => openManualEditor('reactivate', studentDetails)}>
                            <RotateCcw size={17} /> Reactivar matrícula
                          </button>
                        )}
                      </div>
                    )}

                 </div>
              ) : null}
           </div>
        </div>;
}
