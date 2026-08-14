import path from 'node:path'

export const STATE_DIR_NAME = '.swagger-mcp'

export function resolveWorkspace(workspace) {
  if (typeof workspace !== 'string' || !workspace.trim()) {
    throw new Error('workspace is required')
  }
  if (!path.isAbsolute(workspace)) {
    throw new Error('workspace must be an absolute path')
  }
  return path.normalize(workspace)
}

export function getStatePaths(workspace) {
  const stateDir = path.join(workspace, STATE_DIR_NAME)
  return {
    workspace,
    stateDir,
    configPath: path.join(stateDir, 'config.json'),
    cacheDir: path.join(stateDir, 'cache')
  }
}
