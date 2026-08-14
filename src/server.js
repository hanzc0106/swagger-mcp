import readline from 'node:readline'
import { resolveWorkspace } from './workspace.js'
import { initProject, readConfig, addService, updateService, removeService } from './config.js'
import { getCacheStatus, readCachedSpec, refreshAllServices, refreshService } from './cache.js'
import { enrichOperation, findOperation, generateExample, getSchema, searchOperations } from './openapi.js'

export const TOOL_DEFINITIONS = [
  workspaceTool('init_project', 'Create .swagger-mcp/config.json and cache directory in the requested workspace.', {
    type: 'object',
    properties: {}
  }),
  workspaceTool('list_services', 'List configured Swagger services and local cache state. This never fetches remote documents.', {
    type: 'object',
    properties: {}
  }),
  workspaceTool('add_service', 'Add a named Swagger/OpenAPI source. It does not fetch the document.', {
    type: 'object',
    properties: {
      service: { type: 'string', description: 'Stable service name, such as datapool.' },
      url: { type: 'string', description: 'Swagger/OpenAPI JSON URL or file URL.' },
      overwrite: { type: 'boolean', default: false }
    },
    required: ['service', 'url']
  }),
  workspaceTool('update_service', 'Update a service URL. It does not fetch the document.', {
    type: 'object',
    properties: {
      service: { type: 'string' },
      url: { type: 'string' }
    },
    required: ['service', 'url']
  }),
  workspaceTool('remove_service', 'Remove a service from config. Existing cached document is preserved.', {
    type: 'object',
    properties: { service: { type: 'string' } },
    required: ['service']
  }),
  workspaceTool('refresh_service', 'Explicitly fetch one remote Swagger/OpenAPI JSON document and overwrite only its local cache.', {
    type: 'object',
    properties: { service: { type: 'string' } },
    required: ['service']
  }),
  workspaceTool('refresh_all_services', 'Explicitly refresh every configured service. This is the only bulk network operation.', {
    type: 'object',
    properties: {}
  }),
  workspaceTool('search_operations', 'Search operations only in the local cached document. It never fetches remote Swagger.', {
    type: 'object',
    properties: {
      service: { type: 'string' },
      keyword: { type: 'string' },
      method: { type: 'string', description: 'HTTP method, for example GET.' },
      tag: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }
    },
    required: ['service']
  }),
  workspaceTool('get_operation', 'Read one cached operation by operationId, or by method and path.', {
    type: 'object',
    properties: {
      service: { type: 'string' },
      operationId: { type: 'string' },
      method: { type: 'string' },
      path: { type: 'string' }
    },
    required: ['service']
  }),
  workspaceTool('get_schema', 'Read and resolve one schema from a cached Swagger/OpenAPI document.', {
    type: 'object',
    properties: {
      service: { type: 'string' },
      name: { type: 'string' }
    },
    required: ['service', 'name']
  }),
  workspaceTool('generate_request_example', 'Generate curl, axios, or fetch code from one cached operation.', {
    type: 'object',
    properties: {
      service: { type: 'string' },
      operationId: { type: 'string' },
      method: { type: 'string' },
      path: { type: 'string' },
      format: { type: 'string', enum: ['curl', 'axios', 'fetch'], default: 'curl' },
      baseUrl: { type: 'string', description: 'Optional API base URL. Falls back to spec server URL.' }
    },
    required: ['service']
  })
]

export async function startServer() {
  const lineReader = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
  for await (const line of lineReader) {
    if (!line.trim()) continue
    let message
    try {
      message = JSON.parse(line)
    } catch {
      sendError(null, -32700, 'Parse error')
      continue
    }
    await handleMessage(message)
  }
}

async function handleMessage(message) {
  if (!message || message.jsonrpc !== '2.0') {
    if (message?.id !== undefined) sendError(message.id, -32600, 'Invalid Request')
    return
  }
  if (message.id === undefined) return
  try {
    const result = await dispatch(message.method, message.params || {})
    sendResult(message.id, result)
  } catch (error) {
    sendError(message.id, -32000, error?.message || String(error))
  }
}

async function dispatch(method, params) {
  if (method === 'initialize') {
    return {
      protocolVersion: params.protocolVersion || '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'swagger-mcp', version: '0.1.0' },
      instructions: 'Swagger documents are queried only from local cache. Use refresh_service explicitly to fetch remote documents.'
    }
  }
  if (method === 'ping') return {}
  if (method === 'tools/list') return { tools: TOOL_DEFINITIONS }
  if (method === 'tools/call') return callTool(params.name, params.arguments || {})
  throw new Error('Method not found: ' + method)
}

