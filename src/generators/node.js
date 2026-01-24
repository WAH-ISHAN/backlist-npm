const chalk = require('chalk');
const { execa } = require('execa');
const fs = require('fs-extra');
const path = require('path');
const ejs = require('ejs');
const { analyzeFrontend } = require('../analyzer');
const { renderAndWrite, getTemplatePath } = require('./template');

async function generateNodeProject(options) {
  // v5.0: Destructure all new options
  const { projectDir, projectName, frontendSrcDir, dbType, addAuth, addSeeder, extraFeatures = [] } = options;
  const port = 8000;

  try {
    // --- Step 1: Analyze Frontend ---
    console.log(chalk.blue('  -> Analyzing frontend for API endpoints...'));
    
    // NOTE: 'let' use kala api endpoints wenas karana nisa
    let endpoints = await analyzeFrontend(frontendSrcDir);

    if (endpoints.length > 0) {
        console.log(chalk.green(`  -> Found ${endpoints.length} endpoints.`));
        
        // ============================================================
        // 🔥 FIX START: Sanitizing Endpoints Logic
        // ============================================================
        endpoints = endpoints.map(ep => {
            // 1. Path eka sudda kirima (/api/v1/users -> ['users'])
            // 'api', 'v1', histhan ain karanawa
            const parts = ep.path.split('/').filter(part => part !== '' && part !== 'api' && part !== 'v1');
            
            // Resource eka hoyaganeema (e.g., 'users')
            let resource = parts[0] || 'Default';
            
            // 2. Controller Name eka hadeema (CamelCase: 'users' -> 'Users')
            // Special Case: resource eka 'auth' nam Controller eka 'Auth'
            // 'V1' kiyana eka ain wenne methanin
            let controllerName = resource.charAt(0).toUpperCase() + resource.slice(1);
            
            // 3. Function Names hariyatama map kirima
            let functionName = '';

            // --- AUTH LOGIC ---
            if (controllerName.toLowerCase() === 'auth') {
                if (ep.path.includes('login')) functionName = 'loginUser';
                else if (ep.path.includes('register')) functionName = 'registerUser';
                else functionName = 'authAction'; // fallback
            } 
            // --- GENERAL RESOURCES LOGIC ---
            else {
                // Singular/Plural logic to avoid 'Userss'
                const singularName = resource.endsWith('s') ? resource.slice(0, -1) : resource;
                const pluralName = resource.endsWith('s') ? resource : resource + 's';
                
                const pascalSingular = singularName.charAt(0).toUpperCase() + singularName.slice(1);
                const pascalPlural = pluralName.charAt(0).toUpperCase() + pluralName.slice(1);

                if (ep.method === 'GET') {
                    if (ep.path.includes(':id')) functionName = `get${pascalSingular}ById`;
                    else functionName = `getAll${pascalPlural}`; // Fixes 'getAllUserss'
                } else if (ep.method === 'POST') {
                    functionName = `create${pascalSingular}`;
                } else if (ep.method === 'PUT') {
                    functionName = `update${pascalSingular}ById`;
                } else if (ep.method === 'DELETE') {
                    functionName = `delete${pascalSingular}ById`;
                } else {
                    functionName = `${ep.method.toLowerCase()}${pascalPlural}`;
                }
            }

            // Update the endpoint object
            // meka ejs file ekedi <%= ep.functionName %> kiyala use karanna puluwan
            return { 
                ...ep, 
                controllerName, 
                functionName 
            };
        });
        // ============================================================
        // 🔥 FIX END
        // ============================================================

    } else {
        console.log(chalk.yellow('  -> No API endpoints found. A basic project will be created.'));
    }

    // --- Step 2: Identify Models to Generate ---
    const modelsToGenerate = new Map();
    endpoints.forEach(ep => {
      // 🔥 FIX: 'ep.schemaFields' තිබ්බත් නැතත් Controller එක හදන්න ඕන.
      // නැත්නම් Routes Import එකේදි Error එනවා.
      if (ep.controllerName !== 'Default' && ep.controllerName !== 'Auth' && !modelsToGenerate.has(ep.controllerName)) {
        
        // Schema Fields නැත්නම් හිස් Array එකක් ගන්න
        let fields = [];
        if (ep.schemaFields) {
            fields = Object.entries(ep.schemaFields).map(([key, type]) => ({ name: key, type, isUnique: key === 'email' }));
        }

        modelsToGenerate.set(ep.controllerName, { 
            name: ep.controllerName, 
            fields: fields
        });
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

    // --- Step 4: Prepare and Write package.json ---
    const packageJsonContent = JSON.parse(await ejs.renderFile(getTemplatePath('node-ts-express/partials/package.json.ejs'), { projectName }));

    if (dbType === 'mongoose') packageJsonContent.dependencies.mongoose = '^7.6.3';
    if (dbType === 'prisma') {
      packageJsonContent.dependencies['@prisma/client'] = '^5.6.0';
      packageJsonContent.devDependencies.prisma = '^5.6.0';
      packageJsonContent.prisma = { seed: `ts-node ${addSeeder ? 'scripts/seeder.ts' : 'prisma/seed.ts'}` };
    }
    if (addAuth) {
      packageJsonContent.dependencies.jsonwebtoken = '^9.0.2';
      packageJsonContent.dependencies.bcryptjs = '^2.4.3';
      packageJsonContent.devDependencies['@types/jsonwebtoken'] = '^9.0.5';
      packageJsonContent.devDependencies['@types/bcryptjs'] = '^2.4.6';
    }
    if (addSeeder) {
      packageJsonContent.devDependencies['@faker-js/faker'] = '^8.3.1';
      if (!packageJsonContent.dependencies.chalk) packageJsonContent.dependencies.chalk = '^4.1.2';
      packageJsonContent.scripts.seed = 'ts-node scripts/seeder.ts';
      packageJsonContent.scripts.destroy = 'ts-node scripts/seeder.ts -d';
    }
    if (extraFeatures.includes('testing')) {
      packageJsonContent.devDependencies.jest = '^29.7.0';
      packageJsonContent.devDependencies.supertest = '^6.3.3';
      packageJsonContent.devDependencies['@types/jest'] = '^29.5.10';
      packageJsonContent.devDependencies['@types/supertest'] = '^2.0.16';
      packageJsonContent.devDependencies['ts-jest'] = '^29.1.1';
      packageJsonContent.scripts.test = 'jest --detectOpenHandles --forceExit';
    }
    if (extraFeatures.includes('swagger')) {
      packageJsonContent.dependencies['swagger-ui-express'] = '^5.0.0';
      packageJsonContent.dependencies['swagger-jsdoc'] = '^6.2.8';
      packageJsonContent.devDependencies['@types/swagger-ui-express'] = '^4.1.6';
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
                await renderAndWrite(getTemplatePath('node-ts-express/partials/Model.ts.ejs'), path.join(destSrcDir, 'models', `${modelName}.model.ts`), { modelName, schema, projectName });
            }
        } else if (dbType === 'prisma') {
            console.log(chalk.blue('  -> Generating Prisma schema...'));
            await fs.ensureDir(path.join(projectDir, 'prisma'));
            await renderAndWrite(getTemplatePath('node-ts-express/partials/PrismaSchema.prisma.ejs'), path.join(projectDir, 'prisma', 'schema.prisma'), { modelsToGenerate: Array.from(modelsToGenerate.values()) });
        }
        console.log(chalk.blue('  -> Generating controllers...'));
        for (const [modelName] of modelsToGenerate.entries()) {
            const templateFile = dbType === 'mongoose' ? 'Controller.ts.ejs' : 'PrismaController.ts.ejs';
            // Controller hadaddi Auth eka skip karanawa (mokada eka yatin wenama hadanawa)
            if (modelName !== 'Auth') {
                await renderAndWrite(getTemplatePath(`node-ts-express/partials/${templateFile}`), path.join(destSrcDir, 'controllers', `${modelName}.controller.ts`), { modelName, projectName });
            }
        }
    }
    
    // --- Step 6: Generate Authentication Boilerplate ---
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
                    userModelContent = userModelContent.replace("import mongoose, { Schema, Document } from 'mongoose';", "import mongoose, { Schema, Document } from 'mongoose';\nimport bcrypt from 'bcryptjs';");
                    const preSaveHook = "\n// Hash password before saving\nUserSchema.pre('save', async function(next) {\n  if (!this.isModified('password')) { return next(); }\n  const salt = await bcrypt.genSalt(10);\n  this.password = await bcrypt.hash(this.password, salt);\n  next();\n});\n";
                    userModelContent = userModelContent.replace('// Create and export the Model', `${preSaveHook}\n// Create and export the Model`);
                    await fs.writeFile(userModelPath, userModelContent);
                }
            }
        }
    }

    // --- Step 7: Generate Seeder Script ---
    if (addSeeder) {
      console.log(chalk.blue('  -> Generating database seeder script...'));
      await fs.ensureDir(path.join(projectDir, 'scripts'));
      await renderAndWrite(getTemplatePath('node-ts-express/partials/Seeder.ts.ejs'), path.join(projectDir, 'scripts', 'seeder.ts'), { projectName });
    }

    // --- Step 8: Generate Extra Features ---
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
      const jestConfig = "/** @type {import('ts-jest').JestConfigWithTsJest} */\nmodule.exports = {\n  preset: 'ts-jest',\n  testEnvironment: 'node',\n  verbose: true,\n};";
      await fs.writeFile(path.join(projectDir, 'jest.config.js'), jestConfig);
      await fs.ensureDir(path.join(projectDir, 'src', '__tests__'));
          await renderAndWrite(getTemplatePath('node-ts-express/partials/App.test.ts.ejs'), path.join(projectDir, 'src', '__tests__', 'api.test.ts'), { addAuth });
        }

        // --- Step 9: Generate Main Route File & Inject Logic into Server ---
        // 🔥 FIX: Auth Endpoints ටික routes.ts එකට යවන්න එපා. 
        // මොකද ඒවා Auth.routes.ts එකෙන් වෙනම හැන්ඩ්ල් වෙනවා.
        const nonAuthEndpoints = endpoints.filter(ep => ep.controllerName !== 'Auth');

        // IMPORTANT: Pass 'nonAuthEndpoints' instead of 'endpoints'
        await renderAndWrite(
            getTemplatePath('node-ts-express/partials/routes.ts.ejs'), 
            path.join(destSrcDir, 'routes.ts'), 
            { endpoints: nonAuthEndpoints, addAuth, dbType } 
        );
        
        let serverFileContent = await fs.readFile(path.join(destSrcDir, 'server.ts'), 'utf-8');
        
        // =========================================================================
        // 👇 මේ ටික තමයි උඹේ Code එකෙන් Missing වෙලා තිබ්බේ. මේක නැතුව DB Connect වෙන්නේ නෑ.
        // =========================================================================
        let dbConnectionCode = '', swaggerInjector = '', authRoutesInjector = '';

        if (dbType === 'mongoose') {
            dbConnectionCode = `
    // --- Database Connection ---
    import mongoose from 'mongoose';
    const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/${projectName}';
    mongoose.connect(MONGO_URI).then(() => console.log('MongoDB Connected...')).catch(err => console.error(err));
    // -------------------------
    `;
        } else if (dbType === 'prisma') {
            dbConnectionCode = "\nimport { PrismaClient } from '@prisma/client';\nexport const prisma = new PrismaClient();\n";
        }
        if (extraFeatures.includes('swagger')) {
            swaggerInjector = "\nimport { setupSwagger } from './utils/swagger';\nsetupSwagger(app);\n";
        }
        if (addAuth) {
            authRoutesInjector = "import authRoutes from './routes/Auth.routes';\napp.use('/api/auth', authRoutes);\n\n";
        }

        serverFileContent = serverFileContent
          .replace("dotenv.config();", `dotenv.config();${dbConnectionCode}`)
          .replace('// INJECT:ROUTES', `${authRoutesInjector}import apiRoutes from './routes';
    app.use('/api', apiRoutes);`);
          
        const listenRegex = /(app\.listen\()/;
        serverFileContent = serverFileContent.replace(listenRegex, `${swaggerInjector}\n$1`);
        await fs.writeFile(path.join(destSrcDir, 'server.ts'), serverFileContent);
        // =========================================================================


        // --- Step 10: Install Dependencies & Run Post-install Scripts ---
        console.log(chalk.magenta('  -> Installing dependencies... This may take a moment.'));
        await execa('npm', ['install'], { cwd: projectDir });
        if (dbType === 'prisma') {
          console.log(chalk.blue('  -> Running `prisma generate`...'));
          await execa('npx', ['prisma', 'generate'], { cwd: projectDir });
        }
        
        // --- Step 11: Generate Final Files (.env.example) ---
        let envContent = `PORT=${port}\n`;
        if (dbType === 'mongoose') {
            envContent += `MONGO_URI=mongodb://root:example@db:27017/${projectName}?authSource=admin\n`;
        } else if (dbType === 'prisma') {
        envContent += `DATABASE_URL="postgresql://user:password@db:5432/${projectName}?schema=public"\n`;
    }
    if (addAuth) envContent += 'JWT_SECRET=your_super_secret_jwt_key_12345\n';
    if (extraFeatures.includes('docker')) {
        envContent += `\n# Docker-compose credentials (used in docker-compose.yml)\nDB_USER=user\nDB_PASSWORD=password\nDB_NAME=${projectName}`;
    }
    await fs.writeFile(path.join(projectDir, '.env.example'), envContent);
    
  } catch (error) {
    throw error;
  }
}

module.exports = { generateNodeProject };