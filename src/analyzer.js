const fs = require('fs-extra');
const { glob } = require('glob');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

/**
 * Converts a string to TitleCase, which is suitable for model and controller names.
 * e.g., 'user-orders' -> 'UserOrders'
 * @param {string} str The input string.
 * @returns {string} The TitleCased string.
 */
function toTitleCase(str) {
    if (!str) return 'Default';
    return str.replace(/-_(\w)/g, g => g[1].toUpperCase()) // handle snake_case and kebab-case
              .replace(/\w\S*/g, txt => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase())
              .replace(/[^a-zA-Z0-9]/g, '');
}

/**
 * Analyzes frontend source files to find API endpoints and their details.
 * @param {string} srcPath The path to the frontend source directory.
 * @returns {Promise<Array<object>>} A promise that resolves to an array of endpoint objects.
 */
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
          // We are only interested in 'fetch' calls
          if (path.node.callee.name !== 'fetch') return;

          const urlNode = path.node.arguments[0];
          
          let urlValue;
          if (urlNode.type === 'StringLiteral') {
            urlValue = urlNode.value;
          } else if (urlNode.type === 'TemplateLiteral' && urlNode.quasis.length > 0) {
            // Reconstruct path for dynamic URLs like `/api/users/${id}` -> `/api/users/{id}`
            urlValue = urlNode.quasis.map((q, i) => {
              return q.value.raw + (urlNode.expressions[i] ? `{${urlNode.expressions[i].name || 'id'}}` : '');
            }).join('');
          }

          // Only process API calls that start with '/api/'
          if (!urlValue || !urlValue.startsWith('/api/')) return;

          let method = 'GET';
          let schemaFields = null;

          const optionsNode = path.node.arguments[1];
          if (optionsNode?.type === 'ObjectExpression') {
            // Find the HTTP method
            const methodProp = optionsNode.properties.find(p => p.key.name === 'method');
            if (methodProp?.value.type === 'StringLiteral') {
              method = methodProp.value.value.toUpperCase();
            }

            // --- NEW LOGIC: Analyze the 'body' for POST/PUT requests ---
            if (method === 'POST' || method === 'PUT') {
              const bodyProp = optionsNode.properties.find(p => p.key.name === 'body');
              
              // Check if body is wrapped in JSON.stringify
              if (bodyProp?.value.callee?.name === 'JSON.stringify') {
                const dataObjectNode = bodyProp.value.arguments[0];

                // This is a simplified analysis assuming the object is defined inline.
                // A more robust solution would trace variables back to their definition.
                if (dataObjectNode.type === 'ObjectExpression') {
                  schemaFields = {};
                  dataObjectNode.properties.forEach(prop => {
                    const key = prop.key.name;
                    const valueNode = prop.value;
                    
                    // Infer Mongoose schema type based on the value's literal type
                    if (valueNode.type === 'StringLiteral') {
                      schemaFields[key] = 'String';
                    } else if (valueNode.type === 'NumericLiteral') {
                      schemaFields[key] = 'Number';
                    } else if (valueNode.type === 'BooleanLiteral') {
                      schemaFields[key] = 'Boolean';
                    } else {
                      // Default to String if the type is complex or a variable
                      schemaFields[key] = 'String'; 
                    }
                  });
                }
              }
            }
          }

          // Generate a clean controller name (e.g., /api/user-orders -> UserOrders)
          const controllerName = toTitleCase(urlValue.split('/')[2]);
          const key = `${method}:${urlValue}`;

          // Avoid adding duplicate endpoints
          if (!endpoints.has(key)) {
            endpoints.set(key, { 
              path: urlValue, 
              method, 
              controllerName, 
              schemaFields // This will be null for GET/DELETE, and an object for POST/PUT
            });
          }
        },
      });
    } catch (e) { 
      // Ignore files that babel can't parse (e.g., CSS-in-JS files)
    }
  }

  // Return all found endpoints as an array
  return Array.from(endpoints.values());
}

module.exports = { analyzeFrontend };