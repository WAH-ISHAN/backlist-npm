const chalk = require('chalk');
const { execa } = require('execa');
const fs = require('fs-extra');
const path = require('path');
const { analyzeFrontend } = require('../analyzer');
const { renderAndWrite, getTemplatePath } = require('./template');

async function generateNodeProject(options) {
  const { projectDir, projectName, frontendSrcDir } = options;

  try {
    // --- Step 1: Analyze Frontend to get Endpoints and Schema Info ---
    console.log(chalk.blue('  -> Analyzing frontend for API endpoints...'));
    const endpoints = await analyzeFrontend(frontendSrcDir);
    if (endpoints.length > 0) {
      console.log(chalk.green(`  -> Found ${endpoints.length} endpoints.`));
    } else {
      console.log(chalk.yellow('  -> No API endpoints found. A basic project will be created.'));
    }

    // --- Step 2: Identify which Database Models to Generate ---
    const modelsToGenerate = new Map();
    endpoints.forEach(ep => {
      // If an endpoint has schemaFields and a valid controllerName, add it to our map.
      if (ep.schemaFields && ep.controllerName !== 'Default' && !modelsToGenerate.has(ep.controllerName)) {
        modelsToGenerate.set(ep.controllerName, ep.schemaFields);
      }
    });

    // --- Step 3: Scaffold Base Project Structure & Files ---
    console.log(chalk.blue('  -> Scaffolding Node.js (Express + TS) project...'));
    
    // Create the main source directory
    const destSrcDir = path.join(projectDir, 'src');
    await fs.ensureDir(destSrcDir);

    // Copy static base files
    await fs.copy(getTemplatePath('node-ts-express/base/server.ts'), path.join(destSrcDir, 'server.ts'));
    await fs.copy(getTemplatePath('node-ts-express/base/tsconfig.json'), path.join(projectDir, 'tsconfig.json'));
    
    // --- Step 4: Generate Dynamic Files (package.json, Models, Controllers) ---

    // Prepare package.json content (in memory)
    const packageJsonContent = JSON.parse(
      await ejs.renderFile(getTemplatePath('node-ts-express/partials/package.json.ejs'), { projectName })
    );

    // Conditionally add Mongoose if we are generating models
    if (modelsToGenerate.size > 0) {
      console.log(chalk.gray('    -> Preparing to add Mongoose to dependencies...'));
      packageJsonContent.dependencies['mongoose'] = '^7.5.0'; // Use a recent, stable version
    }

    // Write the final package.json to the disk
    await fs.writeJson(path.join(projectDir, 'package.json'), packageJsonContent, { spaces: 2 });
    
    // Generate Model and Controller files if any were found
    if (modelsToGenerate.size > 0) {
      console.log(chalk.blue('  -> Generating database models and controllers...'));
      await fs.ensureDir(path.join(destSrcDir, 'models'));
      await fs.ensureDir(path.join(destSrcDir, 'controllers'));

      for (const [modelName, schema] of modelsToGenerate.entries()) {
        // Generate Model File (e.g., models/User.model.ts)
        await renderAndWrite(
          getTemplatePath('node-ts-express/partials/Model.ts.ejs'),
          path.join(destSrcDir, 'models', `${modelName}.model.ts`),
          { modelName, schema }
        );
        // Generate Controller File (e.g., controllers/User.controller.ts)
        await renderAndWrite(
          getTemplatePath('node-ts-express/partials/Controller.ts.ejs'),
          path.join(destSrcDir, 'controllers', `${modelName}.controller.ts`),
          { modelName }
        );
      }
    }

    // --- Step 5: Generate the Smart Route File ---
    console.log(chalk.gray('    -> Generating dynamic routes...'));
    await renderAndWrite(
      getTemplatePath('node-ts-express/partials/routes.ts.ejs'),
      path.join(destSrcDir, 'routes.ts'),
      { endpoints } // Pass all endpoints to the template
    );
    
    // --- Step 6: Inject Routes into the Main Server File ---
    const serverDestPath = path.join(destSrcDir, 'server.ts');
    let serverFileContent = await fs.readFile(serverDestPath, 'utf-8');
    
    let dbConnectionCode = '';
    if (modelsToGenerate.size > 0) {
      dbConnectionCode = `
// --- Database Connection ---
import mongoose from 'mongoose';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/${projectName}';
mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Connected...'))
  .catch(err => console.error('MongoDB Connection Error:', err));
// -------------------------
`;
    }

    // Inject DB connection code after dotenv.config() and route loader
    serverFileContent = serverFileContent
      .replace("dotenv.config();", `dotenv.config();\n${dbConnectionCode}`)
      .replace('// INJECT:ROUTES', `import apiRoutes from './routes';\napp.use(apiRoutes);`);
      
    await fs.writeFile(serverDestPath, serverFileContent);

    // --- Step 7: Install All Dependencies at Once ---
    console.log(chalk.magenta('  -> Installing dependencies (npm install)... This might take a moment.'));
    await execa('npm', ['install'], { cwd: projectDir });

    // --- Step 8: Generate README ---
    await renderAndWrite(
      getTemplatePath('node-ts-express/partials/README.md.ejs'),
      path.join(projectDir, 'README.md'),
      { projectName }
    );

  } catch (error) {
    // Re-throw the error so it can be caught by the main CLI handler in index.js
    // This allows for centralized error message display and cleanup.
    throw error;
  }
}

module.exports = { generateNodeProject };