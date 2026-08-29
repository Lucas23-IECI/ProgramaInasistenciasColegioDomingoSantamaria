export const dismissReleaseNotes = async (page) => {
  const dialog = page.getByRole('dialog').filter({ hasText: 'Novedades del sistema' });
  const appeared = await dialog.waitFor({ state: 'visible', timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  if (!appeared) return;
  await dialog.getByRole('button', { name: 'Cerrar novedades' }).click();
  await dialog.waitFor({ state: 'hidden' });
};
