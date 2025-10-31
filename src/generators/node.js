const chalk = require('chalk');
const { execa } = require('execa');
const fs = require('fs-extra');
const path = require('path');
const { analyzeFrontend } = require('../analyzer');
const { renderAndWrite, getTemplatePath } = require('./template');

async function generateNodeProject(options) {
  const { projectDir, projectName, frontendSrcDir } = options;

  // --- Step 1: Analyze Frontend ---
  console.log(chalk.blue('  -> Analyzing frontend for API endpoints...'));
  const endpoints = await analyzeFrontend(frontendSrcDir);
  if (endpoints.length > 0) {
    console.log(chalk.green(`  -> Found ${endpoints.length} endpoints.`));
  } else {
    console.log(chalk.yellow('  -> No API endpoints found. A basic project will be created.'));
  }

  // --- Step 2: Scaffold Base Project ---
  console.log(chalk.blue('  -> Scaffolding Node.js (Express + TS) project...'));
  
  // Copy the base template directory which includes `src/server.ts`
  const baseDir = getTemplatePath('node-ts-express/base');
  await fs.copy(baseDir, projectDir);
  
  // --- Step 3: Generate Dynamic Files from Templates ---

  // Generate package.json
  await renderAndWrite(
    getTemplatePath('node-ts-express/partials/package.json.ejs'),
    path.join(projectDir, 'package.json'),
    { projectName }
  );

  // Generate routes.ts based on analyzed endpoints
  await renderAndWrite(
    getTemplatePath('node-ts-express/partials/routes.ts.ejs'),
    path.join(projectDir, 'src', 'routes.ts'),
    { endpoints }
  );
  
  // --- Step 4: Modify the copied server.ts to inject routes ---
  // THIS IS THE FIX: We do this AFTER the base files are copied.
  const serverFilePath = path.join(projectDir, 'src', 'server.ts');
  let serverFileContent = await fs.readFile(serverFilePath, 'utf-8');
  serverFileContent = serverFileContent.replace('// INJECT:ROUTES', `import apiRoutes from './routes';\napp.use(apiRoutes);`);
  await fs.writeFile(serverFilePath, serverFileContent);
  
  // --- Step 5: Install Dependencies ---
  console.log(chalk.magenta('  -> Installing dependencies (npm install)...'));
  await execa('npm', ['install'], { cwd: projectDir });

  // --- Step 6: Generate README ---
  await renderAndWrite(
    getTemplatePath('node-ts-express/partials/README.md.ejs'),
    path.join(projectDir, 'README.md'),
    { projectName }
  );
}

module.exports = { generateNodeProject };