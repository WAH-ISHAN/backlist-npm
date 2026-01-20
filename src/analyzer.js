const fs = require('fs-extra');
const { glob } = require('glob');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

function toTitleCase(str) {
  if (!str) return 'Default';
  return String(str)
    .replace(/[-_]+(\w)/g, (_, c) => c.toUpperCase())
    .replace(/^\w/, c => c.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, '');
}

function normalizeRouteForBackend(urlValue) {
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

function resolveIdentifierToInit(path, identifierName) {
  try {
    const binding = path.scope.getBinding(identifierName);
    if (!binding) return null;
    const declPath = binding.path;
    if (!declPath || !declPath.node) return null;

    if (declPath.node.type === 'VariableDeclarator') return declPath.node.init || null;
    return null;
  } catch {
    return null;
  }
}

function getUrlValue(urlNode) {
  if (!urlNode) return null;

  if (urlNode.type === 'StringLiteral') return urlNode.value;

  if (urlNode.type === 'TemplateLiteral') {
    // `/api/users/${id}` -> `/api/users/{id}` or `{param1}`
    const quasis = urlNode.quasis || [];
    const exprs = urlNode.expressions || [];
    let out = '';
    for (let i = 0; i < quasis.length; i++) {
      out += quasis[i].value.raw;
      if (exprs[i]) {
        if (exprs[i].type === 'Identifier') out += `{${exprs[i].name}}`;
        else out += `{param${i + 1}}`;
      }
    }
    return out;
  }

  return null;
}

function extractApiPath(urlValue) {
  // supports:
  // - /api/...
  // - http://localhost:5000/api/...
  if (!urlValue) return null;
  const idx = urlValue.indexOf('/api/');
  if (idx === -1) return null;
  return urlValue.slice(idx); // => /api/...
}

function deriveControllerNameFromUrl(urlValue) {
  const apiPath = extractApiPath(urlValue) || urlValue;
  const parts = String(apiPath).split('/').filter(Boolean); // ["api","v1","products"]
  const apiIndex = parts.indexOf('api');

  let seg = null;

  if (apiIndex >= 0) {
    seg = parts[apiIndex + 1] || null;

    // skip version segment (v1, v2, v10...)
    if (seg && /^v\d+$/i.test(seg)) {
      seg = parts[apiIndex + 2] || seg;
    }
  } else {
    seg = parts[0] || null;
  }

  return toTitleCase(seg);
}

function deriveActionName(method, route) {
  const cleaned = String(route).replace(/^\/api\//, '/').replace(/[/:{}-]/g, ' ');
  const last = cleaned.trim().split(/\s+/).filter(Boolean).pop() || 'Action';
  return `${String(method).toLowerCase()}${toTitleCase(last)}`;
}

function extractPathParams(route) {
  const params = [];
  const re = /[:{]([a-zA-Z0-9_]+)[}]/g;
  let m;
  while ((m = re.exec(route))) params.push(m[1]);
  return Array.from(new Set(params));
}

function extractQueryParamsFromUrl(urlValue) {
  try {
    const qIndex = urlValue.indexOf('?');
    if (qIndex === -1) return [];
    const qs = urlValue.slice(qIndex + 1);
    return qs.split('&').map(p => p.split('=')[0]).filter(Boolean);
  } catch {
    return [];
  }
}

function detectAxiosLikeMethod(node) {
  // axios.get(...) / api.get(...) / httpClient.post(...) etc
  if (!node.callee || node.callee.type !== 'MemberExpression') return null;

  const prop = node.callee.property;
  if (!prop || prop.type !== 'Identifier') return null;

  const name = prop.name.toLowerCase();
  if (!HTTP_METHODS.has(name)) return null;

  return name.toUpperCase();
}

async function analyzeFrontend(srcPath) {
  if (!fs.existsSync(srcPath)) {
    throw new Error(`The source directory '${srcPath}' does not exist.`);
  }

  const files = await glob(`${srcPath}/**/*.{js,ts,jsx,tsx}`, {
    ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.next/**']
  });

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

        const isFetch = node.callee.type === 'Identifier' && node.callee.name === 'fetch';
        const axiosMethod = detectAxiosLikeMethod(node);

        if (!isFetch && !axiosMethod) return;

        let urlValue = null;
        let method = 'GET';
        let schemaFields = null;

        // ---- fetch() ----
        if (isFetch) {
          urlValue = getUrlValue(node.arguments[0]);
          const optionsNode = node.arguments[1];

          if (optionsNode && optionsNode.type === 'ObjectExpression') {
            const methodProp = optionsNode.properties.find(
              p => p.type === 'ObjectProperty' && p.key.type === 'Identifier' && p.key.name === 'method'
            );
            if (methodProp && methodProp.value.type === 'StringLiteral') {
              method = methodProp.value.value.toUpperCase();
            }

            // body schema for POST/PUT/PATCH
            if (['POST', 'PUT', 'PATCH'].includes(method)) {
              const bodyProp = optionsNode.properties.find(
                p => p.type === 'ObjectProperty' && p.key.type === 'Identifier' && p.key.name === 'body'
              );

              if (bodyProp) {
                const v = bodyProp.value;

                if (
                  v.type === 'CallExpression' &&
                  v.callee.type === 'MemberExpression' &&
                  v.callee.object.type === 'Identifier' &&
                  v.callee.object.name === 'JSON' &&
                  v.callee.property.type === 'Identifier' &&
                  v.callee.property.name === 'stringify'
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
        }

        // ---- axios-like client ----
        if (axiosMethod) {
          method = axiosMethod;
          urlValue = getUrlValue(node.arguments[0]);

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

        // accept only URLs that contain /api/
        const apiPath = extractApiPath(urlValue);
        if (!apiPath) return;

        const route = normalizeRouteForBackend(apiPath.split('?')[0]);
        const controllerName = deriveControllerNameFromUrl(apiPath);
        const actionName = deriveActionName(method, route);

        const key = `${method}:${route}`;
        if (!endpoints.has(key)) {
          endpoints.set(key, {
            path: apiPath,
            route,
            method,
            controllerName,
            actionName,
            pathParams: extractPathParams(route),
            queryParams: extractQueryParamsFromUrl(apiPath),
            schemaFields,
            requestBody: schemaFields ? { fields: schemaFields } : null,
            sourceFile: file
          });
        }
      }
    });
  }

  return Array.from(endpoints.values());
}

module.exports = { analyzeFrontend };