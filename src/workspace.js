import path from 'node:path'

export const STATE_DIR_NAME = '.swagger-mcp'

export function resolveWorkspace(argv = process.argv, env = process.env) {
  const cliValue = readOption(argv, '--workspace')
  const workspace = cliValue || env.SWAGGER_MCP_WORKSPACE || process.cwd()
  return path.resolve(workspace)
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

function readOption(argv, name) {
  const index = argv.indexOf(name)
  if (index === -1) return null
  const value = argv[index + 1]
  return value && !value.startsWith('--') ? value : null
}
