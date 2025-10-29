const chalk = require('chalk');
const { execa } = require('execa');
const fs = require('fs-extra');
const path = require('path');
const { analyzeFrontend } = require('../analyzer');
const { renderAndWrite, getTemplatePath } = require('./template');

async function generateNodeProject(options) {
  const { projectDir, projectName, frontendSrcDir } = options;

  console.log(chalk.blue('  -> Analyzing frontend for API endpoints...'));
  const endpoints = await analyzeFrontend(frontendSrcDir);
  if (endpoints.length > 0) {
    console.log(chalk.green(`  -> Found ${endpoints.length} endpoints.`));
  } else {
    console.log(chalk.yellow('  -> No API endpoints found. A basic project will be created.'));
  }

  console.log(chalk.blue('  -> Scaffolding Node.js (Express + TS) project...'));
  
  const baseDir = getTemplatePath('node-ts-express/base');
  await fs.copy(baseDir, projectDir);
  
  await renderAndWrite(
    getTemplatePath('node-ts-express/partials/package.json.ejs'),
    path.join(projectDir, 'package.json'),
    { projectName }
  );

  await renderAndWrite(
    getTemplatePath('node-ts-express/partials/routes.ts.ejs'),
    path.join(projectDir, 'src', 'routes.ts'),
    { endpoints }
  );
  
  const serverFilePath = path.join(projectDir, 'src', 'server.ts');
  let serverFile = await fs.readFile(serverFilePath, 'utf-8');
  serverFile = serverFile.replace('// INJECT:ROUTES', `import apiRoutes from './routes';\napp.use(apiRoutes);`);
  await fs.writeFile(serverFilePath, serverFile);

  console.log(chalk.magenta('  -> Installing dependencies (npm install)...'));
  await execa('npm', ['install'], { cwd: projectDir });

  await renderAndWrite(
    getTemplatePath('node-ts-express/partials/README.md.ejs'),
    path.join(projectDir, 'README.md'),
    { projectName }
  );
}

module.exports = { generateNodeProject };