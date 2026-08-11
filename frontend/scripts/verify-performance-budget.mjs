import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const distDir = path.resolve('dist');
const assetsDir = path.join(distDir, 'assets');
const indexPath = path.join(distDir, 'index.html');
if (!fs.existsSync(assetsDir) || !fs.existsSync(indexPath)) {
  throw new Error('Ejecuta npm run build antes de validar el presupuesto.');
}

const files = fs.readdirSync(assetsDir).map((name) => {
  const contents = fs.readFileSync(path.join(assetsDir, name));
  return { name, bytes: contents.length, gzipBytes: gzipSync(contents).length };
});
const byName = new Map(files.map((file) => [file.name, file]));
const scripts = files.filter((file) => file.name.endsWith('.js'));
const styles = files.filter((file) => file.name.endsWith('.css'));
const indexHtml = fs.readFileSync(indexPath, 'utf8');
const initialNames = [...indexHtml.matchAll(/(?:src|href)="\/assets\/([^"?]+\.(?:js|css))"/g)].map((match) => match[1]);
const initialAssets = [...new Set(initialNames)].map((name) => byName.get(name)).filter(Boolean);
const initialScripts = initialAssets.filter((file) => file.name.endsWith('.js'));
const initialStyles = initialAssets.filter((file) => file.name.endsWith('.css'));

const sum = (items, key) => items.reduce((total, item) => total + item[key], 0);
const kb = (value) => Math.round(value / 1024);
const largestScript = scripts.toSorted((a, b) => b.bytes - a.bytes)[0];
const metrics = {
  largestScript: largestScript.bytes,
  totalScripts: sum(scripts, 'bytes'),
  totalStyles: sum(styles, 'bytes'),
  initialScripts: sum(initialScripts, 'bytes'),
  initialStyles: sum(initialStyles, 'bytes'),
  initialScriptsGzip: sum(initialScripts, 'gzipBytes'),
  initialStylesGzip: sum(initialStyles, 'gzipBytes'),
};

// Los totales completos controlan crecimiento del producto. Los valores iniciales
// representan lo que el navegador solicita antes de abrir un módulo diferido.
const budgets = {
  largestScript: 550 * 1024,
  totalScripts: 2050 * 1024,
  totalStyles: 430 * 1024,
  initialScripts: 520 * 1024,
  initialStyles: 370 * 1024,
  initialScriptsGzip: 175 * 1024,
  initialStylesGzip: 70 * 1024,
};
const labels = {
  largestScript: `script mayor (${largestScript.name})`,
  totalScripts: 'JavaScript total diferido',
  totalStyles: 'CSS total',
  initialScripts: 'JavaScript inicial',
  initialStyles: 'CSS inicial',
  initialScriptsGzip: 'JavaScript inicial comprimido',
  initialStylesGzip: 'CSS inicial comprimido',
};
const failures = Object.keys(budgets).filter((key) => metrics[key] > budgets[key]).map((key) => labels[key]);

console.log(JSON.stringify({
  largest_script: { name: largestScript.name, kb: kb(metrics.largestScript) },
  complete_payload_kb: { javascript: kb(metrics.totalScripts), css: kb(metrics.totalStyles) },
  initial_payload_kb: {
    javascript: kb(metrics.initialScripts),
    css: kb(metrics.initialStyles),
    javascript_gzip: kb(metrics.initialScriptsGzip),
    css_gzip: kb(metrics.initialStylesGzip),
  },
  initial_assets: initialAssets.map((file) => file.name),
  budgets_kb: Object.fromEntries(Object.entries(budgets).map(([key, value]) => [key, kb(value)])),
}, null, 2));

if (failures.length) throw new Error(`Presupuesto excedido: ${failures.join(', ')}`);
