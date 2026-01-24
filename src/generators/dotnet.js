const chalk = require('chalk')
const { execa } = require('execa')
const fs = require('fs-extra')
const path = require('path')
const { analyzeFrontend } = require('../analyzer')
const { renderAndWrite, getTemplatePath } = require('./template')

async function generateDotnetProject (options) {
  const { projectDir, projectName, frontendSrcDir } = options

  try {
    // --- Step 1: Analysis & Model Identification ---
    console.log(chalk.blue('  -> Analyzing frontend for C# backend...'))
    const endpoints = await analyzeFrontend(frontendSrcDir)
    const modelsToGenerate = new Map()
    endpoints.forEach(ep => {
      // For C#, we create a model if schemaFields exist for any endpoint related to a controller
      if (ep.schemaFields && ep.controllerName !== 'Default' && !modelsToGenerate.has(ep.controllerName)) {
        modelsToGenerate.set(ep.controllerName, {
          name: ep.controllerName,
          fields: Object.entries(ep.schemaFields).map(([key, type]) => ({ name: key, type }))
        })
      }
    })

    if (modelsToGenerate.size > 0) {
      console.log(chalk.green(`  -> Identified ${modelsToGenerate.size} models/controllers to generate.`))
    } else {
      console.log(chalk.yellow('  -> No API calls with body data found. A basic API project will be created without models.'))
    }

    // --- Step 2: Create Base .NET Project using `dotnet new` ---
    console.log(chalk.blue('  -> Scaffolding .NET Core Web API project...'))
    await execa('dotnet', ['new', 'webapi', '-n', projectName, '-o', projectDir, '--no-https'])

    // --- Step 3: Add Required NuGet Packages ---
    if (modelsToGenerate.size > 0) {
      console.log(chalk.blue('  -> Adding NuGet packages (Entity Framework Core)...'))
      const packages = [
        'Microsoft.EntityFrameworkCore.Design',
        'Microsoft.EntityFrameworkCore.InMemory' // Using InMemory for a simple, runnable setup
        // For a real DB, a user would add: 'Npgsql.EntityFrameworkCore.PostgreSQL' or 'Microsoft.EntityFrameworkCore.SqlServer'
      ]
      for (const pkg of packages) {
        await execa('dotnet', ['add', 'package', pkg], { cwd: projectDir })
      }
    }

    // --- Step 4: Generate Models and DbContext from Templates ---
    if (modelsToGenerate.size > 0) {
      console.log(chalk.blue('  -> Generating EF Core models and DbContext...'))
      const modelsDir = path.join(projectDir, 'Models')
      const dataDir = path.join(projectDir, 'Data')
      await fs.ensureDir(modelsDir)
      await fs.ensureDir(dataDir)

      for (const [modelName, modelData] of modelsToGenerate.entries()) {
        await renderAndWrite(
          getTemplatePath('dotnet/partials/Model.cs.ejs'),
          path.join(modelsDir, `${modelName}.cs`),
          { projectName, modelName, model: modelData }
        )
      }

      await renderAndWrite(
        getTemplatePath('dotnet/partials/DbContext.cs.ejs'),
        path.join(dataDir, 'ApplicationDbContext.cs'),
        { projectName, modelsToGenerate: Array.from(modelsToGenerate.values()) }
      )
    }

    // --- Step 5: Configure Services in Program.cs ---
    console.log(chalk.blue('  -> Configuring services in Program.cs...'))
    const programCsPath = path.join(projectDir, 'Program.cs')
    let programCsContent = await fs.readFile(programCsPath, 'utf-8')

    const usingStatements = 'using Microsoft.EntityFrameworkCore;\nusing ' + projectName + '.Data;\n'
    programCsContent = usingStatements + programCsContent

    const dbContextService = '// Configure the database context\nbuilder.Services.AddDbContext<ApplicationDbContext>(opt => opt.UseInMemoryDatabase("MyDb"));'
    programCsContent = programCsContent.replace('builder.Services.AddControllers();', `builder.Services.AddControllers();\n\n${dbContextService}`)

    // Enable CORS to allow frontend communication
    const corsPolicy = `
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(
        policy =>
        {
            policy.WithOrigins("http://localhost:3000", "http://localhost:5173") // Common frontend dev ports
                   .AllowAnyHeader()
                   .AllowAnyMethod();
        });
});`
    programCsContent = programCsContent.replace('var app = builder.Build();', `${corsPolicy}\n\nvar app = builder.Build();\n\napp.UseCors();`)

    await fs.writeFile(programCsPath, programCsContent)

    // --- Step 6: Generate Controllers with full CRUD ---
    console.log(chalk.blue('  -> Generating controllers with CRUD logic...'))
    await fs.remove(path.join(projectDir, 'Controllers', 'WeatherForecastController.cs'))
    await fs.remove(path.join(projectDir, 'WeatherForecast.cs'))

    const controllersToGenerate = new Set(Array.from(modelsToGenerate.keys()))
    // Also add controllers for endpoints that didn't have a body but were detected
    endpoints.forEach(ep => {
      if (ep.controllerName !== 'Default') controllersToGenerate.add(ep.controllerName)
    })

    for (const controllerName of controllersToGenerate) {
      await renderAndWrite(
        getTemplatePath('dotnet/partials/Controller.cs.ejs'),
        path.join(projectDir, 'Controllers', `${controllerName}Controller.cs`),
        { projectName, controllerName }
      )
    }

    // --- Step 7: Generate README ---
    await renderAndWrite(
      getTemplatePath('dotnet/partials/README.md.ejs'),
      path.join(projectDir, 'README.md'),
      { projectName }
    )

    console.log(chalk.green('  -> C# backend generation is complete!'))
  } catch (error) {
    // Re-throw the error to be caught by the main CLI handler
    throw error
  }
}

module.exports = { generateDotnetProject }
