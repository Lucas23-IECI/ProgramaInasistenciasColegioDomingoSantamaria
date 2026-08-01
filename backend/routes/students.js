const { registerStudentRegistryRoutes } = require('./students/registry');
const { registerStudentImportRoutes } = require('./students/imports');
const { registerStudentManagementRoutes } = require('./students/management');

const registerStudentRoutes = (context) => {
  registerStudentRegistryRoutes(context);
  registerStudentImportRoutes(context);
  registerStudentManagementRoutes(context);
};

module.exports = { registerStudentRoutes };
