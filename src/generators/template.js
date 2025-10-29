const ejs = require('ejs');
const fs = require('fs-extra');
const path = require('path');

async function renderAndWrite(templatePath, destinationPath, data) {
  const template = await fs.readFile(templatePath, 'utf-8');
  const content = ejs.render(template, data);
  await fs.outputFile(destinationPath, content);
}

function getTemplatePath(subpath) {
  return path.join(__dirname, '..', 'templates', subpath);
}

module.exports = { renderAndWrite, getTemplatePath };