const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const [repo, origin, outDir] = process.argv.slice(2);
const { chromium, expect } = require(path.join(repo, 'frontend/node_modules/@playwright/test'));
const checks = [];
let browser;
(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  // No ignoreHTTPSErrors / --ignore-certificate-errors: Windows trust must work.
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const browserVersion = browser.version();
  const context = await browser.newContext({ viewport: { width: 1360, height: 920 } });
  const page = await context.newPage();
  const response = await page.goto(new URL('/login', origin).href);
  assert.equal(response.status(), 200); checks.push('Browser accepts native Windows CA without certificate bypass');
  await expect(page.getByRole('heading', { name: 'Iniciar sesión', exact: true })).toBeVisible();
  assert.equal(await page.evaluate(() => window.isSecureContext), true); checks.push('Real page is a secure context');
  await page.screenshot({ path: path.join(outDir, '01-https-login.png'), fullPage: true });
  await page.locator('#login-email').fill('admin@ldsm.local');
  await page.locator('#login-password').fill(process.env.LDSM_HTTPS_QA_PASSWORD);
  const loginResponse = page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/login' && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Ingresar al sistema' }).click();
  assert.equal((await loginResponse).status(), 200); checks.push('Login submitted from visible UI succeeds');
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
  const cookie = (await context.cookies()).find(c => c.name === 'token');
  assert.ok(cookie?.secure && cookie?.httpOnly && cookie?.sameSite === 'Strict'); checks.push('Browser receives Secure HttpOnly SameSite=Strict session');
  // Newly-created database correctly enforces initial password change; this is
  // not a navigation failure and is not bypassed to claim a completed account setup.
  await page.screenshot({ path: path.join(outDir, '02-authenticated.png'), fullPage: true });
  await page.reload();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/); checks.push('Authenticated state survives real page reload');
  const identity = await page.evaluate(async () => (await fetch('/api/auth/me')).status);
  assert.equal(identity, 200); checks.push('Authenticated identity request succeeds from real browser');
  await browser.close(); browser = undefined;
  const result = { passed: true, browser: 'Microsoft Edge', browserVersion, certificateBypass: false, checks, count: checks.length };
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(result, null, 2));
  process.stdout.write(JSON.stringify(result));
})().catch(async error => {
  if (browser) await browser.close();
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ passed: false, checks, error: error.message }, null, 2));
  process.stderr.write(error.message); process.exitCode = 1;
});
