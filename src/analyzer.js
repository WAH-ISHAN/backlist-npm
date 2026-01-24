/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs-extra')
const path = require('path')
const { glob } = require('glob')

const parser = require('@babel/parser')
const traverse = require('@babel/traverse').default

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete'])

// -------------------------
// Utils
// -------------------------
function normalizeSlashes (p) {
  return String(p || '').replace(/\\/g, '/')
}

function toTitleCase (str) {
  if (!str) return 'Default'
  return String(str)
    .replace(/[-_]+(\w)/g, (_, c) => c.toUpperCase())
    .replace(/^\w/, (c) => c.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, '')
}

// Convert `/api/users/{id}` -> `/api/users/:id`
function normalizeRouteForBackend (urlValue) {
  return String(urlValue || '').replace(/\{(\w+)\}/g, ':$1')
}

function extractApiPath (urlValue) {
  // supports:
  // - /api/...
  // - http://localhost:5000/api/...
  if (!urlValue) return null
  const idx = urlValue.indexOf('/api/')
  if (idx === -1) return null
  return urlValue.slice(idx) // => /api/...
}

function extractPathParams (route) {
  const params = []
  const re = /[:{]([a-zA-Z0-9_]+)[}]/g
  let m
  while ((m = re.exec(route))) params.push(m[1])
  return Array.from(new Set(params))
}

function extractQueryParamsFromUrl (urlValue) {
  try {
    const qIndex = urlValue.indexOf('?')
    if (qIndex === -1) return []
    const qs = urlValue.slice(qIndex + 1)
    return qs
      .split('&')
      .map((p) => p.split('=')[0])
      .filter(Boolean)
  } catch {
    return []
  }
}

function deriveControllerNameFromUrl (urlValue) {
  const apiPath = extractApiPath(urlValue) || urlValue
  const parts = String(apiPath).split('/').filter(Boolean) // ["api","v1","products"]
  const apiIndex = parts.indexOf('api')

  let seg = null
  if (apiIndex >= 0) {
    seg = parts[apiIndex + 1] || null

    // skip version segment (v1, v2, v10...)
    if (seg && /^v\d+$/i.test(seg)) {
      seg = parts[apiIndex + 2] || seg
    }
  } else {
    seg = parts[0] || null
  }

  return toTitleCase(seg)
}

