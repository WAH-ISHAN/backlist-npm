#!/usr/bin/env node

const inquirer = require('inquirer');
const chalk = require('chalk');
const fs = require('fs-extra');
const path = require('path');
const { isCommandAvailable } = require('../src/utils');

// Import generators
const { generateNodeProject } = require('../src/generators/node');
const { generateDotnetProject } = require('../src/generators/dotnet');

async function main() {
  console.log(chalk.cyan.bold('🚀 Welcome to Backlist! The Intelligent Backend Generator.'));
  
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'projectName',
      message: 'Enter a name for your backend directory:',
      default: 'backend',
      validate: input => input ? true : 'Project name cannot be empty.'
    },
    {
      type: 'list',
      name: 'stack',
      message: 'Select the backend stack:',
      choices: [
        { name: 'Node.js (TypeScript, Express)', value: 'node-ts-express' },
        { name: 'C# (ASP.NET Core Web API)', value: 'dotnet-webapi' },
        new inquirer.Separator(),
        { name: 'Python (FastAPI) - Coming Soon', disabled: true },
        { name: 'Java (Spring Boot) - Coming Soon', disabled: true },
      ],
    },
    {
        type: 'input',
        name: 'srcPath',
        message: 'Enter the path to your frontend `src` directory:',
        default: 'src',
    },
    // --- NEW QUESTION FOR V3.0 ---
    {
      type: 'confirm',
      name: 'addAuth',
      message: 'Do you want to add basic JWT authentication? (generates a User model, login/register routes)',
      default: true,
      // This question will only be asked if the user selects the Node.js stack
      when: (answers) => answers.stack === 'node-ts-express'
    }
  ]);

  // Pass all answers to the options object
  const options = {
    ...answers, 
    projectDir: path.resolve(process.cwd(), answers.projectName),
    frontendSrcDir: path.resolve(process.cwd(), answers.srcPath),
  };

  try {
    console.log(chalk.blue(`\n✨ Starting backend generation for: ${chalk.bold(options.stack)}`));

    // --- Dispatcher Logic ---
    switch (options.stack) {
      case 'node-ts-express':
        await generateNodeProject(options); // Pass the entire options object
        break;

      case 'dotnet-webapi':
        if (!await isCommandAvailable('dotnet')) {
          throw new Error('.NET SDK is not installed. Please install it from https://dotnet.microsoft.com/download');
        }
        await generateDotnetProject(options);

        break;
      
      default:
        throw new Error(`The selected stack '${options.stack}' is not supported.`);
    }

    console.log(chalk.green.bold('\n✅ Backend generation complete!'));
    console.log('\nNext Steps:');
    console.log(chalk.cyan(`  cd ${options.projectName}`));
    console.log(chalk.cyan('  (Check the generated README.md for instructions)'));

  } catch (error) {
    console.error(chalk.red.bold('\n❌ An error occurred:'));
    console.error(chalk.red(`  ${error.message}`));
    
    if (fs.existsSync(options.projectDir)) {
      console.log(chalk.yellow('  -> Cleaning up failed installation...'));
      fs.removeSync(options.projectDir);
    }
    process.exit(1);
  }
}

main();