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
  console.log(chalk.cyan.bold('🚀 Welcome to Backlist! The Production-Ready Backend Generator.'));
  
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
        { name: 'Python (FastAPI) - Coming Soon', disabled: true, value: 'python-fastapi' },
        { name: 'Java (Spring Boot) - Coming Soon', disabled: true, value: 'java-spring' },
      ],
    },
    // --- V5.0: Database Choice for Node.js ---
    {
      type: 'list',
      name: 'dbType',
      message: 'Select your database type:',
      choices: [
        { name: 'NoSQL (MongoDB with Mongoose)', value: 'mongoose' },
        { name: 'SQL (PostgreSQL/MySQL with Prisma)', value: 'prisma' },
      ],
      when: (answers) => answers.stack === 'node-ts-express'
    },
    {
      type: 'input',
      name: 'srcPath',
      message: 'Enter the path to your frontend `src` directory:',
      default: 'src',
    },
    // --- V3.0: Auth Boilerplate for Node.js ---
    {
      type: 'confirm',
      name: 'addAuth',
      message: 'Add JWT authentication boilerplate?',
      default: true,
      when: (answers) => answers.stack === 'node-ts-express'
    },
    // --- V4.0: Seeder for Node.js ---
    {
      type: 'confirm',
      name: 'addSeeder',
      message: 'Add a database seeder with sample data?',
      default: true,
      when: (answers) => answers.addAuth // Seeder is useful when there's an auth/user model
    },
    // --- V5.0: Extra Features for Node.js ---
    {
      type: 'checkbox',
      name: 'extraFeatures',
      message: 'Select additional features to include:',
      choices: [
          { name: 'Docker Support (Dockerfile & docker-compose.yml)', value: 'docker', checked: true },
          { name: 'API Testing Boilerplate (Jest & Supertest)', value: 'testing' },
          { name: 'API Documentation (Swagger UI)', value: 'swagger' },
      ],
      when: (answers) => answers.stack === 'node-ts-express'
    },
     {
      type: 'list',
      name: 'dbType',
      message: 'Select your database type:',
      choices: [
        { name: 'NoSQL (MongoDB with Mongoose)', value: 'mongoose' },
        { name: 'SQL (PostgreSQL/MySQL with Prisma)', value: 'prisma' },
      ],
      when: (answers) => answers.stack === 'node-ts-express'
    },
    {
        type: 'checkbox',
        name: 'extraFeatures',
        message: 'Select additional features to include:',
        choices: [
            { name: 'Docker Support (Dockerfile & docker-compose.yml)', value: 'docker', checked: true },
            // ... other features
        ],
        when: (answers) => answers.stack === 'node-ts-express'
    },
     {
      type: 'list',
      name: 'stack',
      message: 'Select the backend stack:',
      choices: [
        { name: 'Node.js (TypeScript, Express)', value: 'node-ts-express' },
        { name: 'C# (ASP.NET Core Web API)', value: 'dotnet-webapi' },
        new inquirer.Separator(),
        { name: 'Python (FastAPI) - Coming Soon', disabled: true, value: 'python-fastapi' },
        { name: 'Java (Spring Boot)', value: 'java-spring' }, // <-- ENABLED!
      ],
    },
  ]);

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
        await generateNodeProject(options);
        break;

      case 'dotnet-webapi':
        if (!await isCommandAvailable('dotnet')) {
          throw new Error('.NET SDK is not installed. Please install it from https://dotnet.microsoft.com/download');
        }
        // Note: The dotnet generator currently only supports basic route generation (v1.0 features).
        await generateDotnetProject(options);
        break;
      
      default:
        throw new Error(`The selected stack '${options.stack}' is not supported yet.`);
    }

    console.log(chalk.green.bold('\n✅ Backend generation complete!'));
    console.log('\nNext Steps:');
    console.log(chalk.cyan(`  cd ${options.projectName}`));
    console.log(chalk.cyan('  (Check the generated README.md for instructions)'));

  } catch (error) {
    console.error(chalk.red.bold('\n❌ An error occurred during generation:'));
    // Make sure we print the full error for debugging
    console.error(error); 
    
    if (fs.existsSync(options.projectDir)) {
      console.log(chalk.yellow('  -> Cleaning up failed installation...'));
      fs.removeSync(options.projectDir);
    }
    process.exit(1);
  }
}

main();