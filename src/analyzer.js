const fs = require('fs-extra');
const { glob } = require('glob');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

/**
 * Convert segment -> ControllerName (Users -> Users, user-orders -> UserOrders)
 */
function toTitleCase(str) {
  if (!str) return 'Default';
  return String(str)
    .replace(/[-_]+(\w)/g, (_, c) => c.toUpperCase()) // kebab/snake to camel
    .replace(/^\w/, c => c.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, '');
}

function normalizeRouteForBackend(urlValue) {
  // Convert template placeholders {id} -> :id
  return urlValue.replace(/\{(\w+)\}/g, ':$1');
}

function inferTypeFromNode(node) {
  if (!node) return 'String';
  switch (node.type) {
    case 'StringLiteral': return 'String';
    case 'NumericLiteral': return 'Number';
    case 'BooleanLiteral': return 'Boolean';
    case 'NullLiteral': return 'String';
    default: return 'String';
  }
}

function extractObjectSchema(objExpr) {
  const schemaFields = {};
  if (!objExpr || objExpr.type !== 'ObjectExpression') return null;

  for (const prop of objExpr.properties) {
    if (prop.type !== 'ObjectProperty') continue;

    const key =
      prop.key.type === 'Identifier' ? prop.key.name :
      prop.key.type === 'StringLiteral' ? prop.key.value :
      null;

    if (!key) continue;

    schemaFields[key] = inferTypeFromNode(prop.value);
  }
  return schemaFields;
}

/**
 * Try to resolve Identifier -> its init value if it's const payload = {...}
 */
function resolveIdentifierToInit(path, identifierName) {
  try {
    const binding = path.scope.getBinding(identifierName);
    if (!binding) return null;
    const declPath = binding.path; // VariableDeclarator path usually
    if (!declPath || !declPath.node) return null;

    // VariableDeclarator: id = init
    if (declPath.node.type === 'VariableDeclarator') {
      return declPath.node.init || null;
    }
    return null;
  } catch {
    return null;
  }
}

function getUrlValue(urlNode) {
  if (!urlNode) return null;

  if (urlNode.type === 'StringLiteral') return urlNode.value;

  if (urlNode.type === 'TemplateLiteral') {
    // `/api/users/${id}` -> `/api/users/{id}`
    const quasis = urlNode.quasis || [];
    const exprs = urlNode.expressions || [];
    let out = '';
    for (let i = 0; i < quasis.length; i++) {
      out += quasis[i].value.raw;
      if (exprs[i]) {
        if (exprs[i].type === 'Identifier') out += `{${exprs[i].name}}`;
        else out += `{param}`;
      }
    }
    return out;
  }

  return null;
}

function deriveControllerNameFromUrl(urlValue) {
  // supports: /api/users, /api/v1/users, /api/admin/users
  const parts = urlValue.split('/').filter(Boolean); // ["api","v1","users"]
  const apiIndex = parts.indexOf('api');
  const seg = (apiIndex >= 0 && parts.length > apiIndex + 1)
    ? parts[apiIndex + 1]
    : parts[0];

  return toTitleCase(seg);
}

