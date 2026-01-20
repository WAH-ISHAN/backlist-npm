const path = require('path');
const fg = require('fast-glob');
const { Project, SyntaxKind } = require('ts-morph');
const fs = require('fs-extra');

function normalizeMethod(name) {
  const m = String(name).toUpperCase();
  return ['GET','POST','PUT','PATCH','DELETE'].includes(m) ? m : null;
}

// Very first-pass extractor: axios.<method>('url') OR fetch('url', { method: 'POST' })
async function scanFrontend({ frontendSrcDir }) {
  const patterns = [
    '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'
  ];

  const files = await fg(patterns, {
    cwd: frontendSrcDir,
    absolute: true,
    ignore: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/build/**']
  });

  const project = new Project({
    tsConfigFilePath: fs.existsSync(path.join(frontendSrcDir, '../tsconfig.json'))
      ? path.join(frontendSrcDir, '../tsconfig.json')
      : undefined,
    skipAddingFilesFromTsConfig: true
  });

  files.forEach(f => project.addSourceFileAtPathIfExists(f));

  const endpoints = [];

  for (const sf of project.getSourceFiles()) {
    // axios.get('/x') | axios.post('/x')
    const callExprs = sf.getDescendantsOfKind(SyntaxKind.CallExpression);

    for (const call of callExprs) {
      const expr = call.getExpression();

      // axios.<method>(...)
      if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
        const pae = expr;
        const method = normalizeMethod(pae.getName());
        const target = pae.getExpression().getText(); // axios / api / client etc (basic)
        const args = call.getArguments();
        if (method && args.length >= 1 && args[0].getKind() === SyntaxKind.StringLiteral) {
          const url = args[0].getText().slice(1, -1);
          endpoints.push({
            source: sf.getFilePath(),
            kind: 'axios',
            client: target,
            method,
            url
          });
        }
      }

      // fetch('/x', { method: 'POST' })
      if (expr.getText() === 'fetch') {
        const args = call.getArguments();
        if (args.length >= 1 && args[0].getKind() === SyntaxKind.StringLiteral) {
          const url = args[0].getText().slice(1, -1);
          let method = 'GET';
          if (args[1] && args[1].getKind() === SyntaxKind.ObjectLiteralExpression) {
            const obj = args[1];
            const methodProp = obj.getProperty('method');
            if (methodProp && methodProp.getKind() === SyntaxKind.PropertyAssignment) {
              const init = methodProp.getInitializer();
              if (init && init.getKind() === SyntaxKind.StringLiteral) {
                method = init.getText().slice(1, -1).toUpperCase();
              }
            }
          }
          endpoints.push({
            source: sf.getFilePath(),
            kind: 'fetch',
            method,
            url
          });
        }
      }
    }
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    frontendSrcDir,
    endpoints
  };
}

async function writeContracts(outFile, contracts) {
  await fs.ensureDir(path.dirname(outFile));
  await fs.writeJson(outFile, contracts, { spaces: 2 });
}

module.exports = { scanFrontend, writeContracts };