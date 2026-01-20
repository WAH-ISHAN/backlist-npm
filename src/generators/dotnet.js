const chalk = require('chalk');
const { execa } = require('execa');
const fs = require('fs-extra');
const path = require('path');
const { analyzeFrontend } = require('../analyzer');
const { renderAndWrite, getTemplatePath } = require('./template');

function groupByController(endpoints) {
  const map = new Map();
  for (const ep of endpoints) {
    const c = ep.controllerName || 'Default';
    if (!map.has(c)) map.set(c, []);
    map.get(c).push(ep);
  }
  return map;
}

function collectDtoModels(endpoints) {
  const models = new Map();

  for (const ep of endpoints) {
    if (ep.requestBody?.fields && ep.requestBody.modelName) {
      models.set(ep.requestBody.modelName, { name: ep.requestBody.modelName, fields: ep.requestBody.fields });
    }
    if (ep.responseBody?.fields && ep.responseBody.modelName) {
      models.set(ep.responseBody.modelName, { name: ep.responseBody.modelName, fields: ep.responseBody.fields });
    }
  }

  return models;
}

async function ensureProgramMarkers(programCsPath) {
  let content = await fs.readFile(programCsPath, 'utf-8');

  if (!content.includes('<backlist:usings>')) {
    // add marker near top
    content = content.replace(
      /^/m,
      `// <backlist:usings>\n// </backlist:usings>\n\n`
    );
  }
  if (!content.includes('<backlist:services>')) {
    content = content.replace(
      'builder.Services.AddControllers();',
      `builder.Services.AddControllers();\n\n// <backlist:services>\n// </backlist:services>`
    );
  }
  if (!content.includes('<backlist:middleware>')) {
    content = content.replace(
      'var app = builder.Build();',
      `var app = builder.Build();\n\n// <backlist:middleware>\n// </backlist:middleware>\n`
    );
  }

  await fs.writeFile(programCsPath, content);
}

function insertBetweenMarkers(content, markerName, insertText) {
  const start = `// <backlist:${markerName}>`;
  const end = `// </backlist:${markerName}>`;

  const s = content.indexOf(start);
  const e = content.indexOf(end);
  if (s === -1 || e === -1 || e < s) return content;

  const before = content.slice(0, s + start.length);
  const after = content.slice(e);

  return `${before}\n${insertText}\n${after}`;
}

async function generateDotnetProject(options) {
  const { projectDir, projectName, frontendSrcDir } = options;

  try {
    console.log(chalk.blue('  -> Analyzing frontend for C# backend (AST)...'));
    const endpoints = await analyzeFrontend(frontendSrcDir);

    const byController = groupByController(endpoints);
    const dtoModels = collectDtoModels(endpoints);

    console.log(chalk.green(`  -> Found ${endpoints.length} endpoints, ${dtoModels.size} DTO models, ${byController.size} controllers.`));

    // Scaffold base project
    console.log(chalk.blue('  -> Scaffolding .NET Core Web API project...'));
    await execa('dotnet', ['new', 'webapi', '-n', projectName, '-o', projectDir, '--no-https']);

    // Remove WeatherForecast
    await fs.remove(path.join(projectDir, 'Controllers', 'WeatherForecastController.cs'));
    await fs.remove(path.join(projectDir, 'WeatherForecast.cs'));

    // Generate DTOs
    if (dtoModels.size > 0) {
      console.log(chalk.blue('  -> Generating DTO models...'));
      const dtoDir = path.join(projectDir, 'Models', 'DTOs');
      await fs.ensureDir(dtoDir);

      for (const model of dtoModels.values()) {
        await renderAndWrite(
          getTemplatePath('dotnet/partials/Dto.cs.ejs'),
          path.join(dtoDir, `${model.name}.cs`),
          { projectName, model }
        );
      }
    }

    // Generate Controllers from endpoints (not CRUD stub)
    console.log(chalk.blue('  -> Generating controllers from detected endpoints...'));
    const controllersDir = path.join(projectDir, 'Controllers');
    await fs.ensureDir(controllersDir);

    for (const [controllerName, controllerEndpoints] of byController.entries()) {
      if (controllerName === 'Default') continue;

      await renderAndWrite(
        getTemplatePath('dotnet/partials/Controller.FromEndpoints.cs.ejs'),
        path.join(controllersDir, `${controllerName}Controller.cs`),
        { projectName, controllerName, endpoints: controllerEndpoints }
      );
    }

    // Program.cs markers + CORS insert (idempotent)
    console.log(chalk.blue('  -> Configuring Program.cs (idempotent markers)...'));
    const programCsPath = path.join(projectDir, 'Program.cs');
    await ensureProgramMarkers(programCsPath);

    let programCsContent = await fs.readFile(programCsPath, 'utf-8');

    const corsBlock = `
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
        policy.WithOrigins("http://localhost:3000", "http://localhost:5173")
              .AllowAnyHeader()
              .AllowAnyMethod()
    );
});`.trim();

    programCsContent = insertBetweenMarkers(programCsContent, 'services', corsBlock);
    programCsContent = insertBetweenMarkers(programCsContent, 'middleware', 'app.UseCors();');

    await fs.writeFile(programCsPath, programCsContent);

    // README
    await renderAndWrite(
      getTemplatePath('dotnet/partials/README.md.ejs'),
      path.join(projectDir, 'README.md'),
      { projectName }
    );

    console.log(chalk.green('  -> C# backend generation is complete!'));

  } catch (error) {
    throw error;
  }
}

module.exports = { generateDotnetProject };