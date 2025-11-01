const chalk = require('chalk');
const { execa } = require('execa');
const fs = require('fs-extra');
const path = require('path');
const { analyzeFrontend } = require('../analyzer');
const { renderAndWrite, getTemplatePath } = require('./template');

async function generateNodeProject(options) {
  const { projectDir, projectName, frontendSrcDir, addAuth } = options;

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
      if (ep.schemaFields && ep.controllerName !== 'Default' && !modelsToGenerate.has(ep.controllerName)) {
        modelsToGenerate.set(ep.controllerName, ep.schemaFields);
      }
    });

    // If auth is enabled, we MUST have a 'User' model.
    if (addAuth && !modelsToGenerate.has('User')) {
      console.log(chalk.yellow('  -> Authentication requires a "User" model. Creating a default one.'));
      modelsToGenerate.set('User', { name: 'String', email: 'String', password: 'String' });
    }

    // --- Step 3: Scaffold Base Project Structure & Files ---
    console.log(chalk.blue('  -> Scaffolding Node.js (Express + TS) project...'));
    const destSrcDir = path.join(projectDir, 'src');
    await fs.ensureDir(destSrcDir);
    await fs.copy(getTemplatePath('node-ts-express/base/server.ts'), path.join(destSrcDir, 'server.ts'));
    await fs.copy(getTemplatePath('node-ts-express/base/tsconfig.json'), path.join(projectDir, 'tsconfig.json'));
    
    // --- Step 4: Prepare and Write package.json ---
    const packageJsonContent = JSON.parse(
      await ejs.renderFile(getTemplatePath('node-ts-express/partials/package.json.ejs'), { projectName })
    );

    if (modelsToGenerate.size > 0 || addAuth) {
      packageJsonContent.dependencies['mongoose'] = '^7.5.0';
    }
    if (addAuth) {
      packageJsonContent.dependencies['jsonwebtoken'] = '^9.0.2';
      packageJsonContent.dependencies['bcryptjs'] = '^2.4.3';
      packageJsonContent.devDependencies['@types/jsonwebtoken'] = '^9.0.2';
      packageJsonContent.devDependencies['@types/bcryptjs'] = '^2.4.2';
    }
    await fs.writeJson(path.join(projectDir, 'package.json'), packageJsonContent, { spaces: 2 });
    
    // --- Step 5: Generate Models and Controllers ---
    if (modelsToGenerate.size > 0) {
      console.log(chalk.blue('  -> Generating database models and controllers...'));
      await fs.ensureDir(path.join(destSrcDir, 'models'));
      await fs.ensureDir(path.join(destSrcDir, 'controllers'));

      for (let [modelName, schema] of modelsToGenerate.entries()) {
        if (addAuth && modelName === 'User') {
          schema = { name: 'String', email: 'String', password: 'String', ...schema };
        }
        await renderAndWrite(
          getTemplatePath('node-ts-express/partials/Model.ts.ejs'),
          path.join(destSrcDir, 'models', `${modelName}.model.ts`),
          { modelName, schema }
        );
        await renderAndWrite(
          getTemplatePath('node-ts-express/partials/Controller.ts.ejs'),
          path.join(destSrcDir, 'controllers', `${modelName}.controller.ts`),
          { modelName }
        );
      }
    }
    
    // --- Step 6 (v3.0): Generate Authentication Boilerplate ---
    if (addAuth) {
        console.log(chalk.blue('  -> Generating authentication boilerplate...'));
        await fs.ensureDir(path.join(destSrcDir, 'routes'));
        await fs.ensureDir(path.join(destSrcDir, 'middleware'));

        await renderAndWrite(getTemplatePath('node-ts-express/partials/Auth.controller.ts.ejs'), path.join(destSrcDir, 'controllers', 'Auth.controller.ts'), {});
        await renderAndWrite(getTemplatePath('node-ts-express/partials/Auth.routes.ts.ejs'), path.join(destSrcDir, 'routes', 'Auth.routes.ts'), {});
        await renderAndWrite(getTemplatePath('node-ts-express/partials/Auth.middleware.ts.ejs'), path.join(destSrcDir, 'middleware', 'Auth.middleware.ts'), {});

        // Modify the User model to add password hashing
        const userModelPath = path.join(destSrcDir, 'models', 'User.model.ts');
        if (await fs.pathExists(userModelPath)) {
            let userModelContent = await fs.readFile(userModelPath, 'utf-8');
            if (!userModelContent.includes('bcryptjs')) {
                userModelContent = userModelContent.replace(`import mongoose, { Schema, Document } from 'mongoose';`, `import mongoose, { Schema, Document } from 'mongoose';\nimport bcrypt from 'bcryptjs';`);
                const preSaveHook = `
// Hash password before saving
UserSchema.pre('save', async function(next) {
  if (!this.isModified('password')) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});
`;
                userModelContent = userModelContent.replace(`// Create and export the Model`, `${preSaveHook}\n// Create and export the Model`);
                await fs.writeFile(userModelPath, userModelContent);
            }
        }
    }

    // --- Step 7: Generate the Main Route File ---
    console.log(chalk.gray('    -> Generating dynamic API routes...'));
    await renderAndWrite(getTemplatePath('node-ts-express/partials/routes.ts.ejs'), path.join(destSrcDir, 'routes.ts'), { endpoints, addAuth });
    
    // --- Step 8: Inject Logic into Main Server File ---
    let serverFileContent = await fs.readFile(path.join(destSrcDir, 'server.ts'), 'utf-8');
    
    let dbConnectionCode = '';
    if (modelsToGenerate.size > 0 || addAuth) {
      dbConnectionCode = `
// --- Database Connection ---
import mongoose from 'mongoose';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/${projectName}';
mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Connected...'))
  .catch(err => console.error('MongoDB Connection Error:', err));
// -------------------------
`;
    }

    let authRoutesInjector = '';
    if (addAuth) {
        authRoutesInjector = `import authRoutes from './routes/Auth.routes';\napp.use('/api/auth', authRoutes);\n\n`;
    }

    serverFileContent = serverFileContent
      .replace("dotenv.config();", `dotenv.config();\n${dbConnectionCode}`)
      .replace('// INJECT:ROUTES', `${authRoutesInjector}import apiRoutes from './routes';\napp.use('/api', apiRoutes);`); // Changed to /api
      
    await fs.writeFile(path.join(destSrcDir, 'server.ts'), serverFileContent);

    // --- Step 9: Install All Dependencies ---
    console.log(chalk.magenta('  -> Installing all dependencies... This might take a moment.'));
    await execa('npm', ['install'], { cwd: projectDir });

    // --- Step 10: Generate Final Files (README, .env.example) ---
    await renderAndWrite(
      getTemplatePath('node-ts-express/partials/README.md.ejs'),
      path.join(projectDir, 'README.md'),
      { projectName }
    );
    
    if (addAuth) {
        const envExampleContent = `PORT=8000\nMONGO_URI=mongodb://127.0.0.1:27017/${projectName}\nJWT_SECRET=your_super_secret_jwt_key_123`;
        await fs.writeFile(path.join(projectDir, '.env.example'), envExampleContent);
    }


  } catch (error) {
    throw error;
  }
}

module.exports = { generateNodeProject };