export async function callTool(name, args) {
  const workspace = resolveWorkspace(args.workspace)
  let result
  switch (name) {
    case 'init_project':
      result = await initProject(workspace)
      break
    case 'list_services':
      result = await getCacheStatus(workspace)
      break
    case 'add_service':
      result = await addService(workspace, args.service, args.url, { overwrite: args.overwrite })
      break
    case 'update_service':
      result = await updateService(workspace, args.service, { url: args.url })
      break
    case 'remove_service':
      result = await removeService(workspace, args.service)
      break
    case 'refresh_service':
      result = await refreshService(workspace, args.service)
      break
    case 'refresh_all_services':
      result = await refreshAllServices(workspace)
      break
    case 'search_operations': {
      const lookup = await withCachedSpec(workspace, args.service, (spec) => searchOperations(spec, args))
      const matches = lookup.value || []
      result = {
        service: args.service,
        matches,
        cache: lookup.cache,
        refreshHint: matches.length ? null : buildRefreshHint(workspace, args.service, lookup.cache, lookup.reason || 'No cached operation matched the query.')
      }
      break
    }
    case 'get_operation': {
      const lookup = await withCachedSpec(workspace, args.service, (spec) => enrichOperation(spec, findOperation(spec, args)))
      result = {
        service: args.service,
        operation: lookup.value,
        cache: lookup.cache,
        refreshHint: lookup.value ? null : buildRefreshHint(workspace, args.service, lookup.cache, lookup.reason)
      }
      break
    }
    case 'get_schema': {
      const lookup = await withCachedSpec(workspace, args.service, (spec) => getSchema(spec, args.name))
      result = {
        service: args.service,
        schema: lookup.value,
        cache: lookup.cache,
        refreshHint: lookup.value ? null : buildRefreshHint(workspace, args.service, lookup.cache, lookup.reason)
      }
      break
    }
    case 'generate_request_example': {
      const lookup = await withCachedSpec(workspace, args.service, (spec) => {
        const operation = findOperation(spec, args)
        return generateExample(spec, operation, args.format || 'curl', args.baseUrl)
      })
      result = lookup.value ? {
        service: args.service,
        format: args.format || 'curl',
        example: lookup.value,
        cache: lookup.cache,
        refreshHint: null
      } : {
        service: args.service,
        format: args.format || 'curl',
        example: null,
        cache: lookup.cache,
        refreshHint: buildRefreshHint(workspace, args.service, lookup.cache, lookup.reason)
      }
      break
    }
    default:
      throw new Error('Unknown tool: ' + name)
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
  }
}

function tool(name, description, inputSchema) {
  return { name, description, inputSchema }
}

function workspaceTool(name, description, inputSchema) {
  return tool(name, description, {
    type: 'object',
    properties: {
      workspace: {
        type: 'string',
        description: 'Absolute path to the business project that owns .swagger-mcp.'
      },
      ...inputSchema.properties
    },
    required: ['workspace', ...(inputSchema.required || [])]
  })
}

async function withCachedSpec(workspace, service, lookup) {
  const cache = await getSingleCacheStatus(workspace, service)
  if (!cache.hasCache) {
    return {
      value: null,
      cache,
      reason: 'No local Swagger cache exists for this service.'
    }
  }

  try {
    const spec = await readCachedSpec(workspace, service)
    return {
      value: await lookup(spec),
      cache,
      reason: null
    }
  } catch (error) {
    if (!isLookupFailure(error)) throw error
    return {
      value: null,
      cache,
      reason: error.message
    }
  }
}

async function getSingleCacheStatus(workspace, service) {
  const statuses = await getCacheStatus(workspace, service)
  return statuses[0]
}

function isLookupFailure(error) {
  return error instanceof SyntaxError ||
    /^(Operation not found|Schema not found|No cached swagger)/.test(error?.message || '')
}

function buildRefreshHint(workspace, service, cache, reason) {
  return {
    recommended: true,
    reason: reason || 'The requested definition was not found in the local cache.',
    tool: 'refresh_service',
    arguments: {
      workspace,
      service
    },
    cacheUpdatedAt: cache.updatedAt ?? null
  }
}

function sendResult(id, result) {
  write({ jsonrpc: '2.0', id, result })
}

function sendError(id, code, message) {
  write({ jsonrpc: '2.0', id, error: { code, message } })
}

function write(value) {
  process.stdout.write(JSON.stringify(value) + '\n')
}
