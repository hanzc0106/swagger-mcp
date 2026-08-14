const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'])

export function validateSpec(spec) {
  if (!spec || typeof spec !== 'object') throw new Error('Swagger document must be an object')
  if (!spec.openapi && !spec.swagger) throw new Error('Expected OpenAPI or Swagger document')
  if (!spec.paths || typeof spec.paths !== 'object') throw new Error('Swagger document has no paths')
}

export function getSpecInfo(spec) {
  return {
    title: spec.info?.title ?? null,
    version: spec.info?.version ?? null,
    openapi: spec.openapi ?? spec.swagger ?? null
  }
}

export function countOperations(spec) {
  return listOperations(spec).length
}

export function listOperations(spec) {
  validateSpec(spec)
  const operations = []
  for (const [operationPath, pathItem] of Object.entries(spec.paths || {})) {
    if (!pathItem || typeof pathItem !== 'object') continue
    const sharedParameters = Array.isArray(pathItem.parameters) ? pathItem.parameters : []
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method) || !operation || typeof operation !== 'object') continue
      operations.push({
        method: method.toUpperCase(),
        path: operationPath,
        operationId: operation.operationId ?? null,
        tags: operation.tags ?? [],
        summary: operation.summary ?? '',
        description: operation.description ?? '',
        parameters: sharedParameters.concat(operation.parameters || []),
        requestBody: operation.requestBody ?? null,
        responses: operation.responses ?? {},
        security: operation.security ?? spec.security ?? null
      })
    }
  }
  return operations
}

export function searchOperations(spec, filters = {}) {
  const keyword = String(filters.keyword || '').toLowerCase()
  const method = filters.method ? String(filters.method).toUpperCase() : null
  const tag = filters.tag ? String(filters.tag).toLowerCase() : null
  const limit = Number(filters.limit || 20)
  return listOperations(spec)
    .filter((operation) => {
      if (method && operation.method !== method) return false
      if (tag && !operation.tags.some((item) => String(item).toLowerCase() === tag)) return false
      if (!keyword) return true
      const haystack = [
        operation.method,
        operation.path,
        operation.operationId,
        operation.summary,
        operation.description,
        ...(operation.tags || [])
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(keyword)
    })
    .slice(0, limit)
    .map(summarizeOperation)
}

export function findOperation(spec, query) {
  const operations = listOperations(spec)
  if (query.operationId) {
    const found = operations.find((item) => item.operationId === query.operationId)
    if (found) return found
  }
  if (query.path && query.method) {
    const method = String(query.method).toUpperCase()
    const found = operations.find((item) => item.path === query.path && item.method === method)
    if (found) return found
  }
  throw new Error('Operation not found. Provide operationId or method + path.')
}

export function enrichOperation(spec, operation) {
  return {
    ...operation,
    parameters: deref(operation.parameters, spec),
    requestBody: deref(operation.requestBody, spec),
    responses: deref(operation.responses, spec),
    security: deref(operation.security, spec)
  }
}

export function getSchema(spec, name) {
  const schema = spec.components?.schemas?.[name] || spec.definitions?.[name]
  if (!schema) throw new Error('Schema not found: ' + name)
  return deref(schema, spec)
}

export function generateExample(spec, operation, format = 'curl', baseUrl) {
  const resolved = enrichOperation(spec, operation)
  const serverUrl = baseUrl || spec.servers?.[0]?.url || '<baseUrl>'
  const url = serverUrl.replace(/\/$/, '') + buildPathWithQuery(resolved)
  const body = getRequestBodyExample(resolved.requestBody, spec)
  if (format === 'axios') return axiosExample(resolved, url, body)
  if (format === 'fetch') return fetchExample(resolved, url, body)
  return curlExample(resolved, url, body)
}

export function deref(value, spec, seen = new Set(), depth = 0) {
  if (value == null || typeof value !== 'object') return value
  if (depth > 12) return value
  if (Array.isArray(value)) return value.map((item) => deref(item, spec, seen, depth + 1))
  if (value.$ref) {
    if (seen.has(value.$ref)) return { $ref: value.$ref, circular: true }
    const nextSeen = new Set(seen)
    nextSeen.add(value.$ref)
    return deref(resolveRef(spec, value.$ref), spec, nextSeen, depth + 1)
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deref(item, spec, seen, depth + 1)]))
}

export function schemaExample(schema, spec, depth = 0) {
  const item = deref(schema, spec)
  if (!item || typeof item !== 'object' || depth > 8) return null
  if (item.example !== undefined) return item.example
  if (item.default !== undefined) return item.default
  if (Array.isArray(item.enum) && item.enum.length) return item.enum[0]
  if (item.type === 'array') return [schemaExample(item.items, spec, depth + 1)]
  if (item.type === 'object' || item.properties) {
    const output = {}
    for (const [key, property] of Object.entries(item.properties || {})) {
      output[key] = schemaExample(property, spec, depth + 1)
    }
    return output
  }
  if (item.type === 'integer' || item.type === 'number') return 0
  if (item.type === 'boolean') return true
  return 'string'
}

function summarizeOperation(operation) {
  return {
    method: operation.method,
    path: operation.path,
    operationId: operation.operationId,
    tags: operation.tags,
    summary: operation.summary
  }
}

function resolveRef(spec, ref) {
  if (!ref.startsWith('#/')) throw new Error('Only local refs are supported: ' + ref)
  return ref
    .slice(2)
    .split('/')
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce((current, part) => {
      if (current == null || !(part in current)) throw new Error('Broken ref: ' + ref)
      return current[part]
    }, spec)
}

function buildPathWithQuery(operation) {
  let output = operation.path
  const query = []
  for (const parameter of operation.parameters || []) {
    if (parameter.in === 'path') output = output.replace('{' + parameter.name + '}', '<' + parameter.name + '>')
    if (parameter.in === 'query') query.push(encodeURIComponent(parameter.name) + '=<'+ parameter.name + '>')
  }
  return query.length ? output + '?' + query.join('&') : output
}

function getRequestBodyExample(requestBody, spec) {
  const content = requestBody?.content
  if (!content) return null
  const mediaType = content['application/json'] ? 'application/json' : Object.keys(content)[0]
  const schema = content[mediaType]?.schema
  return schema ? schemaExample(schema, spec) : null
}

function curlExample(operation, url, body) {
  const lines = ['curl -X ' + operation.method + " '" + url + "'"]
  if (body != null) {
    lines.push("  -H 'Content-Type: application/json'")
    lines.push("  -d '" + JSON.stringify(body) + "'")
  }
  return lines.join(' \\\n')
}

function axiosExample(operation, url, body) {
  const method = operation.method.toLowerCase()
  const dataLine = body == null ? '' : ',\n  data: ' + JSON.stringify(body, null, 2).replace(/\n/g, '\n  ')
  return "await axios({\n  method: '" + method + "',\n  url: '" + url + "'" + dataLine + '\n})'
}

function fetchExample(operation, url, body) {
  const options = { method: operation.method }
  if (body != null) {
    options.headers = { 'Content-Type': 'application/json' }
    options.body = JSON.stringify(body)
  }
  return "await fetch('" + url + "', " + JSON.stringify(options, null, 2) + ')'
}
