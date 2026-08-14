import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { addService, initProject, readConfig } from '../src/config.js'
import { getCacheStatus, readCachedSpec, refreshService } from '../src/cache.js'
import { findOperation, generateExample, getSchema, searchOperations } from '../src/openapi.js'

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'swagger-mcp-test-'))
const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'sample.openapi.json')

try {
  await initProject(workspace)
  await addService(workspace, 'datapool', pathToFileURL(fixture).href)
  const refreshed = await refreshService(workspace, 'datapool')
  assert.equal(refreshed.operationCount, 2)

  const config = await readConfig(workspace)
  assert.ok(config.services.datapool.updatedAt)

  const status = await getCacheStatus(workspace, 'datapool')
  assert.equal(status[0].hasCache, true)
  assert.equal(status[0].operationCount, 2)

  const spec = await readCachedSpec(workspace, 'datapool')
  const operations = searchOperations(spec, { keyword: 'well' })
  assert.equal(operations.length, 2)

  const operation = findOperation(spec, { operationId: 'updateWell' })
  assert.equal(operation.method, 'POST')
  assert.equal(getSchema(spec, 'Well').properties.name.type, 'string')

  const example = generateExample(spec, operation, 'curl')
  assert.match(example, /POST/)
  assert.match(example, /Well A/)
  console.log('All tests passed.')
} finally {
  await fs.rm(workspace, { recursive: true, force: true })
}
