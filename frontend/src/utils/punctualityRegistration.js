export const isDuplicateRegistrationError = (error) => (
  error?.response?.data?.code === 'REGISTRO_DUPLICADO'
);

export const getRegistrationError = (error) => ({
  duplicate: isDuplicateRegistrationError(error),
  message: error?.response?.data?.message || 'Error al registrar. Intente nuevamente.'
});
