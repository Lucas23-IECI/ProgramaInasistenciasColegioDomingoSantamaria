'use strict';

const studentImportErrorMessage = (error) => {
  if (error?.code === '23505') {
    if (error.constraint === 'alumno_nombre_usuario_key') {
      return 'El nombre de usuario ERP ya pertenece a otra ficha. Corrige la columna Nombre Usuario o déjala vacía si no corresponde.';
    }
    return 'Un identificador de esta fila ya está asociado a otra ficha. Revisa los duplicados antes de volver a importarla.';
  }
  if (error?.code === '22001') return 'Un campo supera el largo permitido. Revisa los datos de esta fila y vuelve a intentarlo.';
  if (error?.code === '23503') return 'Una referencia de esta fila ya no está disponible. Actualiza la previsualización antes de importar nuevamente.';
  return 'No fue posible guardar esta fila. Sus cambios no se aplicaron. Revisa sus datos; si el problema continúa, informa el archivo y el número de fila al administrador.';
};

module.exports = { studentImportErrorMessage };
