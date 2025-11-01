const chalk = require('chalk');
const { execa } = require('execa');
const fs = require('fs-extra');
const path = require('path');
const { analyzeFrontend } = require('../analyzer');
const { renderAndWrite, getTemplatePath } = require('./template');

/**
 * Generate a Node.js + TypeScript (Express) backend project automatically.
 */
async function generateNodeProject(options) {
  const { projectDir, projectName, frontendSrcDir } = options;

  try {
    // --- Step 1: Analyze Frontend ---
    console.log(chalk.blue(' -> Analyzing frontend for API endpoints...'));
    const endpoints = await analyzeFrontend(frontendSrcDir);

    if (endpoints.length > 0) {
      console.log(chalk.green(` -> Found ${endpoints.length} endpoints.`));
    } else {
      console.log(
        chalk.yellow(' -> No API endpoints found. A basic project will be created.')
      );
    }

    // --- Step 2: Scaffold Base Project ---
    console.log(chalk.blue('  -> Scaffolding Node.js (Express + TS) project...'));

    const baseDir = getTemplatePath('node-ts-express/base');
    const serverTemplatePath = path.join(baseDir, 'server.ts');
    const tsconfigTemplatePath = path.join(baseDir, 'tsconfig.json');

    const destSrcDir = path.join(projectDir, 'src');
    const serverDestPath = path.join(destSrcDir, 'server.ts');
    const tsconfigDestPath = path.join(projectDir, 'tsconfig.json');

    await fs.ensureDir(destSrcDir);
    await fs.copy(serverTemplatePath, serverDestPath);
    await fs.copy(tsconfigTemplatePath, tsconfigDestPath);

    console.log(chalk.gray('    -> Base server.ts and tsconfig.json copied.'));

    // --- Step 3: Generate package.json and routes.ts ---
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

    // --- Step 4: Analyze endpoints for models/controllers ---
    const modelsToGenerate = new Map();

    endpoints.forEach((ep) => {
      if (ep.schemaFields && !modelsToGenerate.has(ep.controllerName)) {
        modelsToGenerate.set(ep.controllerName, ep.schemaFields);
      }
    });

    // --- Step 5: Generate Models and Controllers if applicable ---
    if (modelsToGenerate.size > 0) {
      console.log(chalk.blue(' -> Generating database models and controllers...'));

      await fs.ensureDir(path.join(projectDir, 'src', 'models'));
      await fs.ensureDir(path.join(projectDir, 'src', 'controllers'));

      for (const [modelName, schema] of modelsToGenerate.entries()) {
        // Generate Model file
        await renderAndWrite(
          getTemplatePath('node-ts-express/partials/Model.ts.ejs'),
          path.join(projectDir, 'src', 'models', `${modelName}.model.ts`),
          { modelName, schema }
        );

        // Generate Controller file
        await renderAndWrite(
          getTemplatePath('node-ts-express/partials/Controller.ts.ejs'),
          path.join(projectDir, 'src', 'controllers', `${modelName}.controller.ts`),
          { modelName }
        );
      }

      console.log(chalk.gray('    -> Models and controllers generated.'));
    }

    // --- Step 6: Modify server.ts ---
    if (!(await fs.pathExists(serverDestPath))) {
      throw new Error(`Critical error: server.ts was not found at ${serverDestPath}.`);
    }

    let serverFileContent = await fs.readFile(serverDestPath, 'utf-8');
    serverFileContent = serverFileContent.replace(
      '// INJECT:ROUTES',
      `import apiRoutes from './routes';\napp.use(apiRoutes);`
    );
    await fs.writeFile(serverDestPath, serverFileContent);

    console.log(chalk.gray('    -> server.ts modified successfully.'));

    // --- Step 7: Install dependencies ---
    console.log(chalk.magenta('  -> Installing dependencies (npm install)...'));
    await execa('npm', ['install'], { cwd: projectDir });

    // --- Step 8: Add mongoose if models were generated ---
    if (modelsToGenerate.size > 0) {
      console.log(chalk.gray(' -> Adding Mongoose to dependencies...'));

      const packageJsonPath = path.join(projectDir, 'package.json');
      const packageJson = await fs.readJson(packageJsonPath);
      packageJson.dependencies = packageJson.dependencies || {};
      packageJson.dependencies['mongoose'] = '^7.5.0';

      await fs.writeJson(packageJsonPath, packageJson, { spaces: 2 });

      console.log(chalk.magenta('  -> Installing new dependencies (mongoose)...'));
      await execa('npm', ['install'], { cwd: projectDir });
    }

    // --- Step 9: Generate README ---
    await renderAndWrite(
      getTemplatePath('node-ts-express/partials/README.md.ejs'),
      path.join(projectDir, 'README.md'),
      { projectName }
    );

    console.log(chalk.green('✅ Project generation completed successfully!'));
  } catch (error) {
    console.error(chalk.red('❌ Error generating Node project:'), error);
    throw error; // Pass to main CLI handler
  }
}

module.exports = { generateNodeProject };