function deriveActionName (method, route) {
  const cleaned = String(route).replace(/^\/api\//, '/').replace(/[/:{}-]/g, ' ')
  const last = cleaned.trim().split(/\s+/).filter(Boolean).pop() || 'Action'
  return `${String(method).toLowerCase()}${toTitleCase(last)}`
}

// -------------------------
// URL extraction
// -------------------------
function getUrlValue (urlNode) {
  if (!urlNode) return null

  if (urlNode.type === 'StringLiteral') return urlNode.value

  if (urlNode.type === 'TemplateLiteral') {
    // `/api/users/${id}` -> `/api/users/{id}` or `{param1}`
    const quasis = urlNode.quasis || []
    const exprs = urlNode.expressions || []
    let out = ''
    for (let i = 0; i < quasis.length; i++) {
      out += quasis[i].value.raw
      if (exprs[i]) {
        if (exprs[i].type === 'Identifier') out += `{${exprs[i].name}}`
        else out += `{param${i + 1}}`
      }
    }
    return out
  }

  return null
}

// -------------------------
// axios-like detection
// -------------------------
function detectAxiosLikeMethod (node) {
  // axios.get(...) / api.get(...) / httpClient.post(...) etc
  if (!node.callee || node.callee.type !== 'MemberExpression') return null

  const prop = node.callee.property
  if (!prop || prop.type !== 'Identifier') return null

  const name = prop.name.toLowerCase()
  if (!HTTP_METHODS.has(name)) return null

  return name.toUpperCase()
}

// -------------------------
// Request body schema (simple + identifier tracing)
// -------------------------
function inferTypeFromNode (node) {
  if (!node) return 'String'
  switch (node.type) {
    case 'StringLiteral':
      return 'String'
    case 'NumericLiteral':
      return 'Number'
    case 'BooleanLiteral':
      return 'Boolean'
    case 'NullLiteral':
      return 'String'
    default:
      return 'String'
  }
}

function extractObjectSchema (objExpr) {
  const schemaFields = {}
  if (!objExpr || objExpr.type !== 'ObjectExpression') return null

  for (const prop of objExpr.properties) {
    if (prop.type !== 'ObjectProperty') continue

    const key =
      prop.key.type === 'Identifier'
        ? prop.key.name
        : prop.key.type === 'StringLiteral'
          ? prop.key.value
          : null

    if (!key) continue
    schemaFields[key] = inferTypeFromNode(prop.value)
  }
  return schemaFields
}

function resolveIdentifierToInit (callPath, identifierName) {
  try {
    const binding = callPath.scope.getBinding(identifierName)
    if (!binding) return null
    const declPath = binding.path
    if (!declPath || !declPath.node) return null

    if (declPath.node.type === 'VariableDeclarator') return declPath.node.init || null
    return null
  } catch {
    return null
  }
}

function isJSONStringifyCall (node) {
  // JSON.stringify(x)
  return (
    node &&
    node.type === 'CallExpression' &&
    node.callee &&
    node.callee.type === 'MemberExpression' &&
    node.callee.object &&
    node.callee.object.type === 'Identifier' &&
    node.callee.object.name === 'JSON' &&
    node.callee.property &&
    node.callee.property.type === 'Identifier' &&
    node.callee.property.name === 'stringify'
  )
}

// -------------------------
// DB insights: guess db + infer models + seeds
// -------------------------
function guessDbTypeFromRepo (rootDir) {
  // Best-effort; if it's only frontend repo, usually null.
  try {
    const pkgPath = path.join(rootDir, 'package.json')
    if (!fs.existsSync(pkgPath)) return null

    const pkg = fs.readJsonSync(pkgPath)
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }

    if (deps.mongoose || deps.mongodb) return 'mongodb-mongoose'
    if (deps.prisma || deps['@prisma/client']) return 'sql-prisma'
    if (deps.sequelize) return 'sql-sequelize'
    if (deps.typeorm) return 'sql-typeorm'

    return null
  } catch {
    return null
  }
}

function inferModelsFromEndpoints (endpoints) {
  const models = new Map()

  for (const ep of endpoints) {
    const modelName = ep.controllerName || 'Default'

    if (!models.has(modelName)) {
      models.set(modelName, {
        name: modelName,
        fields: {}, // merged fields from bodies
        sources: new Set(),
        endpoints: []
      })
    }

    const m = models.get(modelName)
    m.endpoints.push({ method: ep.method, route: ep.route })
    if (ep.sourceFile) m.sources.add(ep.sourceFile)

    const fields = ep.schemaFields || (ep.requestBody && ep.requestBody.fields) || null
    if (fields) {
      for (const [k, t] of Object.entries(fields)) {
        if (!m.fields[k]) m.fields[k] = t || 'String'
      }
    }
  }

  return Array.from(models.values()).map((m) => ({
    name: m.name,
    fields: m.fields,
    sources: Array.from(m.sources),
    endpoints: m.endpoints
  }))
}

function seedValueForType (t) {
  if (t === 'Number') return 1
  if (t === 'Boolean') return true
  return 'test' // String default
}

function generateSeedsFromModels (models, perModel = 3) {
  return models.map((m) => {
    const rows = []
    for (let i = 0; i < perModel; i++) {
      const obj = {}
      for (const [k, t] of Object.entries(m.fields || {})) {
        obj[k] = seedValueForType(t)
      }
      rows.push(obj)
    }
    return { model: m.name, rows }
  })
}

