const chalk = require('chalk');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const unzipper = require('unzipper');
const { analyzeFrontend } = require('../analyzer');
const { renderAndWrite, getTemplatePath } = require('./template');

function sanitizeArtifactId(name) {
  return String(name || 'backend')
    .toLowerCase()
    .replace(/[^a-z0-9\-]/g, '-')
    .replace(/-+/g, '-');
}

async function downloadInitializrZip({ groupId, artifactId, name, bootVersion, dependencies }) {
  const params = new URLSearchParams({
    type: 'maven-project',
    language: 'java',
    groupId,
    artifactId,
    name,
    packageName: `${groupId}.${artifactId.replace(/-/g, '')}`,
    dependencies: dependencies.join(','),
  });
  if (bootVersion) params.set('bootVersion', bootVersion);

  const url = `https://start.spring.io/starter.zip?${params.toString()}`;
  return axios.get(url, {
    responseType: 'stream',
    headers: { Accept: 'application/zip' }
  });
}

async function extractZipStream(stream, dest) {
  await new Promise((resolve, reject) => {
    const out = stream.pipe(unzipper.Extract({ path: dest }));
    out.on('close', resolve);
    out.on('finish', resolve);
    out.on('error', reject);
  });
}

function groupByController(endpoints) {
  const map = new Map();
  for (const ep of endpoints || []) {
    const c = ep.controllerName || 'Default';
    if (!map.has(c)) map.set(c, []);
    map.get(c).push(ep);
  }
  return map;
}

function collectModelsForJava(endpointsByController) {
  // Produces one Entity per controller + DTOs per endpoint body/response if provided by analyzer.
  const entities = new Map(); // controllerName -> {name, fields}
  const dtos = new Map();     // dtoName -> {name, fields}

  for (const [controllerName, eps] of endpointsByController.entries()) {
    if (controllerName === 'Default') continue;

    // Entity fields heuristic: merge requestBody fields across endpoints
    const mergedFields = {};
    for (const ep of eps) {
      if (ep.requestBody?.fields) {
        for (const [k, t] of Object.entries(ep.requestBody.fields)) mergedFields[k] = t;
      }
    }

    if (Object.keys(mergedFields).length > 0) {
      entities.set(controllerName, { name: controllerName, fields: mergedFields });
    }

    // DTOs from analyzer if exists
    for (const ep of eps) {
      if (ep.requestBody?.modelName && ep.requestBody?.fields) {
        dtos.set(ep.requestBody.modelName, { name: ep.requestBody.modelName, fields: ep.requestBody.fields });
      }
      if (ep.responseBody?.modelName && ep.responseBody?.fields) {
        dtos.set(ep.responseBody.modelName, { name: ep.responseBody.modelName, fields: ep.responseBody.fields });
      }
    }
  }

  return { entities, dtos };
}

async function upsertApplicationProperties(projectDir, artifactId) {
  const propsPath = path.join(projectDir, 'src', 'main', 'resources', 'application.properties');
  if (!await fs.pathExists(propsPath)) return;

  const start = '# <backlist:db>';
  const end = '# </backlist:db>';

  const dbProps = [
    start,
    `spring.datasource.url=jdbc:postgresql://localhost:5432/${artifactId}`,
    `spring.datasource.username=postgres`,
    `spring.datasource.password=password`,
    `spring.jpa.hibernate.ddl-auto=update`,
    `spring.jpa.show-sql=true`,
    end,
    ''
  ].join('\n');

  const current = await fs.readFile(propsPath, 'utf-8');

  if (current.includes(start) && current.includes(end)) {
    // replace existing block
    const replaced = current.replace(new RegExp(`${start}[\\s\\S]*?${end}`), dbProps.trim());
    await fs.writeFile(propsPath, replaced);
  } else {
    await fs.appendFile(propsPath, `\n\n${dbProps}`);
  }
}

