import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { addService, initProject, readConfig } from '../src/config.js'
import { getCacheStatus, readCachedSpec, refreshService } from '../src/cache.js'
import { findOperation, generateExample, getSchema, searchOperations } from '../src/openapi.js'
import { resolveWorkspace } from '../src/workspace.js'
import { callTool, TOOL_DEFINITIONS } from '../src/server.js'

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'swagger-mcp-test-'))
const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'sample.openapi.json')

try {
  assert.throws(() => resolveWorkspace('relative-project'), /absolute path/)
  assert.ok(TOOL_DEFINITIONS.every((tool) => tool.inputSchema.required.includes('workspace')))
  await initProject(workspace)
  await addService(workspace, 'service1', pathToFileURL(fixture).href)
  const refreshed = await refreshService(workspace, 'service1')
  assert.equal(refreshed.operationCount, 2)

  const config = await readConfig(workspace)
  assert.ok(config.services.service1.updatedAt)

  const status = await getCacheStatus(workspace, 'service1')
  assert.equal(status[0].hasCache, true)
  assert.equal(status[0].operationCount, 2)

  const spec = await readCachedSpec(workspace, 'service1')
  const operations = searchOperations(spec, { keyword: 'resource' })
  assert.equal(operations.length, 2)

  const operation = findOperation(spec, { operationId: 'updateResource' })
  assert.equal(operation.method, 'POST')
  assert.equal(getSchema(spec, 'Resource').properties.name.type, 'string')

  const example = generateExample(spec, operation, 'curl')
  assert.match(example, /POST/)
  assert.match(example, /Resource A/)

  const missingLookups = [
    ['search_operations', { keyword: 'missing' }],
    ['get_operation', { operationId: 'missingOperation' }],
    ['get_schema', { name: 'MissingSchema' }],
    ['generate_request_example', { operationId: 'missingOperation' }]
  ]
  for (const [tool, argumentsValue] of missingLookups) {
    const response = await callTool(tool, { workspace, service: 'service1', ...argumentsValue })
    const result = JSON.parse(response.content[0].text)
    assert.equal(result.refreshHint.recommended, true)
    assert.equal(result.refreshHint.tool, 'refresh_service')
    assert.equal(result.refreshHint.arguments.workspace, workspace)
    assert.equal(result.refreshHint.arguments.service, 'service1')
  }
  console.log('All tests passed.')
} finally {
  await fs.rm(workspace, { recursive: true, force: true })
}
