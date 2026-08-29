import { getApiErrorMessage } from './apiError.js';

export const isDuplicateRegistrationError = (error) => (
  error?.response?.data?.code === 'REGISTRO_DUPLICADO'
);

export const getRegistrationError = (error) => ({
  duplicate: isDuplicateRegistrationError(error),
  message: getApiErrorMessage(error, 'No fue posible registrar el ingreso.')
});
