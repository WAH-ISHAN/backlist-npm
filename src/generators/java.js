const chalk = require('chalk')
const { execa } = require('execa')
const fs = require('fs-extra')
const path = require('path')
const axios = require('axios')
const unzipper = require('unzipper')
const { analyzeFrontend } = require('../analyzer')
const { renderAndWrite, getTemplatePath } = require('./template')

function sanitizeArtifactId (name) {
  // Lowercase, keep letters, numbers and dashes; replace others with dashes
  return String(name || 'backend').toLowerCase().replace(/[^a-z0-9\-]/g, '-').replace(/-+/g, '-')
}

async function downloadInitializrZip ({ groupId, artifactId, name, bootVersion, dependencies }) {
  const params = new URLSearchParams({
    type: 'maven-project',
    language: 'java',
    groupId,
    artifactId,
    name,
    packageName: `${groupId}.${artifactId.replace(/-/g, '')}`, // com.example.myapp
    dependencies: dependencies.join(',')
  })

  if (bootVersion) params.set('bootVersion', bootVersion)

  const url = `https://start.spring.io/starter.zip?${params.toString()}`

  const res = await axios.get(url, {
    responseType: 'stream',
    headers: { Accept: 'application/zip' }
  })

  return res
}

async function extractZipStream (stream, dest) {
  await new Promise((resolve, reject) => {
    const out = stream.pipe(unzipper.Extract({ path: dest }))
    out.on('close', resolve)
    out.on('finish', resolve)
    out.on('error', reject)
  })
}

async function generateJavaProject (options) {
  const { projectDir, projectName, frontendSrcDir } = options
  const groupId = 'com.backlist.generated'
  const artifactId = sanitizeArtifactId(projectName || 'backend')
  const name = projectName || 'backend'

  try {
    console.log(chalk.blue('  -> Contacting Spring Initializr to download a base Spring Boot project...'))

    // Primary attempt: current stable Boot version. If this fails, we’ll retry without bootVersion.
    const deps = ['web', 'data-jpa', 'lombok', 'postgresql'] // valid Initializr ids

    let response
    try {
      response = await downloadInitializrZip({
        groupId,
        artifactId,
        name,
        bootVersion: '3.3.4', // current stable; adjust as needed
        dependencies: deps
      })
    } catch (err) {
      // Fallback – remove bootVersion and also try smaller dependency set if needed
      const fallbackDeps = ['web', 'data-jpa', 'lombok']
      try {
        console.log(chalk.yellow('    -> Initial attempt failed. Retrying with default Boot version...'))
        response = await downloadInitializrZip({
          groupId,
          artifactId,
          name,
          bootVersion: '', // let Initializr pick latest
          dependencies: deps
        })
      } catch {
        console.log(chalk.yellow('    -> Second attempt failed. Retrying with minimal dependencies...'))
        response = await downloadInitializrZip({
          groupId,
          artifactId,
          name,
          bootVersion: '',
          dependencies: fallbackDeps
        })
      }
    }

    console.log(chalk.blue('  -> Unzipping the Spring Boot project...'))
    await extractZipStream(response.data, projectDir)

    // Analyze frontend and plan entities/controllers
    const endpoints = await analyzeFrontend(frontendSrcDir)
    const modelsToGenerate = new Map();
    (Array.isArray(endpoints) ? endpoints : []).forEach(ep => {
      if (ep?.schemaFields && ep?.controllerName && ep.controllerName !== 'Default' && !modelsToGenerate.has(ep.controllerName)) {
        modelsToGenerate.set(ep.controllerName, {
          name: ep.controllerName,
          fields: Object.entries(ep.schemaFields).map(([key, type]) => ({ name: key, type }))
        })
      }
    })

    // Generate Entities/Repositories/Controllers (basic)
    if (modelsToGenerate.size > 0) {
      console.log(chalk.blue('  -> Generating Java entities, repositories, and controllers...'))

      // Spring Initializr zips project as <artifactId> root folder; if you extracted to projectDir,
      // files are already in the right place. Compute Java src path:
      const javaSrcRoot = path.join(projectDir, 'src', 'main', 'java', ...groupId.split('.'), artifactId.replace(/-/g, ''))
      const entityDir = path.join(javaSrcRoot, 'model')
      const repoDir = path.join(javaSrcRoot, 'repository')
      const controllerDir = path.join(javaSrcRoot, 'controller')

      await fs.ensureDir(entityDir)
      await fs.ensureDir(repoDir)
      await fs.ensureDir(controllerDir)

      for (const [modelName, modelData] of modelsToGenerate.entries()) {
        await renderAndWrite(
          getTemplatePath('java-spring/partials/Entity.java.ejs'),
          path.join(entityDir, `${modelName}.java`),
          { group: groupId, projectName: artifactId.replace(/-/g, ''), modelName, model: modelData }
        )
        await renderAndWrite(
          getTemplatePath('java-spring/partials/Repository.java.ejs'),
          path.join(repoDir, `${modelName}Repository.java`),
          { group: groupId, projectName: artifactId.replace(/-/g, ''), modelName }
        )
        await renderAndWrite(
          getTemplatePath('java-spring/partials/Controller.java.ejs'),
          path.join(controllerDir, `${modelName}Controller.java`),
          { group: groupId, projectName: artifactId.replace(/-/g, ''), controllerName: modelName, model: modelData }
        )
      }
    }

    // Append DB config (PostgreSQL) to application.properties (non-fatal if fails)
    try {
      const propsPath = path.join(projectDir, 'src', 'main', 'resources', 'application.properties')
      const dbProps = [
        '\n\n# --- Auto-generated by create-backlist ---',
        `spring.datasource.url=jdbc:postgresql://localhost:5432/${artifactId}`,
        'spring.datasource.username=postgres',
        'spring.datasource.password=password',
        'spring.jpa.hibernate.ddl-auto=update',
        'spring.jpa.show-sql=true'
      ].join('\n')
      await fs.appendFile(propsPath, dbProps)
    } catch (e) {
      console.log(chalk.yellow('  -> Could not update application.properties (continuing).'))
    }

    console.log(chalk.green('  -> Java (Spring Boot) backend generation is complete!'))
    console.log(chalk.yellow('\nNext steps:'))
    console.log(chalk.cyan(`  cd ${path.basename(projectDir)}`))
    console.log(chalk.cyan('  ./mvnw spring-boot:run   # or use your IDE to run Application class'))
  } catch (error) {
    if (error.response?.status) {
      console.error(chalk.red(`  -> Initializr error status: ${error.response.status}`))
      if (error.response?.data) {
        try {
          // Try read error text body for hints
          const text = (await (async () => {
            let buf = ''
            for await (const chunk of error.response.data) buf += chunk.toString()
            return buf
          })())
          console.error(chalk.yellow('  -> Initializr response body:'), text)
        } catch {}
      }
      throw new Error(`Failed to download from Spring Initializr. Status: ${error.response.status}`)
    }
    throw error
  }
}

module.exports = { generateJavaProject }
