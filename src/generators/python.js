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

    // Add a default User model if none was detected but auth might be added later
    if (!modelsToGenerate.has('User')) {
        modelsToGenerate.set('User', { name: 'User', fields: [{ name: 'name', type: 'String' }, { name: 'email', type: 'String'}] });
    }

    // --- Step 2: Scaffold Base Python Project Directories ---
    console.log(chalk.blue('  -> Scaffolding Python (FastAPI) project structure...'));
    const appDir = path.join(projectDir, 'app');
    const coreDir = path.join(appDir, 'core');
    const dbDir = path.join(appDir, 'db'); // For DB connection
    const modelsDir = path.join(appDir, 'models');
    const schemasDir = path.join(appDir, 'schemas');
    const routesDir = path.join(appDir, 'routers');
    
    await fs.ensureDir(appDir);
    await fs.ensureDir(coreDir);
    await fs.ensureDir(dbDir);
    await fs.ensureDir(modelsDir);
    await fs.ensureDir(schemasDir);
    await fs.ensureDir(routesDir);

    // --- Step 3: Generate All Python Files from Templates ---
    const controllers = Array.from(modelsToGenerate.keys());

    // Generate main application file
    await renderAndWrite(getTemplatePath('python-fastapi/main.py.ejs'), path.join(projectDir, 'app', 'main.py'), { projectName, controllers });
    // Generate dependency file
    await renderAndWrite(getTemplatePath('python-fastapi/requirements.txt.ejs'), path.join(projectDir, 'requirements.txt'), {});
    
    // Generate core files (config, security)
    await renderAndWrite(getTemplatePath('python-fastapi/app/core/config.py.ejs'), path.join(coreDir, 'config.py'), { projectName });
    await renderAndWrite(getTemplatePath('python-fastapi/app/core/security.py.ejs'), path.join(coreDir, 'security.py'), {});

    // Generate DB connection and base model
    await renderAndWrite(getTemplatePath('python-fastapi/app/db.py.ejs'), path.join(appDir, 'db.py'), {});

    // Generate model and schema files for User (for auth)
    await renderAndWrite(getTemplatePath('python-fastapi/app/models/user.py.ejs'), path.join(modelsDir, 'user.py'), {});
    await renderAndWrite(getTemplatePath('python-fastapi/app/schemas/user.py.ejs'), path.join(schemasDir, 'user.py'), {});

    // Generate router for auth
    await renderAndWrite(getTemplatePath('python-fastapi/app/routers/auth.py.ejs'), path.join(routesDir, 'auth.py'), {});

    // Generate router for each detected model
    for (const [modelName, modelData] of modelsToGenerate.entries()) {
        if(modelName.toLowerCase() !== 'user') { // User model is handled separately
            // In a full implementation, you'd have generic model/schema templates too
        }
        await renderAndWrite(getTemplatePath('python-fastapi/app/routers/model_routes.py.ejs'), path.join(routesDir, `${modelName.toLowerCase()}_routes.py`), { modelName, schema: modelData });
    }
    
    // --- Step 4: Setup Virtual Environment and Install Dependencies ---
    console.log(chalk.magenta('  -> Setting up virtual environment and installing dependencies...'));
    await execa('python', ['-m', 'venv', 'venv'], { cwd: projectDir });
    
    const pipPath = process.platform === 'win32' ? path.join('venv', 'Scripts', 'pip') : path.join('venv', 'bin', 'pip');
    await execa(path.join(projectDir, pipPath), ['install', '-r', 'requirements.txt'], { cwd: projectDir });
    
    // --- Step 5: Generate Docker and .env files ---
    await renderAndWrite(getTemplatePath('python-fastapi/Dockerfile.ejs'), path.join(projectDir, 'Dockerfile'), {});
    await renderAndWrite(getTemplatePath('python-fastapi/docker-compose.yml.ejs'), path.join(projectDir, 'docker-compose.yml'), { projectName });
    
    const envContent = `DATABASE_URL="postgresql://postgres:password@db:5432/${projectName}"\nJWT_SECRET="a_very_secret_key_change_this"`;
    await fs.writeFile(path.join(projectDir, '.env'), envContent);
    await fs.writeFile(path.join(projectDir, '.env.example'), envContent);


    console.log(chalk.green('  -> Python (FastAPI) backend generation is complete!'));
    console.log(chalk.yellow('\nTo run your new Python backend with Docker:'));
    console.log(chalk.cyan('  1. Make sure Docker Desktop is running.'));
    console.log(chalk.cyan('  2. Run: `docker-compose up --build`'));
    console.log(chalk.cyan('  3. API will be available at http://localhost:8000 and docs at http://localhost:8000/docs'));


  } catch (error) {
    if (error.code === 'ENOENT') {
        throw new Error(`'${error.command}' command not found. Please ensure Python and venv are installed and in your system's PATH.`);
    }
    throw error;
  }
}

module.exports = { generatePythonProject };