import fs from 'node:fs';
import path from 'node:path';

const assetsDir = path.resolve('dist', 'assets');
if (!fs.existsSync(assetsDir)) throw new Error('Ejecuta npm run build antes de validar el presupuesto.');

const files = fs.readdirSync(assetsDir).map((name) => ({ name, bytes: fs.statSync(path.join(assetsDir, name)).size }));
const scripts = files.filter((file) => file.name.endsWith('.js'));
const styles = files.filter((file) => file.name.endsWith('.css'));
const largestScript = scripts.toSorted((a, b) => b.bytes - a.bytes)[0];
const totalScripts = scripts.reduce((sum, file) => sum + file.bytes, 0);
const totalStyles = styles.reduce((sum, file) => sum + file.bytes, 0);
const budgets = { largestScript: 550 * 1024, totalScripts: 1900 * 1024, totalStyles: 320 * 1024 };
const failures = [];
if (largestScript.bytes > budgets.largestScript) failures.push(`script mayor: ${largestScript.name}`);
if (totalScripts > budgets.totalScripts) failures.push('JavaScript total');
if (totalStyles > budgets.totalStyles) failures.push('CSS total');

console.log(JSON.stringify({
  largest_script_kb: Math.round(largestScript.bytes / 1024),
  total_javascript_kb: Math.round(totalScripts / 1024),
  total_css_kb: Math.round(totalStyles / 1024),
  budgets_kb: Object.fromEntries(Object.entries(budgets).map(([key, value]) => [key, Math.round(value / 1024)])),
}, null, 2));
if (failures.length) throw new Error(`Presupuesto excedido: ${failures.join(', ')}`);
