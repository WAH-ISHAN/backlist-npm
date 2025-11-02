const fs = require('fs-extra');
const ejs = require('ejs');
const path = require('path');

async function renderAndWrite(templatePath, outPath, data) {
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

function getTemplatePath(subpath) {
  return path.join(__dirname, '..', 'templates', subpath);
}

module.exports = { renderAndWrite, getTemplatePath };