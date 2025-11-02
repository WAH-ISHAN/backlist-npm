#!/usr/bin/env node

const inquirer = require('inquirer');
const chalk = require('chalk');
const fs = require('fs-extra');
const path = 'path';
const { isCommandAvailable } = require('../src/utils');

// Import ALL generators
const { generateNodeProject } = require('../src/generators/node');
const { generateDotnetProject } = require('../src/generators/dotnet');
const { generateJavaProject } = require('../src/generators/java');
const { generatePythonProject } = require('../src/generators/python');

async function main() {
  console.log(chalk.cyan.bold('🚀 Welcome to Backlist! The Polyglot Backend Generator.'));
  
  const answers = await inquirer.prompt([
    // --- General Questions ---
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
        { name: 'Java (Spring Boot)', value: 'java-spring' },
        { name: 'Python (FastAPI)', value: 'python-fastapi' },
      ],
    },
    {
      type: 'input',
      name: 'srcPath',
      message: 'Enter the path to your frontend `src` directory:',
      default: 'src',
    },

    // --- Node.js Specific Questions ---
    {
      type: 'list',
      name: 'dbType',
      message: 'Select your database type for Node.js:',
      choices: [
        { name: 'NoSQL (MongoDB with Mongoose)', value: 'mongoose' },
        { name: 'SQL (PostgreSQL/MySQL with Prisma)', value: 'prisma' },
      ],
      when: (answers) => answers.stack === 'node-ts-express'
    },
    {
      type: 'confirm',
      name: 'addAuth',
      message: 'Add JWT authentication boilerplate?',
      default: true,
      when: (answers) => answers.stack === 'node-ts-express'
    },
    {
      type: 'confirm',
      name: 'addSeeder',
      message: 'Add a database seeder with sample data?',
      default: true,
      // Seeder only makes sense if there's an auth/user model to seed
      when: (answers) => answers.stack === 'node-ts-express' && answers.addAuth
    },
    {
      type: 'checkbox',
      name: 'extraFeatures',
      message: 'Select additional features for Node.js:',
      choices: [
          { name: 'Docker Support (Dockerfile & docker-compose.yml)', value: 'docker', checked: true },
          { name: 'API Testing Boilerplate (Jest & Supertest)', value: 'testing', checked: true },
          { name: 'API Documentation (Swagger UI)', value: 'swagger', checked: true },
      ],
      when: (answers) => answers.stack === 'node-ts-express'
    }
  ]);

  const options = {
    ...answers,
    projectDir: path.resolve(process.cwd(), answers.projectName),
    frontendSrcDir: path.resolve(process.cwd(), answers.srcPath),
  };

  try {
    console.log(chalk.blue(`\n✨ Starting backend generation for: ${chalk.bold(options.stack)}`));

    // --- Dispatcher Logic for ALL Stacks ---
    switch (options.stack) {
      case 'node-ts-express':
        await generateNodeProject(options);
        break;

      case 'dotnet-webapi':
        if (!await isCommandAvailable('dotnet')) {
          throw new Error('.NET SDK is not installed. Please install it from https://dotnet.microsoft.com/download');
        }
        await generateDotnetProject(options);
        break;

      case 'java-spring':
        if (!await isCommandAvailable('java')) {
          throw new Error('Java (JDK 17 or newer) is not installed. Please install a JDK to continue.');
        }
        await generateJavaProject(options); 
        break;
      
      case 'python-fastapi':
        if (!await isCommandAvailable('python')) {
            throw new Error('Python is not installed. Please install Python (3.8+) and pip to continue.');
        }
        await generatePythonProject(options);
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
    console.error(error); 
    
    if (fs.existsSync(options.projectDir)) {
      console.log(chalk.yellow('  -> Cleaning up failed installation...'));
      fs.removeSync(options.projectDir);
    }
    process.exit(1);
  }
}

main();