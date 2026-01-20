#!/usr/bin/env node

const inquirer = require('inquirer');
const chalk = require('chalk');
const fs = require('fs-extra');
const path = require('path');
const { Command } = require('commander');
const chokidar = require('chokidar');

const { isCommandAvailable } = require('../src/utils');

const { generateNodeProject } = require('../src/generators/node');
const { generateDotnetProject } = require('../src/generators/dotnet');
const { generateJavaProject } = require('../src/generators/java');
const { generatePythonProject } = require('../src/generators/python');

const { scanFrontend, writeContracts } = require('../src/scanner');

function resolveOptionsFromFlags(flags) {
  return {
    projectName: flags.projectName || 'backend',
    srcPath: flags.srcPath || 'src',
    stack: flags.stack || 'node-ts-express',
    dbType: flags.dbType,
    addAuth: flags.addAuth,
    addSeeder: flags.addSeeder,
    extraFeatures: flags.extraFeatures || [],
    projectDir: path.resolve(process.cwd(), flags.projectName || 'backend'),
    frontendSrcDir: path.resolve(process.cwd(), flags.srcPath || 'src'),
  };
}

async function runGeneration(options, contracts) {
  switch (options.stack) {
    case 'node-ts-express':
      await generateNodeProject({ ...options, contracts });
      break;

    case 'dotnet-webapi':
      if (!await isCommandAvailable('dotnet')) {
        throw new Error('.NET SDK is not installed. Please install it from https://dotnet.microsoft.com/download');
      }
      await generateDotnetProject({ ...options, contracts });
      break;

    case 'java-spring':
      if (!await isCommandAvailable('java')) {
        throw new Error('Java (JDK 17 or newer) is not installed. Please install a JDK to continue.');
      }
      await generateJavaProject({ ...options, contracts });
      break;

    case 'python-fastapi':
      if (!await isCommandAvailable('python')) {
        throw new Error('Python is not installed. Please install Python (3.8+) and pip to continue.');
      }
      await generatePythonProject({ ...options, contracts });
      break;

    default:
      throw new Error(`The selected stack '${options.stack}' is not supported yet.`);
  }
}

async function interactiveMain() {
  console.log(chalk.cyan.bold('Welcome to Backlist! The Polyglot Backend Generator.'));

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

  const contracts = await scanFrontend({ frontendSrcDir: options.frontendSrcDir });

  try {
    console.log(chalk.blue(`\nStarting backend generation for: ${chalk.bold(options.stack)}`));
    await runGeneration(options, contracts);

    console.log(chalk.green.bold('\nBackend generation complete!'));
    console.log('\nNext Steps:');
    console.log(chalk.cyan(`  cd ${options.projectName}`));
    console.log(chalk.cyan('  (Check the generated README.md for instructions)'));
  } catch (error) {
    console.error(chalk.red.bold('\nAn error occurred during generation:'));
    console.error(error);

    if (fs.existsSync(options.projectDir)) {
      console.log(chalk.yellow('  -> Cleaning up failed installation...'));
      fs.removeSync(options.projectDir);
    }
    process.exit(1);
  }
}

async function main() {
  const program = new Command();

  program
    .name('backlist')
    .description('Backlist CLI - generate backend from frontend via AST scan')
    .version('1.0.0');

  program.command('scan')
    .description('Scan frontend and write contracts JSON')
    .option('-s, --srcPath <path>', 'frontend src path', 'src')
    .option('-o, --out <file>', 'output contracts file', '.backlist/contracts.json')
    .action(async (flags) => {
      const frontendSrcDir = path.resolve(process.cwd(), flags.srcPath);
      const outFile = path.resolve(process.cwd(), flags.out);
      const contracts = await scanFrontend({ frontendSrcDir });
      await writeContracts(outFile, contracts);
      console.log(chalk.green(`Wrote contracts to ${outFile}`));
    });

  program.command('generate')
    .description('Generate backend using contracts')
    .requiredOption('-k, --stack <stack>', 'stack: node-ts-express | dotnet-webapi | java-spring | python-fastapi')
    .option('-p, --projectName <name>', 'backend directory', 'backend')
    .option('-s, --srcPath <path>', 'frontend src path', 'src')
    .option('-c, --contracts <file>', 'contracts file', '.backlist/contracts.json')
    .action(async (flags) => {
      const options = resolveOptionsFromFlags(flags);
      const contractsPath = path.resolve(process.cwd(), flags.contracts);
      const contracts = fs.existsSync(contractsPath)
        ? await fs.readJson(contractsPath)
        : await scanFrontend({ frontendSrcDir: options.frontendSrcDir });

      await runGeneration(options, contracts);
      console.log(chalk.green('Generation complete.'));
    });

  program.command('watch')
    .description('Watch frontend and regenerate backend on changes')
    .requiredOption('-k, --stack <stack>', 'stack')
    .option('-p, --projectName <name>', 'backend directory', 'backend')
    .option('-s, --srcPath <path>', 'frontend src path', 'src')
    .action(async (flags) => {
      const options = resolveOptionsFromFlags(flags);
      const watcher = chokidar.watch(options.frontendSrcDir, { ignoreInitial: true });

      const run = async () => {
        const contracts = await scanFrontend({ frontendSrcDir: options.frontendSrcDir });
        await runGeneration(options, contracts);
        console.log(chalk.green(`[watch] regenerated at ${new Date().toLocaleTimeString()}`));
      };

      await run();
      watcher.on('add', run).on('change', run).on('unlink', run);
      console.log(chalk.cyan(`[watch] watching ${options.frontendSrcDir}`));
    });

  // If no args => old interactive mode
  if (process.argv.length <= 2) {
    await interactiveMain();
    return;
  }

  await program.parseAsync(process.argv);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});