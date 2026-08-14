import fs from 'node:fs/promises'
import path from 'node:path'
import { getStatePaths } from './workspace.js'

export function emptyConfig() {
  return { services: {} }
}

export async function initProject(workspace) {
  const paths = getStatePaths(workspace)
  const stateStat = await statOrNull(paths.stateDir)
  if (stateStat && !stateStat.isDirectory()) {
    throw new Error(paths.stateDir + ' already exists and is not a directory')
  }
  await fs.mkdir(paths.cacheDir, { recursive: true })
  const configExists = await exists(paths.configPath)
  if (!configExists) await writeJson(paths.configPath, emptyConfig())
  return {
    workspace,
    stateDir: paths.stateDir,
    configPath: paths.configPath,
    cacheDir: paths.cacheDir,
    created: !configExists
  }
}

export async function readConfig(workspace) {
  const configPath = getStatePaths(workspace).configPath
  if (!(await exists(configPath))) return emptyConfig()
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'))
  if (!config || typeof config !== 'object') throw new Error('Invalid config: expected object')
  if (!config.services || typeof config.services !== 'object') config.services = {}
  return config
}

export async function writeConfig(workspace, config) {
  const paths = getStatePaths(workspace)
  await fs.mkdir(paths.stateDir, { recursive: true })
  await writeJson(paths.configPath, config)
}

export async function addService(workspace, service, url, options = {}) {
  validateServiceName(service)
  validateUrl(url)
  await initProject(workspace)
  const config = await readConfig(workspace)
  if (config.services[service] && !options.overwrite) {
    throw new Error('Service already exists: ' + service)
  }
  config.services[service] = {
    ...(config.services[service] || {}),
    url,
    updatedAt: config.services[service]?.updatedAt ?? null
  }
  await writeConfig(workspace, config)
  return config.services[service]
}

export async function updateService(workspace, service, updates) {
  validateServiceName(service)
  await initProject(workspace)
  const config = await readConfig(workspace)
  const current = config.services[service]
  if (!current) throw new Error('Unknown service: ' + service)
  if (updates.url != null) validateUrl(updates.url)
  config.services[service] = {
    ...current,
    ...pickDefined({
      url: updates.url,
      updatedAt: updates.updatedAt
    })
  }
  await writeConfig(workspace, config)
  return config.services[service]
}

export async function removeService(workspace, service) {
  validateServiceName(service)
  const config = await readConfig(workspace)
  const existed = Boolean(config.services[service])
  delete config.services[service]
  await writeConfig(workspace, config)
  return { service, removed: existed }
}

export function getService(config, service) {
  validateServiceName(service)
  const item = config.services?.[service]
  if (!item) throw new Error('Unknown service: ' + service)
  if (!item.url) throw new Error('Service has no url: ' + service)
  return item
}

export function validateServiceName(service) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(service || ''))) {
    throw new Error('Invalid service name. Use letters, numbers, underscore, or dash.')
  }
}

function validateUrl(value) {
  try {
    const parsed = new URL(value)
    if (!['http:', 'https:', 'file:'].includes(parsed.protocol)) throw new Error('unsupported protocol')
  } catch {
    throw new Error('Invalid swagger url: ' + value)
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8')
}

async function exists(filePath) {
  return Boolean(await statOrNull(filePath))
}

async function statOrNull(filePath) {
  try {
    return await fs.stat(filePath)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function pickDefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
}
