const fs = require('fs-extra');
const { glob } = require('glob');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

function toTitleCase(str) {
    if (!str) return 'Default';
    return str.replace(/\w\S*/g, txt => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase())
              .replace(/[^a-zA-Z0-9]/g, '');
}

async function analyzeFrontend(srcPath) {
  if (!fs.existsSync(srcPath)) {
    throw new Error(`The source directory '${srcPath}' does not exist.`);
  }

  const files = await glob(`${srcPath}/**/*.{js,ts,jsx,tsx}`, { ignore: 'node_modules/**' });
  const endpoints = new Map();

  for (const file of files) {
    const code = await fs.readFile(file, 'utf-8');
    try {
      const ast = parser.parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
      traverse(ast, {
        CallExpression(path) {
          if (path.node.callee.name !== 'fetch') return;
          const urlNode = path.node.arguments[0];
          
          let urlValue;
          if (urlNode.type === 'StringLiteral') {
            urlValue = urlNode.value;
          } else if (urlNode.type === 'TemplateLiteral' && urlNode.quasis.length > 0) {
            urlValue = urlNode.quasis.map(q => q.value.raw).join('{id}');
          }
          
          if (!urlValue || !urlValue.startsWith('/api/')) return;
          
          let method = 'GET';

          const optionsNode = path.node.arguments[1];
          if (optionsNode && optionsNode.type === 'ObjectExpression') {
            const methodProp = optionsNode.properties.find(p => p.key.name === 'method');
            if (methodProp && methodProp.value.type === 'StringLiteral') {
              method = methodProp.value.value.toUpperCase();
            }
          }

          const controllerName = toTitleCase(urlValue.split('/')[2]);
          const key = `${method}:${urlValue}`;
          if (!endpoints.has(key)) {
            endpoints.set(key, { path: urlValue, method, controllerName });
          }
        },
      });
    } catch (e) { /* Ignore parsing errors */ }
  }
  return Array.from(endpoints.values());
}

module.exports = { analyzeFrontend };