async function generateJavaProject(options) {
  const { projectDir, projectName, frontendSrcDir } = options;
  const groupId = 'com.backlist.generated';
  const artifactId = sanitizeArtifactId(projectName || 'backend');
  const basePackage = `${groupId}.${artifactId.replace(/-/g, '')}`;

  try {
    console.log(chalk.blue('  -> Downloading base Spring Boot project from Initializr...'));

    const deps = ['web', 'data-jpa', 'lombok', 'postgresql'];

    let response;
    try {
      response = await downloadInitializrZip({
        groupId, artifactId, name: projectName || 'backend',
        bootVersion: '3.3.4',
        dependencies: deps
      });
    } catch (err) {
      console.log(chalk.yellow('    -> Retry without fixed bootVersion...'));
      response = await downloadInitializrZip({
        groupId, artifactId, name: projectName || 'backend',
        bootVersion: '',
        dependencies: deps
      });
    }

    console.log(chalk.blue('  -> Unzipping...'));
    await extractZipStream(response.data, projectDir);

    console.log(chalk.blue('  -> Analyzing frontend (AST) for endpoints/contracts...'));
    const endpoints = await analyzeFrontend(frontendSrcDir);

    const endpointsByController = groupByController(endpoints);
    const { entities, dtos } = collectModelsForJava(endpointsByController);

    console.log(chalk.green(`  -> Found ${Array.isArray(endpoints) ? endpoints.length : 0} endpoints`));
    console.log(chalk.green(`  -> Will generate ${entities.size} entities, ${dtos.size} DTOs, ${endpointsByController.size} controllers`));

    // Compute java src root
    const javaSrcRoot = path.join(
      projectDir,
      'src', 'main', 'java',
      ...groupId.split('.'),
      artifactId.replace(/-/g, '')
    );

    const entityDir = path.join(javaSrcRoot, 'model');
    const dtoDir = path.join(javaSrcRoot, 'dto');
    const repoDir = path.join(javaSrcRoot, 'repository');
    const controllerDir = path.join(javaSrcRoot, 'controller');

    await fs.ensureDir(entityDir);
    await fs.ensureDir(dtoDir);
    await fs.ensureDir(repoDir);
    await fs.ensureDir(controllerDir);

    // Entities + Repos
    for (const ent of entities.values()) {
      await renderAndWrite(
        getTemplatePath('java-spring/partials/Entity.java.ejs'),
        path.join(entityDir, `${ent.name}.java`),
        { basePackage, model: ent }
      );

      await renderAndWrite(
        getTemplatePath('java-spring/partials/Repository.java.ejs'),
        path.join(repoDir, `${ent.name}Repository.java`),
        { basePackage, entityName: ent.name }
      );
    }

    // DTOs
    for (const dto of dtos.values()) {
      await renderAndWrite(
        getTemplatePath('java-spring/partials/Dto.java.ejs'),
        path.join(dtoDir, `${dto.name}.java`),
        { basePackage, dto }
      );
    }

    // Controllers from endpoints
    for (const [controllerName, eps] of endpointsByController.entries()) {
      if (controllerName === 'Default') continue;

      await renderAndWrite(
        getTemplatePath('java-spring/partials/Controller.FromEndpoints.java.ejs'),
        path.join(controllerDir, `${controllerName}Controller.java`),
        {
          basePackage,
          controllerName,
          endpoints: eps,
          hasEntity: entities.has(controllerName)
        }
      );
    }

    // application.properties idempotent update
    await upsertApplicationProperties(projectDir, artifactId);

    console.log(chalk.green('  -> Java (Spring Boot) backend generation is complete!'));
    console.log(chalk.yellow('\nNext steps:'));
    console.log(chalk.cyan(`  cd ${path.basename(projectDir)}`));
    console.log(chalk.cyan('  ./mvnw spring-boot:run'));

  } catch (error) {
    if (error.response && error.response.status) {
      throw new Error(`Failed to download from Spring Initializr. Status: ${error.response.status}`);
    }
    throw error;
  }
}

module.exports = { generateJavaProject };