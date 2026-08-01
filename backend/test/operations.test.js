const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { readBackupStatus } = require('../routes/operations');

test('interpreta el archivo real de estado del respaldo', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ldsm-backup-status-'));
  const statusPath = path.join(directory, 'last-success.env');
  const now = new Date().toISOString();
  await fs.writeFile(statusPath, [
    `timestamp=${now}`,
    'database=ldsm_db_prueba.dump',
    'documents=ldsm_documentos_prueba.tar.gz',
    'manifest=ldsm_prueba.sha256'
  ].join('\n'));
  const previous = process.env.BACKUP_STATUS_FILE;
  process.env.BACKUP_STATUS_FILE = statusPath;
  try {
    const status = await readBackupStatus();
    assert.equal(status.available, true);
    assert.equal(status.healthy, true);
    assert.equal(status.database_file, 'ldsm_db_prueba.dump');
    assert.equal(status.documents_file, 'ldsm_documentos_prueba.tar.gz');
  } finally {
    if (previous === undefined) delete process.env.BACKUP_STATUS_FILE;
    else process.env.BACKUP_STATUS_FILE = previous;
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('informa estado no saludable cuando el archivo no existe', async () => {
  const previous = process.env.BACKUP_STATUS_FILE;
  process.env.BACKUP_STATUS_FILE = path.join(os.tmpdir(), `ausente-${Date.now()}.env`);
  try {
    const status = await readBackupStatus();
    assert.equal(status.available, false);
    assert.equal(status.healthy, false);
  } finally {
    if (previous === undefined) delete process.env.BACKUP_STATUS_FILE;
    else process.env.BACKUP_STATUS_FILE = previous;
  }
});
