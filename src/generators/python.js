const chalk = require('chalk');
const { execa } = require('execa');
const fs = require('fs-extra');
const path = require('path');
const { analyzeFrontend } = require('../analyzer');
const { renderAndWrite, getTemplatePath } = require('./template');

async function generatePythonProject(options) {
  const { projectDir, projectName, frontendSrcDir } = options;

  try {
    // --- Step 1: Analysis & Model Identification ---
    console.log(chalk.blue('  -> Analyzing frontend for Python (FastAPI) backend...'));
    const endpoints = await analyzeFrontend(frontendSrcDir);
    const modelsToGenerate = new Map();
    endpoints.forEach(ep => {
      if (ep.schemaFields && ep.controllerName !== 'Default' && !modelsToGenerate.has(ep.controllerName)) {
        modelsToGenerate.set(ep.controllerName, { name: ep.controllerName, fields: Object.entries(ep.schemaFields).map(([key, type]) => ({ name: key, type })) });
      }
    });

    // --- Step 2: Scaffold Base Python Project ---
    console.log(chalk.blue('  -> Scaffolding Python (FastAPI) project...'));
    const appDir = path.join(projectDir, 'app');
    const routesDir = path.join(appDir, 'routes');
    await fs.ensureDir(appDir);
    await fs.ensureDir(routesDir);

    // --- Step 3: Generate Files from Templates ---
    const controllers = Array.from(modelsToGenerate.keys());

    // Generate main.py
    await renderAndWrite(getTemplatePath('python-fastapi/main.py.ejs'), path.join(projectDir, 'app', 'main.py'), { projectName, controllers });

    // Generate requirements.txt
    await renderAndWrite(getTemplatePath('python-fastapi/requirements.txt.ejs'), path.join(projectDir, 'requirements.txt'), {});
    
    // Generate route file for each model
    for (const [modelName, modelData] of modelsToGenerate.entries()) {
        await renderAndWrite(
            getTemplatePath('python-fastapi/routes.py.ejs'),
            path.join(routesDir, `${modelName.toLowerCase()}_routes.py`),
            { modelName, schema: modelData }
        );
    }
    
    // --- Step 4: Setup Virtual Environment and Install Dependencies ---
    console.log(chalk.magenta('  -> Setting up virtual environment and installing dependencies...'));
    // Create a virtual environment
    await execa('python', ['-m', 'venv', 'venv'], { cwd: projectDir });
    
    // Determine the correct pip executable path based on OS
    const pipPath = process.platform === 'win32' 
        ? path.join('venv', 'Scripts', 'pip') 
        : path.join('venv', 'bin', 'pip');

    // Install dependencies using the virtual environment's pip
    await execa(path.join(projectDir, pipPath), ['install', '-r', 'requirements.txt'], { cwd: projectDir });
    
    console.log(chalk.green('  -> Python backend generation is complete!'));
    console.log(chalk.yellow('\nTo run your new Python backend:'));
    console.log(chalk.cyan('  1. Activate the virtual environment: `source venv/bin/activate` (or `venv\\Scripts\\activate` on Windows)'));
    console.log(chalk.cyan('  2. Start the server: `uvicorn app.main:app --reload`'));


  } catch (error) {
    // Improve error message for command not found
    if (error.code === 'ENOENT') {
        throw new Error(`'${error.command}' command not found. Please ensure Python and venv are installed and in your system's PATH.`);
    }
    throw error;
  }
}

module.exports = { generatePythonProject };