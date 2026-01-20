const chalk = require('chalk');
const { execa } = require('execa');
const fs = require('fs-extra');
const path = require('path');
const ejs = require('ejs');
const { analyzeFrontend } = require('../analyzer');
const { renderAndWrite, getTemplatePath } = require('./template');

async function generateNodeProject(options) {
  const {
    projectDir,
    projectName,
    frontendSrcDir,
    dbType,
    addAuth,
    addSeeder,
    extraFeatures = [],
  } = options;

  const port = 8000;

  try {
    // --- Step 1: Analyze Frontend ---
    console.log(chalk.blue('  -> Analyzing frontend for API endpoints (AST)...'));
    const endpoints = await analyzeFrontend(frontendSrcDir);
    if (endpoints.length > 0) console.log(chalk.green(`  -> Found ${endpoints.length} endpoints.`));
    else console.log(chalk.yellow('  -> No API endpoints found. A basic project will be created.'));

    // Group endpoints by controller
    const endpointsByController = new Map();
    for (const ep of endpoints) {
      const c = ep && ep.controllerName ? ep.controllerName : 'Default';
      if (c === 'Default') continue;
      if (!endpointsByController.has(c)) endpointsByController.set(c, []);
      endpointsByController.get(c).push(ep);
    }

    // --- Step 2: Identify Models to Generate (merge fields per controller) ---
    const modelsToGenerate = new Map();

    for (const [controllerName, eps] of endpointsByController.entries()) {
      const fieldMap = new Map();

      for (const ep of eps) {
        const fields = ep?.requestBody?.fields || ep?.schemaFields;
        if (!fields) continue;

        for (const [key, type] of Object.entries(fields)) {
          fieldMap.set(key, { name: key, type, isUnique: key === 'email' });
        }
      }

      if (fieldMap.size > 0) {
        modelsToGenerate.set(controllerName, {
          name: controllerName,
          fields: Array.from(fieldMap.values()),
        });
      }
    }

    // Ensure User model if auth enabled
    if (addAuth && !modelsToGenerate.has('User')) {
      console.log(chalk.yellow('  -> Authentication requires a "User" model. Creating a default one.'));
      modelsToGenerate.set('User', {
        name: 'User',
        fields: [
          { name: 'name', type: 'string' },
          { name: 'email', type: 'string', isUnique: true },
          { name: 'password', type: 'string' },
        ],
      });
      // Also ensure controller exists so routes/controller can generate if frontend didn't call /api/users
      if (!endpointsByController.has('User')) endpointsByController.set('User', []);
    }

    // --- Step 3: Base Scaffolding ---
    console.log(chalk.blue('  -> Scaffolding Node.js project...'));
    const destSrcDir = path.join(projectDir, 'src');
    await fs.ensureDir(destSrcDir);
    await fs.copy(getTemplatePath('node-ts-express/base/server.ts'), path.join(destSrcDir, 'server.ts'));
    await fs.copy(getTemplatePath('node-ts-express/base/tsconfig.json'), path.join(projectDir, 'tsconfig.json'));

    // --- Step 4: Prepare and Write package.json ---
    const packageJsonContent = JSON.parse(
      await ejs.renderFile(getTemplatePath('node-ts-express/partials/package.json.ejs'), { projectName })
    );

    if (dbType === 'mongoose') {
      packageJsonContent.dependencies['mongoose'] = '^7.6.3';
    }

    if (dbType === 'prisma') {
      packageJsonContent.dependencies['@prisma/client'] = '^5.6.0';
      packageJsonContent.devDependencies['prisma'] = '^5.6.0';
      // prisma seed entry is fine, but if you do mongoose seeder only, don't point prisma seed to scripts/seeder.ts
      packageJsonContent.prisma = { seed: `ts-node prisma/seed.ts` };
    }

    if (addAuth) {
      packageJsonContent.dependencies['jsonwebtoken'] = '^9.0.2';
      packageJsonContent.dependencies['bcryptjs'] = '^2.4.3';
      packageJsonContent.devDependencies['@types/jsonwebtoken'] = '^9.0.5';
      packageJsonContent.devDependencies['@types/bcryptjs'] = '^2.4.6';
    }

    // Seeder deps only if mongoose seeder enabled
    if (addSeeder && dbType === 'mongoose') {
      packageJsonContent.devDependencies['@faker-js/faker'] = '^8.3.1';
      if (!packageJsonContent.dependencies['chalk']) packageJsonContent.dependencies['chalk'] = '^4.1.2';
      packageJsonContent.scripts['seed'] = `ts-node scripts/seeder.ts`;
      packageJsonContent.scripts['destroy'] = `ts-node scripts/seeder.ts -d`;
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

    // --- Step 5: Generate DB-specific files & Models ---
    await fs.ensureDir(path.join(destSrcDir, 'controllers'));

    if (modelsToGenerate.size > 0) {
      if (dbType === 'mongoose') {
        console.log(chalk.blue('  -> Generating Mongoose models...'));
        await fs.ensureDir(path.join(destSrcDir, 'models'));

        for (const [modelName, modelData] of modelsToGenerate.entries()) {
          // normalize schema fields to simple types (string/number/boolean)
          const schema = {};
          for (const field of modelData.fields || []) {
            const t = String(field.type || 'string').toLowerCase();
            schema[field.name] = (t === 'number' || t === 'boolean') ? t : 'string';
          }

          await renderAndWrite(
            getTemplatePath('node-ts-express/partials/Model.ts.ejs'),
            path.join(destSrcDir, 'models', `${modelName}.model.ts`),
            { modelName, schema, projectName }
          );
        }
      }

      if (dbType === 'prisma') {
        console.log(chalk.blue('  -> Generating Prisma schema + client...'));
        await fs.ensureDir(path.join(projectDir, 'prisma'));

        await renderAndWrite(
          getTemplatePath('node-ts-express/partials/PrismaSchema.prisma.ejs'),
          path.join(projectDir, 'prisma', 'schema.prisma'),
          { modelsToGenerate: Array.from(modelsToGenerate.values()), projectName }
        );

        // Prisma client singleton
        await fs.ensureDir(path.join(destSrcDir, 'db'));
        await renderAndWrite(
          getTemplatePath('node-ts-express/partials/prismaClient.ts.ejs'),
          path.join(destSrcDir, 'db', 'prisma.ts'),
          { projectName }
        );
      }
    }

    // --- Step 5b: Generate Controllers from Endpoints (AST-driven) ---
    console.log(chalk.blue('  -> Generating controllers (from endpoints)...'));
    for (const [controllerName, controllerEndpoints] of endpointsByController.entries()) {
      const tpl =
        dbType === 'prisma'
          ? 'node-ts-express/partials/PrismaController.FromEndpoints.ts.ejs'
          : 'node-ts-express/partials/Controller.FromEndpoints.ts.ejs';

      await renderAndWrite(
        getTemplatePath(tpl),
        path.join(destSrcDir, 'controllers', `${controllerName}.controller.ts`),
        { controllerName, endpoints: controllerEndpoints, projectName, dbType }
      );
    }

    // --- Step 6: Authentication Boilerplate ---
    if (addAuth) {
      console.log(chalk.blue('  -> Generating authentication boilerplate...'));
      await fs.ensureDir(path.join(destSrcDir, 'routes'));
      await fs.ensureDir(path.join(destSrcDir, 'middleware'));

      await renderAndWrite(
        getTemplatePath('node-ts-express/partials/Auth.controller.ts.ejs'),
        path.join(destSrcDir, 'controllers', 'Auth.controller.ts'),
        { dbType, projectName }
      );

      await renderAndWrite(
        getTemplatePath('node-ts-express/partials/Auth.routes.ts.ejs'),
        path.join(destSrcDir, 'routes', 'Auth.routes.ts'),
        { projectName }
      );

      await renderAndWrite(
        getTemplatePath('node-ts-express/partials/Auth.middleware.ts.ejs'),
        path.join(destSrcDir, 'middleware', 'Auth.middleware.ts'),
        { projectName }
      );

      // For mongoose: inject password hashing hook into User.model.ts if exists
      if (dbType === 'mongoose') {
        const userModelPath = path.join(destSrcDir, 'models', 'User.model.ts');
        if (await fs.pathExists(userModelPath)) {
          let userModelContent = await fs.readFile(userModelPath, 'utf-8');

          if (!userModelContent.includes(`import bcrypt`)) {
            userModelContent = userModelContent.replace(
              `import mongoose, { Schema, Document } from 'mongoose';`,
              `import mongoose, { Schema, Document } from 'mongoose';\nimport bcrypt from 'bcryptjs';`
            );
          }

          if (!userModelContent.includes(`pre('save'`)) {
            const preSaveHook =
              `\n// Hash password before saving\n` +
              `UserSchema.pre('save', async function(next) {\n` +
              `  if (!this.isModified('password')) { return next(); }\n` +
              `  const salt = await bcrypt.genSalt(10);\n` +
              `  this.password = await bcrypt.hash(this.password, salt);\n` +
              `  next();\n` +
              `});\n`;

            userModelContent = userModelContent.replace(
              `// Create and export the Model`,
              `${preSaveHook}\n// Create and export the Model`
            );
          }

          await fs.writeFile(userModelPath, userModelContent);
        }
      }
    }

    // --- Step 7: Seeder Script (mongoose only) ---
    if (addSeeder && dbType === 'mongoose') {
      console.log(chalk.blue('  -> Generating database seeder script (mongoose)...'));
      await fs.ensureDir(path.join(projectDir, 'scripts'));
      await renderAndWrite(
        getTemplatePath('node-ts-express/partials/Seeder.ts.ejs'),
        path.join(projectDir, 'scripts', 'seeder.ts'),
        { projectName }
      );
    }

    // --- Step 8: Extra Features ---
    if (extraFeatures.includes('docker')) {
      console.log(chalk.blue('  -> Generating Docker files...'));
      await renderAndWrite(
        getTemplatePath('node-ts-express/partials/Dockerfile.ejs'),
        path.join(projectDir, 'Dockerfile'),
        { dbType, port }
      );
      await renderAndWrite(
        getTemplatePath('node-ts-express/partials/docker-compose.yml.ejs'),
        path.join(projectDir, 'docker-compose.yml'),
        { projectName, dbType, port }
      );
    }

    if (extraFeatures.includes('swagger')) {
      console.log(chalk.blue('  -> Generating API documentation setup...'));
      await fs.ensureDir(path.join(destSrcDir, 'utils'));
      await renderAndWrite(
        getTemplatePath('node-ts-express/partials/ApiDocs.ts.ejs'),
        path.join(destSrcDir, 'utils', 'swagger.ts'),
        { projectName, port, addAuth }
      );
    }

    if (extraFeatures.includes('testing')) {
      console.log(chalk.blue('  -> Generating testing boilerplate...'));
      const jestConfig =
        `/** @type {import('ts-jest').JestConfigWithTsJest} */\n` +
        `module.exports = {\n` +
        `  preset: 'ts-jest',\n` +
        `  testEnvironment: 'node',\n` +
        `  verbose: true,\n` +
        `};\n`;
      await fs.writeFile(path.join(projectDir, 'jest.config.js'), jestConfig);

      await fs.ensureDir(path.join(projectDir, 'src', '__tests__'));
      await renderAndWrite(
        getTemplatePath('node-ts-express/partials/App.test.ts.ejs'),
        path.join(projectDir, 'src', '__tests__', 'api.test.ts'),
        { addAuth, endpoints }
      );
    }

    // --- Step 9: Generate Main Route File & Inject into server.ts ---
    await renderAndWrite(
      getTemplatePath('node-ts-express/partials/routes.ts.ejs'),
      path.join(destSrcDir, 'routes.ts'),
      { endpoints, addAuth, dbType }
    );

    let serverFileContent = await fs.readFile(path.join(destSrcDir, 'server.ts'), 'utf-8');

    // Mongoose db connect injection only; prisma uses src/db/prisma.ts
    let dbConnectionCode = '';
    if (dbType === 'mongoose') {
      dbConnectionCode =
        `\n// --- Database Connection ---\n` +
        `import mongoose from 'mongoose';\n` +
        `const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/${projectName}';\n` +
        `mongoose.connect(MONGO_URI)\n` +
        `  .then(() => console.log('MongoDB Connected...'))\n` +
        `  .catch(err => console.error(err));\n` +
        `// -------------------------\n`;
    }

    let swaggerInjector = '';
    if (extraFeatures.includes('swagger')) {
      swaggerInjector = `\nimport { setupSwagger } from './utils/swagger';\nsetupSwagger(app);\n`;
    }

    let authRoutesInjector = '';
    if (addAuth) {
      authRoutesInjector = `import authRoutes from './routes/Auth.routes';\napp.use('/api/auth', authRoutes);\n\n`;
    }

    serverFileContent = serverFileContent
      .replace('dotenv.config();', `dotenv.config();${dbConnectionCode}`)
      .replace('// INJECT:ROUTES', `${authRoutesInjector}import apiRoutes from './routes';\napp.use('/api', apiRoutes);\n`);

    // place swagger setup before listen
    const listenRegex = /(app\.listen\()/;
    serverFileContent = serverFileContent.replace(listenRegex, `${swaggerInjector}\n$1`);

    await fs.writeFile(path.join(destSrcDir, 'server.ts'), serverFileContent);

    // --- Step 10: Install Dependencies & Post-install ---
    console.log(chalk.magenta('  -> Installing dependencies... This may take a moment.'));
    await execa('npm', ['install'], { cwd: projectDir });

    if (dbType === 'prisma') {
      console.log(chalk.blue('  -> Running `prisma generate`...'));
      await execa('npx', ['prisma', 'generate'], { cwd: projectDir });
    }

    // --- Step 11: Final Files (.env.example) ---
    let envContent = `PORT=${port}\n`;

    if (dbType === 'mongoose') {
      envContent += `MONGO_URI=mongodb://127.0.0.1:27017/${projectName}\n`;
    } else if (dbType === 'prisma') {
      envContent += `DATABASE_URL="postgresql://user:password@localhost:5432/${projectName}?schema=public"\n`;
    }

    if (addAuth) envContent += `JWT_SECRET=change_me_long_secret_change_me_long_secret\n`;

    if (extraFeatures.includes('docker') && dbType === 'prisma') {
      envContent += `\n# Docker-compose credentials\nDB_USER=postgres\nDB_PASSWORD=password\nDB_NAME=${projectName}\n`;
    }

    await fs.writeFile(path.join(projectDir, '.env.example'), envContent);

  } catch (error) {
    throw error;
  }
}

module.exports = { generateNodeProject };