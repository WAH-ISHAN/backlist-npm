const chalk = require('chalk');
const { execa } = require('execa');
const fs = require('fs-extra');
const path = require('path');
const { analyzeFrontend } = require('../analyzer');
const { renderAndWrite, getTemplatePath } = require('./template');

async function generateDotnetProject(options) {
  const { projectDir, projectName, frontendSrcDir } = options;

  console.log(chalk.blue('  -> Analyzing frontend for API endpoints...'));
  const endpoints = await analyzeFrontend(frontendSrcDir);

  const controllers = endpoints.reduce((acc, ep) => {
    (acc[ep.controllerName] = acc[ep.controllerName] || []).push(ep);
    return acc;
  }, {});
  
  if (Object.keys(controllers).length > 0) {
    console.log(chalk.green(`  -> Found endpoints for ${Object.keys(controllers).length} controllers.`));
  } else {
    console.log(chalk.yellow('  -> No API endpoints found. A basic project will be created.'));
  }
  
  console.log(chalk.blue('  -> Scaffolding .NET Core Web API project...'));
  await execa('dotnet', ['new', 'webapi', '-n', projectName, '-o', projectDir, '--no-https']);
  
  await fs.remove(path.join(projectDir, 'Controllers', 'WeatherForecastController.cs'));
  await fs.remove(path.join(projectDir, 'WeatherForecast.cs'));
  
  console.log(chalk.blue('  -> Generating custom controllers...'));
  for (const controllerName of Object.keys(controllers)) {
    if (controllerName === 'Default') continue; // Skip if no proper controller name was found
    await renderAndWrite(
      getTemplatePath('dotnet/partials/Controller.cs.ejs'),
      path.join(projectDir, 'Controllers', `${controllerName}Controller.cs`),
      { 
        projectName,
        controllerName,
        endpoints: controllers[controllerName]
      }
    );
  }

  await renderAndWrite(
    getTemplatePath('dotnet/partials/README.md.ejs'),
    path.join(projectDir, 'README.md'),
    { projectName }
  );
}

module.exports = { generateDotnetProject };