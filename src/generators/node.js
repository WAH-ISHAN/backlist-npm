const chalk = require('chalk');
const { execa } = require('execa');
const fs = require('fs-extra');
const path = require('path');
const ejs = require('ejs');
const { analyzeFrontend } = require('../analyzer');
const { renderAndWrite, getTemplatePath } = require('./template');

async function generateNodeProject(options) {
  const { projectDir, projectName, dbType, addAuth, addSeeder, extraFeatures = [] } = options;
  const port = 8000;

  try {
    // --- Step 1: Analysis & Model Identification ---
    console.log(chalk.blue('  -> Analyzing frontend for API endpoints...'));
    const endpoints = await analyzeFrontend(options.frontendSrcDir);
    const modelsToGenerate = new Map();
    endpoints.forEach(ep => {
      if (ep.schemaFields && ep.controllerName !== 'Default' && !modelsToGenerate.has(ep.controllerName)) {
        modelsToGenerate.set(ep.controllerName, { name: ep.controllerName, fields: Object.entries(ep.schemaFields).map(([key, type]) => ({ name: key, type, isUnique: key === 'email' })) });
      }
    });
    if (addAuth && !modelsToGenerate.has('User')) {
      modelsToGenerate.set('User', { name: 'User', fields: [{ name: 'name', type: 'String' }, { name: 'email', type: 'String', isUnique: true }, { name: 'password', type: 'String' }] });
    }
    
    // --- Step 2: Base Scaffolding ---
    console.log(chalk.blue('  -> Scaffolding Node.js project...'));
    const destSrcDir = path.join(projectDir, 'src');
    await fs.ensureDir(destSrcDir);
    await fs.copy(getTemplatePath('node-ts-express/base/server.ts'), path.join(destSrcDir, 'server.ts'));
    await fs.copy(getTemplatePath('node-ts-express/base/tsconfig.json'), path.join(projectDir, 'tsconfig.json'));
    
    // --- Step 3: Prepare package.json ---
    const packageJsonContent = JSON.parse(await ejs.renderFile(getTemplatePath('node-ts-express/partials/package.json.ejs'), { projectName }));
    
    if (dbType === 'mongoose') packageJsonContent.dependencies['mongoose'] = '^7.6.3';
    if (dbType === 'prisma') {
      packageJsonContent.dependencies['@prisma/client'] = '^5.6.0';
      packageJsonContent.devDependencies['prisma'] = '^5.6.0';
      packageJsonContent.prisma = { seed: `ts-node ${addSeeder ? 'scripts/seeder.ts' : 'prisma/seed.ts'}` };
    }
    if (addAuth) {
      packageJsonContent.dependencies['jsonwebtoken'] = '^9.0.2';
      packageJsonContent.dependencies['bcryptjs'] = '^2.4.3';
      packageJsonContent.devDependencies['@types/jsonwebtoken'] = '^9.0.5';
      packageJsonContent.devDependencies['@types/bcryptjs'] = '^2.4.6';
    }
    if (addSeeder) {
      packageJsonContent.devDependencies['@faker-js/faker'] = '^8.3.1';
      if (!packageJsonContent.dependencies['chalk']) packageJsonContent.dependencies['chalk'] = '^4.1.2';
      packageJsonContent.scripts['seed'] = 'ts-node scripts/seeder.ts';
      packageJsonContent.scripts['destroy'] = 'ts-node scripts/seeder.ts -d';
    }
    if (extraFeatures.includes('testing')) {
      packageJsonContent.devDependencies['jest'] = '^29.7.0';
      packageJsonContent.devDependencies['supertest'] = '^6.3.3';
      packageJsonContent.devDependencies['@types/jest'] = '^29.5.10';
      packageJsonContent.devDependencies['@types/supertest'] = '^2.0.16';
      packageJsonContent.devDependencies['ts-jest'] = '^29.1.1';
      packageJsonContent.scripts['test'] = 'jest --detectOpenHandles --forceExit';
    }
    if (extraFeatures.includes('swagger')) {
      packageJsonContent.dependencies['swagger-ui-express'] = '^5.0.0';
      packageJsonContent.dependencies['swagger-jsdoc'] = '^6.2.8';
      packageJsonContent.devDependencies['@types/swagger-ui-express'] = '^4.1.6';
    }
    await fs.writeJson(path.join(projectDir, 'package.json'), packageJsonContent, { spaces: 2 });
    
    // --- Step 4: Generate DB-specific files & Controllers ---
    if (modelsToGenerate.size > 0) {
        await fs.ensureDir(path.join(destSrcDir, 'controllers'));
        if (dbType === 'mongoose') {
            console.log(chalk.blue('  -> Generating Mongoose models and controllers...'));
            await fs.ensureDir(path.join(destSrcDir, 'models'));
            for (const [modelName, modelData] of modelsToGenerate.entries()) {
                const schema = modelData.fields.reduce((acc, field) => { acc[field.name] = field.type; return acc; }, {});
                await renderAndWrite(getTemplatePath('node-ts-express/partials/Model.ts.ejs'), path.join(destSrcDir, 'models', `${modelName}.model.ts`), { modelName, schema, projectName });
            }
        } else if (dbType === 'prisma') {
            console.log(chalk.blue('  -> Generating Prisma schema...'));
            await fs.ensureDir(path.join(projectDir, 'prisma'));
            await renderAndWrite(getTemplatePath('node-ts-express/partials/PrismaSchema.prisma.ejs'), path.join(projectDir, 'prisma', 'schema.prisma'), { modelsToGenerate: Array.from(modelsToGenerate.values()) });
        }
        // Generate controllers for both DB types
        console.log(chalk.blue('  -> Generating controllers...'));
        for (const [modelName] of modelsToGenerate.entries()) {
            const templateFile = dbType === 'mongoose' ? 'Controller.ts.ejs' : 'PrismaController.ts.ejs';
            await renderAndWrite(getTemplatePath(`node-ts-express/partials/${templateFile}`), path.join(destSrcDir, 'controllers', `${modelName}.controller.ts`), { modelName, projectName });
        }
    }
    
    // --- Step 5: Generate Auth, Seeder, and Extra Features ---
    if (addAuth) {
        console.log(chalk.blue('  -> Generating authentication boilerplate...'));
        await fs.ensureDir(path.join(destSrcDir, 'routes'));
        await fs.ensureDir(path.join(destSrcDir, 'middleware'));
        await renderAndWrite(getTemplatePath('node-ts-express/partials/Auth.controller.ts.ejs'), path.join(destSrcDir, 'controllers', 'Auth.controller.ts'), { dbType, projectName });
        await renderAndWrite(getTemplatePath('node-ts-express/partials/Auth.routes.ts.ejs'), path.join(destSrcDir, 'routes', 'Auth.routes.ts'), { projectName });
        await renderAndWrite(getTemplatePath('node-ts-express/partials/Auth.middleware.ts.ejs'), path.join(destSrcDir, 'middleware', 'Auth.middleware.ts'), { projectName });
        
        if (dbType === 'mongoose') {
            const userModelPath = path.join(destSrcDir, 'models', 'User.model.ts');
            if (await fs.pathExists(userModelPath)) {
                let userModelContent = await fs.readFile(userModelPath, 'utf-8');
                if (!userModelContent.includes('bcryptjs')) {
                    userModelContent = userModelContent.replace(`import mongoose, { Schema, Document } from 'mongoose';`, `import mongoose, { Schema, Document } from 'mongoose';\nimport bcrypt from 'bcryptjs';`);
                    const preSaveHook = `\n// Hash password before saving\nUserSchema.pre('save', async function(next) {\n  if (!this.isModified('password')) { return next(); }\n  const salt = await bcrypt.genSalt(10);\n  this.password = await bcrypt.hash(this.password, salt);\n  next();\n});\n`;
                    userModelContent = userModelContent.replace(`// Create and export the Model`, `${preSaveHook}\n// Create and export the Model`);
                    await fs.writeFile(userModelPath, userModelContent);
                }
            }
        }
    }
    if (addSeeder) { /* ... Seeder logic as before ... */ }
    if (extraFeatures.includes('docker')) { /* ... Docker logic as before ... */ }
    if (extraFeatures.includes('swagger')) { /* ... Swagger logic as before ... */ }
    if (extraFeatures.includes('testing')) { /* ... Testing logic as before ... */ }

    // --- Step 6: Generate Main Route File & Inject Logic into Server ---
    await renderAndWrite(getTemplatePath('node-ts-express/partials/routes.ts.ejs'), path.join(destSrcDir, 'routes.ts'), { endpoints, addAuth, dbType });
    
    let serverFileContent = await fs.readFile(path.join(destSrcDir, 'server.ts'), 'utf-8');
    let dbConnectionCode = '', swaggerInjector = '', authRoutesInjector = '';

    if (dbType === 'mongoose') {
        dbConnectionCode = `\n// --- Database Connection ---\nimport mongoose from 'mongoose';\nconst MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/${projectName}';\nmongoose.connect(MONGO_URI).then(() => console.log('MongoDB Connected...')).catch(err => console.error(err));\n// -------------------------\n`;
    } else if (dbType === 'prisma') {
        dbConnectionCode = `\nimport { PrismaClient } from '@prisma/client';\nexport const prisma = new PrismaClient();\n`;
    }
    if (extraFeatures.includes('swagger')) {
        swaggerInjector = `\nimport { setupSwagger } from './utils/swagger';\nsetupSwagger(app);\n`;
    }
    if (addAuth) {
        authRoutesInjector = `import authRoutes from './routes/Auth.routes';\napp.use('/api/auth', authRoutes);\n\n`;
    }

    serverFileContent = serverFileContent
      .replace("dotenv.config();", `dotenv.config();${dbConnectionCode}`)
      .replace('// INJECT:ROUTES', `${authRoutesInjector}import apiRoutes from './routes';\napp.use('/api', apiRoutes);`);
      
    const listenRegex = /(app\.listen\()/;
    serverFileContent = serverFileContent.replace(listenRegex, `${swaggerInjector}\n$1`);
    await fs.writeFile(path.join(destSrcDir, 'server.ts'), serverFileContent);

    // --- Step 7: Install Dependencies & Post-install ---
    console.log(chalk.magenta('  -> Installing dependencies...'));
    await execa('npm', ['install'], { cwd: projectDir });
    if (dbType === 'prisma') {
      console.log(chalk.blue('  -> Running `prisma generate`...'));
      await execa('npx', ['prisma', 'generate'], { cwd: projectDir });
    }
    
    // --- Step 8: Generate Final Files (.env.example) ---
    // ... logic as before ...

  } catch (error) {
    throw error;
  }
}

module.exports = { generateNodeProject };