const fs = require('fs-extra');
const ejs = require('ejs');
const path = require('path');

function pascalCase(str) {
  return String(str || '')
    .replace(/[-_]+(.)/g, (_, c) => c.toUpperCase())
    .replace(/^\w/, c => c.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, '');
}

function camelCase(str) {
  const p = pascalCase(str);
  return p ? p.charAt(0).toLowerCase() + p.slice(1) : '';
}

function mapTsType(t) {
  const x = String(t || '').toLowerCase();
  if (x === 'number' || x === 'int' || x === 'integer' || x === 'float' || x === 'double') return 'number';
  if (x === 'boolean' || x === 'bool') return 'boolean';
  return 'string';
}

function mapMongooseType(t) {
  const x = String(t || '').toLowerCase();
  if (x === 'number' || x === 'int' || x === 'integer' || x === 'float' || x === 'double') return 'Number';
  if (x === 'boolean' || x === 'bool') return 'Boolean';
  return 'String';
}

async function renderAndWrite(templatePath, outPath, data) {
  const helpers = { pascalCase, camelCase, mapTsType, mapMongooseType };

  try {
    const tpl = await fs.readFile(templatePath, 'utf-8');
    const code = ejs.render(tpl, { ...(data || {}), ...helpers }, { filename: templatePath });

    // avoid rewriting identical content (useful in watch mode)
    const exists = await fs.pathExists(outPath);
    if (exists) {
      const current = await fs.readFile(outPath, 'utf-8');
      if (current === code) return;
    }

    await fs.outputFile(outPath, code.endsWith('\n') ? code : code + '\n');
  } catch (err) {
    console.error('EJS render failed for:', templatePath);
    console.error('Data keys:', Object.keys(data || {}));
    throw err;
  }
}

function getTemplatePath(subpath) {
  return path.join(__dirname, '..', 'templates', subpath);
}

module.exports = { renderAndWrite, getTemplatePath };