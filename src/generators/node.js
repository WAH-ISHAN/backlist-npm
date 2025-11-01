const chalk = require('chalk');
const { execa } = require('execa');
const fs = require('fs-extra');
const path = require('path');
const { analyzeFrontend } = require('../analyzer');
const { renderAndWrite, getTemplatePath } = require('./template');

async function generateNodeProject(options) {
  // v5.0: Destructure all new options
  const { projectDir, projectName, frontendSrcDir, dbType, addAuth, addSeeder, extraFeatures = [] } = options;
  const port = 8000;

  try {
    // --- Step 1: Analyze Frontend ---
    console.log(chalk.blue('  -> Analyzing frontend for API endpoints...'));
    const endpoints = await analyzeFrontend(frontendSrcDir);
    if (endpoints.length > 0) console.log(chalk.green(`  -> Found ${endpoints.length} endpoints.`));
    else console.log(chalk.yellow('  -> No API endpoints found. A basic project will be created.'));

    // --- Step 2: Identify Models to Generate ---
    const modelsToGenerate = new Map();
    endpoints.forEach(ep => {
      if (ep.schemaFields && ep.controllerName !== 'Default' && !modelsToGenerate.has(ep.controllerName)) {
        modelsToGenerate.set(ep.controllerName, { name: ep.controllerName, fields: Object.entries(ep.schemaFields).map(([key, type]) => ({ name: key, type, isUnique: key === 'email' })) });
      }
    });
    if (addAuth && !modelsToGenerate.has('User')) {
      console.log(chalk.yellow('  -> Authentication requires a "User" model. Creating a default one.'));
      modelsToGenerate.set('User', { name: 'User', fields: [{ name: 'name', type: 'String' }, { name: 'email', type: 'String', isUnique: true }, { name: 'password', type: 'String' }] });
    }

    // --- Step 3: Base Scaffolding ---
    console.log(chalk.blue('  -> Scaffolding Node.js project...'));
    const destSrcDir = path.join(projectDir, 'src');
    await fs.ensureDir(destSrcDir);
    await fs.copy(getTemplatePath('node-ts-express/base/server.ts'), path.join(destSrcDir, 'server.ts'));
    await fs.copy(getTemplatePath('node-ts-express/base/tsconfig.json'), path.join(projectDir, 'tsconfig.json'));
    
    // --- Step 4: Prepare and Write package.json with All Conditional Dependencies ---
    const packageJsonContent = JSON.parse(await ejs.renderFile(getTemplatePath('node-ts-express/partials/package.json.ejs'), { projectName }));
    
    if (dbType === 'mongoose') packageJsonContent.dependencies['mongoose'] = '^7.5.0';
    if (dbType === 'prisma') {
      packageJsonContent.dependencies['@prisma/client'] = '^5.5.2';
      packageJsonContent.devDependencies['prisma'] = '^5.5.2';
      packageJsonContent.prisma = { seed: `ts-node ${addSeeder ? 'scripts/seeder.ts' : 'prisma/seed.ts'}` };
    }
    if (addAuth) {
      packageJsonContent.dependencies['jsonwebtoken'] = '^9.0.2';
      packageJsonContent.dependencies['bcryptjs'] = '^2.4.3';
      packageJsonContent.devDependencies['@types/jsonwebtoken'] = '^9.0.2';
      packageJsonContent.devDependencies['@types/bcryptjs'] = '^2.4.2';
    }
    if (addSeeder) {
      packageJsonContent.devDependencies['@faker-js/faker'] = '^8.2.0';
      packageJsonContent.dependencies['chalk'] = '^4.1.2';
      packageJsonContent.scripts['seed'] = `ts-node scripts/seeder.ts`;
      packageJsonContent.scripts['destroy'] = `ts-node scripts/seeder.ts -d`;
    }
    if (extraFeatures.includes('testing')) {
      packageJsonContent.devDependencies['jest'] = '^29.7.0';
      packageJsonContent.devDependencies['supertest'] = '^6.3.3';
      packageJsonContent.devDependencies['@types/jest'] = '^29.5.5';
      packageJsonContent.devDependencies['@types/supertest'] = '^2.0.14';
      packageJsonContent.devDependencies['ts-jest'] = '^29.1.1';
      packageJsonContent.scripts['test'] = 'jest --detectOpenHandles';
    }
    if (extraFeatures.includes('swagger')) {
      packageJsonContent.dependencies['swagger-ui-express'] = '^5.0.0';
      packageJsonContent.dependencies['swagger-jsdoc'] = '^6.2.8';
      packageJsonContent.devDependencies['@types/swagger-ui-express'] = '^4.1.4';
    }
    await fs.writeJson(path.join(projectDir, 'package.json'), packageJsonContent, { spaces: 2 });
    
    // --- Step 5: Generate DB-specific files & Controllers ---
    if (modelsToGenerate.size > 0) {
        await fs.ensureDir(path.join(destSrcDir, 'controllers'));
        if (dbType === 'mongoose') {
            console.log(chalk.blue('  -> Generating Mongoose models and controllers...'));
            await fs.ensureDir(path.join(destSrcDir, 'models'));
            for (const [modelName, modelData] of modelsToGenerate.entries()) {
                const schema = modelData.fields.reduce((acc, field) => { acc[field.name] = field.type; return acc; }, {});
                await renderAndWrite(getTemplatePath('node-ts-express/partials/Model.ts.ejs'), path.join(destSrcDir, 'models', `${modelName}.model.ts`), { modelName, schema });
                await renderAndWrite(getTemplatePath('node-ts-express/partials/Controller.ts.ejs'), path.join(destSrcDir, 'controllers', `${modelName}.controller.ts`), { modelName });
            }
        } else if (dbType === 'prisma') {
            console.log(chalk.blue('  -> Generating Prisma schema and controllers...'));
            await fs.ensureDir(path.join(projectDir, 'prisma'));
            await renderAndWrite(getTemplatePath('node-ts-express/partials/PrismaSchema.prisma.ejs'), path.join(projectDir, 'prisma', 'schema.prisma'), { modelsToGenerate: Array.from(modelsToGenerate.values()) });
            for (const [modelName] of modelsToGenerate.entries()) {
                await renderAndWrite(getTemplatePath('node-ts-express/partials/PrismaController.ts.ejs'), path.join(destSrcDir, 'controllers', `${modelName}.controller.ts`), { modelName });
            }
        }
    }
    
    // --- Step 6: Generate Auth, Seeder, and Extra Features ---
    if (addAuth) { /* ... Logic from v4.0 ... */ }
    if (addSeeder) { /* ... Logic from v4.0 ... */ }
    if (extraFeatures.includes('docker')) {
      console.log(chalk.blue('  -> Generating Docker files...'));
      await renderAndWrite(getTemplatePath('node-ts-express/partials/Dockerfile.ejs'), path.join(projectDir, 'Dockerfile'), { dbType, port });
      await renderAndWrite(getTemplatePath('node-ts-express/partials/docker-compose.yml.ejs'), path.join(projectDir, 'docker-compose.yml'), { projectName, dbType, port });
    }
    if (extraFeatures.includes('swagger')) {
      console.log(chalk.blue('  -> Generating API documentation setup...'));
      await fs.ensureDir(path.join(destSrcDir, 'utils'));
      await renderAndWrite(getTemplatePath('node-ts-express/partials/ApiDocs.ts.ejs'), path.join(destSrcDir, 'utils', 'swagger.ts'), { projectName, port });
    }
    if (extraFeatures.includes('testing')) {
      console.log(chalk.blue('  -> Generating testing boilerplate...'));
      const jestConfig = `module.exports = { preset: 'ts-jest', testEnvironment: 'node' };`;
      await fs.writeFile(path.join(projectDir, 'jest.config.js'), jestConfig);
      await fs.ensureDir(path.join(projectDir, 'src', '__tests__'));
      await renderAndWrite(getTemplatePath('node-ts-express/partials/App.test.ts.ejs'), path.join(projectDir, 'src', '__tests__', 'api.test.ts'), { addAuth });
    }

    // --- Step 7: Generate Main Route File & Inject Logic into Server ---
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
      .replace('// INJECT:ROUTES', `${authRoutesInjector}import apiRoutes from './routes';\napp.use('/api', apiRoutes);\n${swaggerInjector}`);
    await fs.writeFile(path.join(destSrcDir, 'server.ts'), serverFileContent);

    // --- Step 8: Install Dependencies & Run Post-install Scripts ---
    console.log(chalk.magenta('  -> Installing dependencies... This may take a moment.'));
    await execa('npm', ['install'], { cwd: projectDir });
    if (dbType === 'prisma') {
      console.log(chalk.blue('  -> Running `prisma generate`...'));
      await execa('npx', ['prisma', 'generate'], { cwd: projectDir });
    }

    // --- Step 9: Generate Final Files (.env.example) ---
    let envContent = `PORT=${port}\n`;
    if (dbType === 'mongoose') envContent += `DATABASE_URL=mongodb://root:example@localhost:27017/${projectName}?authSource=admin\n`;
    if (dbType === 'prisma') envContent += `DATABASE_URL="postgresql://user:password@localhost:5432/${projectName}?schema=public"\n`;
    if (addAuth) envContent += `JWT_SECRET=your_super_secret_key\n`;
    if (extraFeatures.includes('docker')) envContent += `\n# Docker-compose credentials\nDB_USER=user\nDB_PASSWORD=password\nDB_NAME=${projectName}`;
    await fs.writeFile(path.join(projectDir, '.env.example'), envContent);
    
  } catch (error) {
    throw error;
  }
}

module.exports = { generateNodeProject };