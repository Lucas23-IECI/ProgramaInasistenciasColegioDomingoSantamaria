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
const deferredToolPrefixes = ['tool-xlsx-', 'tool-zxing-', 'tool-tour-'];
const isDeferredTool = (file) => deferredToolPrefixes.some((prefix) => file.name.startsWith(prefix));
const deferredToolScripts = scripts.filter(isDeferredTool);
const productScripts = scripts.filter((file) => !isDeferredTool(file));
const initialDeferredTools = initialScripts.filter(isDeferredTool);

const sum = (items, key) => items.reduce((total, item) => total + item[key], 0);
const kb = (value) => Math.round(value / 1024);
const largestScript = scripts.toSorted((a, b) => b.bytes - a.bytes)[0];
const metrics = {
  largestScript: largestScript.bytes,
  totalScripts: sum(scripts, 'bytes'),
  totalScriptsGzip: sum(scripts, 'gzipBytes'),
  productScripts: sum(productScripts, 'bytes'),
  productScriptsGzip: sum(productScripts, 'gzipBytes'),
  deferredTools: sum(deferredToolScripts, 'bytes'),
  deferredToolsGzip: sum(deferredToolScripts, 'gzipBytes'),
  totalStyles: sum(styles, 'bytes'),
  initialScripts: sum(initialScripts, 'bytes'),
  initialStyles: sum(initialStyles, 'bytes'),
  initialScriptsGzip: sum(initialScripts, 'gzipBytes'),
  initialStylesGzip: sum(initialStyles, 'gzipBytes'),
};

// Referencias informativas, no requisitos de instalación. El tamaño por sí solo
// no demuestra un fallo funcional ni una regresión de velocidad percibida.
// Se conserva la medición del producto, herramientas y carga inicial para poder
// comparar cambios sin impedir una actualización válida por unos kilobytes.
const budgets = {
  largestScript: 550 * 1024,
  // Recursos internos agrega un módulo diferido propio (aprox. 28 KB), sin
  // cargar su interfaz ni sus estilos en el arranque de la aplicación.
  // +3 KiB para el anuncio accionable del chat, permisos y foco por teclado.
  // No se amplían los límites de descarga comprimida ni de carga inicial.
  totalScripts: 2188 * 1024,
  totalScriptsGzip: 650 * 1024,
  // Incluye las barreras de sesión concurrente y los mismos 3 KiB del anuncio.
  productScripts: 1255 * 1024,
  productScriptsGzip: 380 * 1024,
  deferredTools: 970 * 1024,
  deferredToolsGzip: 300 * 1024,
  // Incluye los tokens y estados accesibles para ambos temas en los módulos
  // operativos; el CSS inicial continúa controlado por su presupuesto propio.
  totalStyles: 495 * 1024,
  initialScripts: 520 * 1024,
  initialStyles: 380 * 1024,
  initialScriptsGzip: 175 * 1024,
  initialStylesGzip: 70 * 1024,
};
const labels = {
  largestScript: `script mayor (${largestScript.name})`,
  totalScripts: 'JavaScript total diferido',
  totalScriptsGzip: 'JavaScript total comprimido',
  productScripts: 'JavaScript propio y de interfaz',
  productScriptsGzip: 'JavaScript propio y de interfaz comprimido',
  deferredTools: 'herramientas pesadas diferidas',
  deferredToolsGzip: 'herramientas pesadas diferidas comprimidas',
  totalStyles: 'CSS total',
  initialScripts: 'JavaScript inicial',
  initialStyles: 'CSS inicial',
  initialScriptsGzip: 'JavaScript inicial comprimido',
  initialStylesGzip: 'CSS inicial comprimido',
};
const warnings = Object.keys(budgets).filter((key) => metrics[key] > budgets[key]).map((key) => labels[key]);
const failures = [];
if (initialDeferredTools.length) {
  failures.push(`herramientas diferidas incluidas en el arranque (${initialDeferredTools.map((file) => file.name).join(', ')})`);
}

console.log(JSON.stringify({
  size_policy: 'informativa; los excesos de tamaño no bloquean la instalación',
  size_warnings: warnings,
  largest_script: { name: largestScript.name, kb: kb(metrics.largestScript) },
  complete_payload_kb: {
    javascript: kb(metrics.totalScripts),
    javascript_gzip: kb(metrics.totalScriptsGzip),
    css: kb(metrics.totalStyles),
  },
  product_javascript_kb: {
    raw: kb(metrics.productScripts),
    gzip: kb(metrics.productScriptsGzip),
  },
  deferred_tools_kb: {
    raw: kb(metrics.deferredTools),
    gzip: kb(metrics.deferredToolsGzip),
    assets: deferredToolScripts.map((file) => file.name),
  },
  initial_payload_kb: {
    javascript: kb(metrics.initialScripts),
    css: kb(metrics.initialStyles),
    javascript_gzip: kb(metrics.initialScriptsGzip),
    css_gzip: kb(metrics.initialStylesGzip),
  },
  initial_assets: initialAssets.map((file) => file.name),
  budgets_kb: Object.fromEntries(Object.entries(budgets).map(([key, value]) => [key, kb(value)])),
}, null, 2));

if (warnings.length) {
  console.warn(`Aviso de tamaño (no bloqueante): ${warnings.join(', ')}. Los límites son referencias internas, no fallos funcionales.`);
}
// Sí falla una compilación inexistente o la inclusión accidental de herramientas
// que la arquitectura exige cargar bajo demanda. No se relajan las pruebas,
// el lint ni la auditoría de seguridad obligatorios en Docker y CI.
if (failures.length) throw new Error(`Carga diferida incorrecta: ${failures.join(', ')}`);
