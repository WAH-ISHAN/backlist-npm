const chalk = require("chalk");
const { execa } = require("execa");
const fs = require("fs-extra");
const path = require("path");
const ejs = require("ejs");

const { analyzeFrontend } = require("../analyzer");
const { renderAndWrite, getTemplatePath } = require("./template");

function stripQuery(p) {
  return String(p || "").split("?")[0];
}

function safePascalName(name) {
  const cleaned = String(name || "Default")
    .split("?")[0]
    .replace(/[^a-zA-Z0-9]/g, "");

  if (!cleaned) return "Default";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function sanitizeEndpoints(endpoints) {
  if (!Array.isArray(endpoints)) return [];

  return endpoints.map((ep) => {
    const rawPath = stripQuery(ep.path || ep.route || "/");

    const parts = rawPath
      .split("/")
      .filter(Boolean)
      .filter((p) => p !== "api" && !/^v\d+$/i.test(p));

    const resource = parts[0] || "Default";
    const controllerName = safePascalName(resource);

    let functionName = "";

    if (controllerName.toLowerCase() === "auth") {
      if (rawPath.includes("login")) functionName = "loginUser";
      else if (rawPath.includes("register")) functionName = "registerUser";
      else functionName = "authAction";
    } else {
      const singularName = resource.endsWith("s") ? resource.slice(0, -1) : resource;
      const pluralName = resource.endsWith("s") ? resource : `${resource}s`;

      const pascalSingular = safePascalName(singularName);
      const pascalPlural = safePascalName(pluralName);

      const method = String(ep.method || "GET").toUpperCase();

      const hasId =
        rawPath.includes(":") || 
        rawPath.includes("{") || 
        /\/\d+/.test(rawPath);

      if (method === "GET") {
        functionName = hasId ? `get${pascalSingular}ById` : `getAll${pascalPlural}`;
      } else if (method === "POST") {
        functionName = `create${pascalSingular}`;
      } else if (method === "PUT" || method === "PATCH") {
        functionName = `update${pascalSingular}ById`;
      } else if (method === "DELETE") {
        functionName = `delete${pascalSingular}ById`;
      } else {
        functionName = `${method.toLowerCase()}${pascalPlural}`;
      }
    }

    return { ...ep, path: rawPath, controllerName, functionName };
  });
}

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
    console.log(chalk.blue("  -> Analyzing frontend for API endpoints..."));
    let endpoints = await analyzeFrontend(frontendSrcDir);

    if (Array.isArray(endpoints) && endpoints.length > 0) {
      console.log(chalk.green(`  -> Found ${endpoints.length} endpoints.`));
      endpoints = sanitizeEndpoints(endpoints);
    } else {
      endpoints = [];
      console.log(chalk.yellow("  -> No API endpoints found. A basic project will be created."));
    }

    // --- Step 2: Identify Models to Generate ---
    const modelsToGenerate = new Map();

    endpoints.forEach((ep) => {
      if (!ep) return;
      const ctrl = safePascalName(ep.controllerName);
      if (ctrl === "Default" || ctrl === "Auth") return;

      if (!modelsToGenerate.has(ctrl)) {
        let fields = [];
        if (ep.schemaFields) {
          fields = Object.entries(ep.schemaFields).map(([key, type]) => ({
            name: key,
            type,
            isUnique: key === "email",
          }));
        }
        modelsToGenerate.set(ctrl, { name: ctrl, fields });
      }
    });

    if (addAuth && !modelsToGenerate.has("User")) {
      console.log(chalk.yellow('  -> Authentication requires a "User" model. Creating a default one.'));
      modelsToGenerate.set("User", {
        name: "User",
        fields: [
          { name: "name", type: "String" },
          { name: "email", type: "String", isUnique: true },
          { name: "password", type: "String" },
        ],
      });
    }

    // --- Step 3: Base Scaffolding ---
    console.log(chalk.blue("  -> Scaffolding Node.js project..."));
    const destSrcDir = path.join(projectDir, "src");
    await fs.ensureDir(destSrcDir);

    await fs.copy(getTemplatePath("node-ts-express/base/server.ts"), path.join(destSrcDir, "server.ts"));
    await fs.copy(getTemplatePath("node-ts-express/base/tsconfig.json"), path.join(projectDir, "tsconfig.json"));

    // --- Step 4: package.json ---
    const packageJsonContent = JSON.parse(
      await ejs.renderFile(getTemplatePath("node-ts-express/partials/package.json.ejs"), { projectName })
    );

    if (dbType === "mongoose") packageJsonContent.dependencies.mongoose = "^7.6.3";
    if (dbType === "prisma") {
      packageJsonContent.dependencies["@prisma/client"] = "^5.6.0";
      packageJsonContent.devDependencies.prisma = "^5.6.0";
      packageJsonContent.prisma = { seed: `ts-node ${addSeeder ? "scripts/seeder.ts" : "prisma/seed.ts"}` };
    }

    if (addAuth) {
      packageJsonContent.dependencies.jsonwebtoken = "^9.0.2";
      packageJsonContent.dependencies.bcryptjs = "^2.4.3";
      packageJsonContent.devDependencies["@types/jsonwebtoken"] = "^9.0.5";
      packageJsonContent.devDependencies["@types/bcryptjs"] = "^2.4.6";
    }

    if (addSeeder) {
      packageJsonContent.devDependencies["@faker-js/faker"] = "^8.3.1";
      if (!packageJsonContent.dependencies.chalk) packageJsonContent.dependencies.chalk = "^4.1.2";
      packageJsonContent.scripts.seed = "ts-node scripts/seeder.ts";
      packageJsonContent.scripts.destroy = "ts-node scripts/seeder.ts -d";
    }

    if (extraFeatures.includes("testing")) {
      packageJsonContent.devDependencies.jest = "^29.7.0";
      packageJsonContent.devDependencies.supertest = "^6.3.3";
      packageJsonContent.devDependencies["@types/jest"] = "^29.5.10";
      packageJsonContent.devDependencies["@types/supertest"] = "^2.0.16";
      packageJsonContent.devDependencies["ts-jest"] = "^29.1.1";
      packageJsonContent.scripts.test = "jest --detectOpenHandles --forceExit";
    }

    if (extraFeatures.includes("swagger")) {
      packageJsonContent.dependencies["swagger-ui-express"] = "^5.0.0";
      packageJsonContent.dependencies["swagger-jsdoc"] = "^6.2.8";
      packageJsonContent.devDependencies["@types/swagger-ui-express"] = "^4.1.6";
    }

    await fs.writeJson(path.join(projectDir, "package.json"), packageJsonContent, { spaces: 2 });

    // --- Step 5: DB + Controllers ---
    if (modelsToGenerate.size > 0) {
      await fs.ensureDir(path.join(destSrcDir, "controllers"));

      if (dbType === "mongoose") {
        console.log(chalk.blue("  -> Generating Mongoose models and controllers..."));
        await fs.ensureDir(path.join(destSrcDir, "models"));

        for (const [modelName, modelData] of modelsToGenerate.entries()) {
          const schema = (modelData.fields || []).reduce((acc, field) => {
            acc[field.name] = field.type;
            return acc;
          }, {});
          await renderAndWrite(
            getTemplatePath("node-ts-express/partials/Model.ts.ejs"),
            path.join(destSrcDir, "models", `${modelName}.model.ts`),
            { modelName, schema, projectName }
          );
        }
      } else if (dbType === "prisma") {
        console.log(chalk.blue("  -> Generating Prisma schema..."));
        await fs.ensureDir(path.join(projectDir, "prisma"));
        await renderAndWrite(
          getTemplatePath("node-ts-express/partials/PrismaSchema.prisma.ejs"),
          path.join(projectDir, "prisma", "schema.prisma"),
          { modelsToGenerate: Array.from(modelsToGenerate.values()) }
        );
      }

      console.log(chalk.blue("  -> Generating controllers..."));
      for (const [modelName] of modelsToGenerate.entries()) {
        const templateFile = dbType === "mongoose" ? "Controller.ts.ejs" : "PrismaController.ts.ejs";
        if (modelName !== "Auth") {
          await renderAndWrite(
            getTemplatePath(`node-ts-express/partials/${templateFile}`),
            path.join(destSrcDir, "controllers", `${modelName}.controller.ts`),
            { modelName, projectName }
          );
        }
      }
    }

    // --- Step 6: Auth ---
    if (addAuth) {
      console.log(chalk.blue("  -> Generating authentication boilerplate..."));
      await fs.ensureDir(path.join(destSrcDir, "routes"));
      await fs.ensureDir(path.join(destSrcDir, "middleware"));

      await renderAndWrite(
        getTemplatePath("node-ts-express/partials/Auth.controller.ts.ejs"),
        path.join(destSrcDir, "controllers", "Auth.controller.ts"),
        { dbType, projectName }
      );
      await renderAndWrite(
        getTemplatePath("node-ts-express/partials/Auth.routes.ts.ejs"),
        path.join(destSrcDir, "routes", "Auth.routes.ts"),
        { projectName }
      );
      await renderAndWrite(
        getTemplatePath("node-ts-express/partials/Auth.middleware.ts.ejs"),
        path.join(destSrcDir, "middleware", "Auth.middleware.ts"),
        { projectName }
      );
    }

    // --- Step 7: Seeder ---
    if (addSeeder) {
      console.log(chalk.blue("  -> Generating database seeder script..."));
      await fs.ensureDir(path.join(projectDir, "scripts"));
      await renderAndWrite(
        getTemplatePath("node-ts-express/partials/Seeder.ts.ejs"),
        path.join(projectDir, "scripts", "seeder.ts"),
        { projectName, models: Array.from(modelsToGenerate.values()) }
      );
    }

    // --- Step 8: Extras (FIXED) ---
    if (extraFeatures.includes("docker")) {
      console.log(chalk.blue("  -> Generating Docker files..."));
      await renderAndWrite(
        getTemplatePath("node-ts-express/partials/Dockerfile.ejs"),
        path.join(projectDir, "Dockerfile"),
        { dbType, port }
      );
      await renderAndWrite(
        getTemplatePath("node-ts-express/partials/docker-compose.yml.ejs"),
        path.join(projectDir, "docker-compose.yml"),
        { projectName, dbType, port, addAuth, extraFeatures }
      );
    }

    if (extraFeatures.includes("swagger")) {
      console.log(chalk.blue("  -> Generating API documentation setup..."));
      await fs.ensureDir(path.join(destSrcDir, "utils"));
      // FIX: Added 'paths' to the EJS data object
      await renderAndWrite(
        getTemplatePath("node-ts-express/partials/ApiDocs.ts.ejs"),
        path.join(destSrcDir, "utils", "swagger.ts"),
        { projectName, port, addAuth, paths: endpoints }
      );
    }

    if (extraFeatures.includes("testing")) {
      console.log(chalk.blue("  -> Generating testing boilerplate..."));
      const jestConfig =
        "/** @type {import('ts-jest').JestConfigWithTsJest} */\nmodule.exports = {\n  preset: 'ts-jest',\n  testEnvironment: 'node',\n  verbose: true,\n};";

      await fs.writeFile(path.join(projectDir, "jest.config.js"), jestConfig);
      await fs.ensureDir(path.join(projectDir, "src", "__tests__"));

      await renderAndWrite(
        getTemplatePath("node-ts-express/partials/App.test.ts.ejs"),
        path.join(projectDir, "src", "__tests__", "api.test.ts"),
        { addAuth, endpoints }
      );
    }

    // --- Step 9: routes.ts + server inject ---
    const nonAuthEndpoints = endpoints.filter((ep) => safePascalName(ep.controllerName) !== "Auth");

    await renderAndWrite(
      getTemplatePath("node-ts-express/partials/routes.ts.ejs"),
      path.join(destSrcDir, "routes.ts"),
      { endpoints: nonAuthEndpoints, addAuth, dbType }
    );

    let serverFileContent = await fs.readFile(path.join(destSrcDir, "server.ts"), "utf-8");

    let dbConnectionCode = "";
    let swaggerInjector = "";
    let authRoutesInjector = "";

    if (dbType === "mongoose") {
      dbConnectionCode = `
import mongoose from 'mongoose';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/${projectName}';
mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Connected...'))
  .catch(err => console.error(err));
`;
    } else if (dbType === "prisma") {
      dbConnectionCode = `
import { PrismaClient } from '@prisma/client';
export const prisma = new PrismaClient();
`;
    }

    if (extraFeatures.includes("swagger")) {
      swaggerInjector = "\nimport { setupSwagger } from './utils/swagger';\nsetupSwagger(app);\n";
    }

    if (addAuth) {
      authRoutesInjector = "import authRoutes from './routes/Auth.routes';\napp.use('/api/auth', authRoutes);\n\n";
    }

    serverFileContent = serverFileContent
      .replace("dotenv.config();", `dotenv.config();${dbConnectionCode}`)
      .replace(
        "// INJECT:ROUTES",
        `${authRoutesInjector}import apiRoutes from './routes';
app.use('/api', apiRoutes);`
      );

    serverFileContent = serverFileContent.replace(/(app\.listen\()/, `${swaggerInjector}\n$1`);

    await fs.writeFile(path.join(destSrcDir, "server.ts"), serverFileContent);

    // --- Step 10: Install deps ---
    console.log(chalk.magenta("  -> Installing dependencies... This may take a moment."));
    await execa("npm", ["install"], { cwd: projectDir });

    if (dbType === "prisma") {
      console.log(chalk.blue("  -> Running `prisma generate`..."));
      await execa("npx", ["prisma", "generate"], { cwd: projectDir });
    }

    // --- Step 11: .env.example ---
    let envContent = `PORT=${port}\n`;
    if (dbType === "mongoose") envContent += `MONGO_URI=mongodb://127.0.0.1:27017/${projectName}\n`;
    if (dbType === "prisma") envContent += `DATABASE_URL="postgresql://user:password@localhost:5432/${projectName}?schema=public"\n`;
    if (addAuth) envContent += "JWT_SECRET=your_super_secret_jwt_key_12345\nJWT_EXPIRES_IN=5h\n";

    await fs.writeFile(path.join(projectDir, ".env.example"), envContent);

    console.log(chalk.green("  -> Node backend generation complete."));
  } catch (error) {
    throw error;
  }
}

module.exports = { generateNodeProject };