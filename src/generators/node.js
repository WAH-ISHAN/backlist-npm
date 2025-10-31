const chalk = require('chalk');
const { execa } = require('execa');
const fs = require('fs-extra');
const path = require('path');
const { analyzeFrontend } = require('../analyzer');
const { renderAndWrite, getTemplatePath } = require('./template');

async function generateNodeProject(options) {
  const { projectDir, projectName, frontendSrcDir } = options;

  try {
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
    
    // Define paths clearly
    const baseDir = getTemplatePath('node-ts-express/base');
    const serverTemplatePath = path.join(baseDir, 'server.ts');
    const tsconfigTemplatePath = path.join(baseDir, 'tsconfig.json');
    
    const destSrcDir = path.join(projectDir, 'src');
    const serverDestPath = path.join(destSrcDir, 'server.ts');
    const tsconfigDestPath = path.join(projectDir, 'tsconfig.json');

    // Ensure destination directory exists
    await fs.ensureDir(destSrcDir);

    // Copy base files individually for clarity
    await fs.copy(serverTemplatePath, serverDestPath);
    await fs.copy(tsconfigTemplatePath, tsconfigDestPath);
    
    console.log(chalk.gray('    -> Base server.ts copied.'));
    
    // --- Step 3: Generate Dynamic Files ---
    await renderAndWrite(
      getTemplatePath('node-ts-express/partials/package.json.ejs'),
      path.join(projectDir, 'package.json'),
      { projectName }
    );
    await renderAndWrite(
      getTemplatePath('node-ts-express/partials/routes.ts.ejs'),
      path.join(destSrcDir, 'routes.ts'),
      { endpoints }
    );
    
    console.log(chalk.gray('    -> package.json and routes.ts generated.'));

    // --- Step 4: Modify the copied server.ts ---
    // Check if the file exists before reading
    if (!await fs.pathExists(serverDestPath)) {
      throw new Error(`Critical error: server.ts was not found at ${serverDestPath} after copy.`);
    }
    
    let serverFileContent = await fs.readFile(serverDestPath, 'utf-8');
    serverFileContent = serverFileContent.replace('// INJECT:ROUTES', `import apiRoutes from './routes';\napp.use(apiRoutes);`);
    await fs.writeFile(serverDestPath, serverFileContent);

    console.log(chalk.gray('    -> server.ts modified successfully.'));

    // --- Step 5: Install Dependencies ---
    console.log(chalk.magenta('  -> Installing dependencies (npm install)...'));
    await execa('npm', ['install'], { cwd: projectDir });

    // --- Step 6: Generate README ---
    await renderAndWrite(
      getTemplatePath('node-ts-express/partials/README.md.ejs'),
      path.join(projectDir, 'README.md'),
      { projectName }
    );

  } catch (error) {
    // Re-throw the error to be caught by the main CLI handler
    throw error;
  }
}

module.exports = { generateNodeProject };