function deriveActionName(method, route) {
  // method + last segment heuristic
  const cleaned = route.replace(/^\/api\//, '/').replace(/[/:{}-]/g, ' ');
  const last = cleaned.trim().split(/\s+/).filter(Boolean).pop() || 'Action';
  return `${method.toLowerCase()}${toTitleCase(last)}`;
}

function extractPathParams(route) {
  const params = [];
  const re = /[:{]([a-zA-Z0-9_]+)[}]/g; // matches :id or {id}
  let m;
  while ((m = re.exec(route))) params.push(m[1]);
  return Array.from(new Set(params));
}

function extractQueryParamsFromUrl(urlValue) {
  // if url has ?a=b&c=d as string literal
  try {
    const qIndex = urlValue.indexOf('?');
    if (qIndex === -1) return [];
    const qs = urlValue.slice(qIndex + 1);
    return qs.split('&').map(p => p.split('=')[0]).filter(Boolean);
  } catch {
    return [];
  }
}

async function analyzeFrontend(srcPath) {
  if (!fs.existsSync(srcPath)) {
    throw new Error(`The source directory '${srcPath}' does not exist.`);
  }

  const files = await glob(`${srcPath}/**/*.{js,ts,jsx,tsx}`, { ignore: ['**/node_modules/**', '**/dist/**', '**/build/**'] });
  const endpoints = new Map();

  for (const file of files) {
    const code = await fs.readFile(file, 'utf-8');

    let ast;
    try {
      ast = parser.parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
    } catch {
      continue;
    }

    traverse(ast, {
      CallExpression(callPath) {
        const node = callPath.node;

        // --- Detect fetch(url, options) ---
        const isFetch = node.callee.type === 'Identifier' && node.callee.name === 'fetch';

        // --- Detect axios.<method>(url, data?, config?) ---
        const isAxiosMethod =
          node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'Identifier' &&
          node.callee.object.name === 'axios' &&
          node.callee.property.type === 'Identifier';

        if (!isFetch && !isAxiosMethod) return;

        let urlValue = null;
        let method = 'GET';
        let schemaFields = null;

        if (isFetch) {
          urlValue = getUrlValue(node.arguments[0]);
          const optionsNode = node.arguments[1];

          if (optionsNode && optionsNode.type === 'ObjectExpression') {
            const methodProp = optionsNode.properties.find(p => p.type === 'ObjectProperty' && p.key.type === 'Identifier' && p.key.name === 'method');
            if (methodProp && methodProp.value.type === 'StringLiteral') method = methodProp.value.value.toUpperCase();

            const bodyProp = optionsNode.properties.find(p => p.type === 'ObjectProperty' && p.key.type === 'Identifier' && p.key.name === 'body');

            if (bodyProp) {
              // body: JSON.stringify(objOrVar)
              const v = bodyProp.value;

              if (v.type === 'CallExpression' && v.callee.type === 'MemberExpression' &&
                v.callee.object.type === 'Identifier' && v.callee.object.name === 'JSON' &&
                v.callee.property.type === 'Identifier' && v.callee.property.name === 'stringify'
              ) {
                const arg0 = v.arguments[0];

                if (arg0?.type === 'ObjectExpression') {
                  schemaFields = extractObjectSchema(arg0);
                } else if (arg0?.type === 'Identifier') {
                  const init = resolveIdentifierToInit(callPath, arg0.name);
                  if (init?.type === 'ObjectExpression') schemaFields = extractObjectSchema(init);
                }
              }
            }
          }
        }

        if (isAxiosMethod) {
          method = node.callee.property.name.toUpperCase();
          urlValue = getUrlValue(node.arguments[0]);

          // axios.post(url, data)
          if (['POST', 'PUT', 'PATCH'].includes(method)) {
            const dataArg = node.arguments[1];
            if (dataArg?.type === 'ObjectExpression') {
              schemaFields = extractObjectSchema(dataArg);
            } else if (dataArg?.type === 'Identifier') {
              const init = resolveIdentifierToInit(callPath, dataArg.name);
              if (init?.type === 'ObjectExpression') schemaFields = extractObjectSchema(init);
            }
          }
        }

        if (!urlValue || !urlValue.startsWith('/api/')) return;

        const route = normalizeRouteForBackend(urlValue.split('?')[0]); // drop query string
        const controllerName = deriveControllerNameFromUrl(urlValue);
        const actionName = deriveActionName(method, route);

        const key = `${method}:${route}`;
        if (!endpoints.has(key)) {
          endpoints.set(key, {
            path: urlValue,
            route,              // normalized for backend: /api/users/:id
            method,
            controllerName,
            actionName,
            pathParams: extractPathParams(route),
            queryParams: extractQueryParamsFromUrl(urlValue),
            schemaFields,       // backward compat (your generators use this)
            requestBody: schemaFields ? { fields: schemaFields } : null,
            sourceFile: file
          });
        }
      },
    });
  }

  return Array.from(endpoints.values());
}

module.exports = { analyzeFrontend };