// -------------------------
// MAIN frontend analyzer
// -------------------------
async function analyzeFrontend (srcPath) {
  if (!srcPath) throw new Error('analyzeFrontend: srcPath is required')
  if (!fs.existsSync(srcPath)) {
    throw new Error(`The source directory '${srcPath}' does not exist.`)
  }

  const files = await glob(`${normalizeSlashes(srcPath)}/**/*.{js,ts,jsx,tsx}`, {
    ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.next/**', '**/coverage/**']
  })

  const endpoints = new Map()

  for (const file of files) {
    let code
    try {
      code = await fs.readFile(file, 'utf-8')
    } catch {
      continue
    }

    let ast
    try {
      ast = parser.parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] })
    } catch {
      continue
    }

    traverse(ast, {
      CallExpression (callPath) {
        const node = callPath.node

        const isFetch = node.callee.type === 'Identifier' && node.callee.name === 'fetch'
        const axiosMethod = detectAxiosLikeMethod(node)

        if (!isFetch && !axiosMethod) return

        let urlValue = null
        let method = 'GET'
        let schemaFields = null

        // ---- fetch(url, options) ----
        if (isFetch) {
          urlValue = getUrlValue(node.arguments[0])
          const optionsNode = node.arguments[1]

          if (optionsNode && optionsNode.type === 'ObjectExpression') {
            const methodProp = optionsNode.properties.find(
              (p) =>
                p.type === 'ObjectProperty' &&
                p.key.type === 'Identifier' &&
                p.key.name === 'method'
            )
            if (methodProp && methodProp.value.type === 'StringLiteral') {
              method = methodProp.value.value.toUpperCase()
            }

            if (['POST', 'PUT', 'PATCH'].includes(method)) {
              const bodyProp = optionsNode.properties.find(
                (p) =>
                  p.type === 'ObjectProperty' &&
                  p.key.type === 'Identifier' &&
                  p.key.name === 'body'
              )

              if (bodyProp) {
                const v = bodyProp.value

                if (isJSONStringifyCall(v)) {
                  const arg0 = v.arguments[0]

                  if (arg0?.type === 'ObjectExpression') {
                    schemaFields = extractObjectSchema(arg0)
                  } else if (arg0?.type === 'Identifier') {
                    const init = resolveIdentifierToInit(callPath, arg0.name)
                    if (init?.type === 'ObjectExpression') schemaFields = extractObjectSchema(init)
                  }
                }
              }
            }
          }
        }

        // ---- axios-like client ----
        if (axiosMethod) {
          method = axiosMethod
          urlValue = getUrlValue(node.arguments[0])

          if (['POST', 'PUT', 'PATCH'].includes(method)) {
            const dataArg = node.arguments[1]
            if (dataArg?.type === 'ObjectExpression') {
              schemaFields = extractObjectSchema(dataArg)
            } else if (dataArg?.type === 'Identifier') {
              const init = resolveIdentifierToInit(callPath, dataArg.name)
              if (init?.type === 'ObjectExpression') schemaFields = extractObjectSchema(init)
            }
          }
        }

        // accept only URLs that contain /api/ anywhere
        const apiPath = extractApiPath(urlValue)
        if (!apiPath) return

        const route = normalizeRouteForBackend(apiPath.split('?')[0])
        const controllerName = deriveControllerNameFromUrl(apiPath)
        const actionName = deriveActionName(method, route)

        const key = `${method}:${route}`
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
            sourceFile: normalizeSlashes(file)
          })
        }
      }
    })
  }

  return Array.from(endpoints.values())
}

// -------------------------
// Optional: full project analyze (endpoints + db insights)
// -------------------------
async function analyze (projectRoot = process.cwd()) {
  const rootDir = path.resolve(projectRoot)

  const frontendSrc = ['src', 'app', 'pages']
    .map((d) => path.join(rootDir, d))
    .find((d) => fs.existsSync(d))

  const endpoints = frontendSrc ? await analyzeFrontend(frontendSrc) : []

  const models = inferModelsFromEndpoints(endpoints)
  const seeds = generateSeedsFromModels(models, 3)
  const guessedDb = guessDbTypeFromRepo(rootDir)

  return {
    rootDir: normalizeSlashes(rootDir),
    endpoints,
    dbInsights: {
      guessedDb, // null | mongodb-mongoose | sql-prisma | ...
      models, // inferred entities + fields
      seeds // dummy seed rows
    }
  }
}

module.exports = { analyzeFrontend, analyze }
