import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getStatePaths } from './workspace.js'
import { readConfig, getService, updateService, validateServiceName } from './config.js'
import { countOperations, getSpecInfo, validateSpec } from './openapi.js'

export function getCacheFile(workspace, service) {
  validateServiceName(service)
  return path.join(getStatePaths(workspace).cacheDir, service + '.openapi.json')
}

export async function readCachedSpec(workspace, service) {
  const filePath = getCacheFile(workspace, service)
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error('No cached swagger for service "' + service + '". Run refresh_service first.')
    }
    throw error
  }
}

export async function getCacheStatus(workspace, service) {
  const config = await readConfig(workspace)
  const services = service ? { [service]: getService(config, service) } : config.services
  const result = []
  for (const [name, item] of Object.entries(services)) {
    const filePath = getCacheFile(workspace, name)
    const stat = await statOrNull(filePath)
    let specInfo = null
    if (stat) {
      try {
        const spec = JSON.parse(await fs.readFile(filePath, 'utf8'))
        specInfo = { ...getSpecInfo(spec), operationCount: countOperations(spec) }
      } catch (error) {
        specInfo = { error: error.message }
      }
    }
    result.push({
      service: name,
      url: item.url,
      updatedAt: item.updatedAt ?? null,
      hasCache: Boolean(stat),
      cacheFile: filePath,
      cacheSize: stat?.size ?? 0,
      ...specInfo
    })
  }
  return result
}

export async function refreshService(workspace, service) {
  const config = await readConfig(workspace)
  const item = getService(config, service)
  const spec = await loadSpecFromUrl(item.url)
  validateSpec(spec)
  const cacheFile = getCacheFile(workspace, service)
  await fs.mkdir(path.dirname(cacheFile), { recursive: true })
  const payload = JSON.stringify(spec, null, 2) + '\n'
  await fs.writeFile(cacheFile, payload, 'utf8')
  const updatedAt = new Date().toISOString()
  await updateService(workspace, service, { updatedAt })
  return {
    service,
    url: item.url,
    updatedAt,
    cacheFile,
    hash: 'sha256:' + crypto.createHash('sha256').update(payload).digest('hex'),
    ...getSpecInfo(spec),
    operationCount: countOperations(spec)
  }
}

export async function refreshAllServices(workspace) {
  const config = await readConfig(workspace)
  const output = []
  for (const service of Object.keys(config.services)) {
    try {
      output.push(await refreshService(workspace, service))
    } catch (error) {
      output.push({ service, error: error.message })
    }
  }
  return output
}

async function loadSpecFromUrl(url) {
  const parsed = new URL(url)
  if (parsed.protocol === 'file:') return JSON.parse(await fs.readFile(parsed, 'utf8'))
  const response = await fetch(url, { headers: { accept: 'application/json,*/*' } })
  if (!response.ok) throw new Error('Failed to fetch swagger: HTTP ' + response.status + ' ' + response.statusText)
  return response.json()
}

async function statOrNull(filePath) {
  try {
    return await fs.stat(filePath)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}
