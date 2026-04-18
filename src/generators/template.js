import fs from 'fs-extra';
import ejs from 'ejs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function renderAndWrite(templatePath, outPath, data) {
  try {
    const tpl = await fs.readFile(templatePath, 'utf-8');
    const code = ejs.render(tpl, data || {}, { filename: templatePath }); // filename helps with EJS errors
    await fs.outputFile(outPath, code);
  } catch (err) {
    console.error('EJS render failed for:', templatePath);
    console.error('Data keys:', Object.keys(data || {}));
    throw err;
  }
}

export function getTemplatePath(subpath) {
  return path.join(__dirname, '..', 'templates', subpath);
}