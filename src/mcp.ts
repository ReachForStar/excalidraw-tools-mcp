#!/usr/bin/env node
/**
 * `excalidraw-mcp` entry point. Serves the Excalidraw canvas tools to any MCP
 * client over stdio (default) or Streamable HTTP.
 *
 * Configuration comes from flags or environment variables so the same binary
 * works for one-shot `npx` runs and for long-lived HTTP deployments:
 *   --workspace / EXCALIDRAW_WORKSPACE  workspace root; repeat the flag (or join
 *                                       with the OS path delimiter in the env)
 *                                       to serve several workspaces
 *   --scene / EXCALIDRAW_SCENE          scene file (default `.agents/excalidraw/scene.json`)
 *   --transport http | --http           switch to Streamable HTTP
 *   --host / EXCALIDRAW_MCP_HOST        bind address (default 127.0.0.1)
 *   --port / EXCALIDRAW_MCP_PORT        bind port (default 7801, 0 picks a free port)
 *   --token / EXCALIDRAW_MCP_TOKEN      required bearer token for HTTP
 *   --chrome / EXCALIDRAW_CHROME        Chrome/Chromium used by PNG and SVG export
 * @module excalidraw-mcp/cli
 */

import { realpathSync } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { delimiter, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { SCENE_RELATIVE, workspaceScope, type WorkspaceScope } from './scene.js'
import { startHttpServer } from './mcp/http.js'
import { PACKAGE_NAME, PACKAGE_VERSION, createMcpServer } from './mcp/server.js'

/** Parsed command line. */
export interface CliOptions {
  transport: 'stdio' | 'http'
  /** Workspace roots; the first one is the default target of tool calls. */
  workspaces: string[]
  scene?: string
  host: string
  port: number
  token?: string
  /** Chrome/Chromium executable for scene export. */
  chrome?: string
}

/** Outcome of parsing argv. */
export type CliCommand =
  | { kind: 'run'; options: CliOptions }
  | { kind: 'help' }
  | { kind: 'version' }

/** Thrown for a malformed invocation; the caller exits with code 2. */
export class UsageError extends Error {}

/** Usage text. */
const USAGE = `Usage: excalidraw-mcp [options]

Excalidraw canvas tools over the Model Context Protocol.

Options:
  -w, --workspace <dir>   Workspace root; exports stay inside it (default: cwd).
                          Repeat the flag to serve several workspaces; every
                          tool call then names its workspace. The first flag
                          replaces EXCALIDRAW_WORKSPACE.
      --scene <path>      Default drawing's scene file, absolute or workspace-relative
                          (default: ${SCENE_RELATIVE}); single-workspace only.
      --http              Serve Streamable HTTP instead of stdio.
      --transport <name>  "stdio" (default) or "http".
      --host <host>       HTTP bind address (default: 127.0.0.1).
      --port <port>       HTTP port, 0 picks a free port (default: 7801).
      --token <token>     Require "Authorization: Bearer <token>" on HTTP;
                          mandatory for any host other than loopback.
      --chrome <path>     Chrome/Chromium executable used to render SVG and PNG
                          exports (default: auto-detect, or EXCALIDRAW_CHROME).
  -h, --help              Show this help.
  -v, --version           Print the package version.

Environment: EXCALIDRAW_WORKSPACE (several roots joined by the OS path
delimiter), EXCALIDRAW_SCENE, EXCALIDRAW_MCP_HOST, EXCALIDRAW_MCP_PORT,
EXCALIDRAW_MCP_TOKEN, EXCALIDRAW_CHROME.
`

/** Read the value that follows a flag. */
function valueAfter(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('-')) throw new UsageError(`${flag} requires a value`)
  return value
}

/** Parse a numeric flag. */
function integerOf(raw: string, flag: string): number {
  if (!/^\d+$/.test(raw)) throw new UsageError(`${flag} must be a non-negative integer`)
  const value = Number.parseInt(raw, 10)
  if (flag === '--port' && value > 65535) throw new UsageError('--port must be 65535 or lower')
  return value
}

/**
 * Parse argv into a command.
 * @param argv - arguments after the script name.
 * @param env - environment variables to fall back on.
 * @returns the command to execute.
 */
export function parseArgs(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): CliCommand {
  let transport: 'stdio' | 'http' = 'stdio'
  const envWorkspaces = env['EXCALIDRAW_WORKSPACE']
  let workspaces = envWorkspaces === undefined
    ? [process.cwd()]
    : envWorkspaces.split(delimiter).filter(entry => entry.length > 0)
  // The first `-w` replaces whatever the environment supplied (or the implicit cwd).
  let explicitWorkspace = false
  let scene = env['EXCALIDRAW_SCENE']
  let host = env['EXCALIDRAW_MCP_HOST'] ?? '127.0.0.1'
  let port = integerOf(env['EXCALIDRAW_MCP_PORT'] ?? '7801', '--port')
  let token = env['EXCALIDRAW_MCP_TOKEN']
  let chrome = env['EXCALIDRAW_CHROME']

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string
    switch (arg) {
      case '-h':
      case '--help':
        return { kind: 'help' }
      case '-v':
      case '--version':
        return { kind: 'version' }
      case '-w':
      case '--workspace':
        if (!explicitWorkspace) {
          workspaces = []
          explicitWorkspace = true
        }
        workspaces.push(valueAfter(argv, i, arg))
        i += 1
        break
      case '--scene':
        scene = valueAfter(argv, i, arg)
        i += 1
        break
      case '--http':
        transport = 'http'
        break
      case '--transport': {
        const value = valueAfter(argv, i, arg)
        if (value !== 'stdio' && value !== 'http') throw new UsageError('--transport must be "stdio" or "http"')
        transport = value
        i += 1
        break
      }
      case '--host':
        host = valueAfter(argv, i, arg)
        i += 1
        break
      case '--port':
        port = integerOf(valueAfter(argv, i, arg), arg)
        i += 1
        break
      case '--token':
        token = valueAfter(argv, i, arg)
        i += 1
        break
      case '--chrome':
        chrome = valueAfter(argv, i, arg)
        i += 1
        break
      default:
        throw new UsageError(`unknown argument: ${arg}`)
    }
  }
  return {
    kind: 'run',
    options: {
      transport,
      workspaces,
      ...(scene !== undefined && scene.length > 0 ? { scene } : {}),
      host,
      port,
      ...(token !== undefined && token.length > 0 ? { token } : {}),
      ...(chrome !== undefined && chrome.length > 0 ? { chrome } : {}),
    },
  }
}

/**
 * Validate every workspace root and build the server scope.
 * @param workspaces - workspace roots from the CLI.
 * @param scene - optional scene override.
 * @returns the resolved scope.
 */
async function resolveScope(workspaces: readonly string[], scene?: string): Promise<WorkspaceScope> {
  if (workspaces.length === 0) throw new UsageError('at least one workspace root is required')
  const roots: string[] = []
  for (const workspace of workspaces) {
    const resolved = resolve(workspace)
    let root: string
    try {
      // Resolve symlinks once here: every later containment check compares paths,
      // and a symlinked root would otherwise be bypassable through its real path.
      root = await realpath(resolved)
    } catch {
      throw new UsageError(`workspace does not exist: ${resolved}`)
    }
    let info: Awaited<ReturnType<typeof stat>>
    try {
      info = await stat(root)
    } catch {
      throw new UsageError(`workspace does not exist: ${root}`)
    }
    if (!info.isDirectory()) throw new UsageError(`workspace is not a directory: ${root}`)
    if (!roots.includes(root)) roots.push(root)
  }
  try {
    return workspaceScope(roots, scene)
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error))
  }
}

/** A started server. */
export interface RunningServer {
  url?: string
  close(): Promise<void>
}

/**
 * Start the server for the parsed options.
 * @param options - parsed command line.
 * @returns the close function, plus the URL when serving HTTP.
 */
export async function serve(options: CliOptions): Promise<RunningServer> {
  // The renderer reads the environment, so the flag only needs to reach it.
  if (options.chrome !== undefined) process.env['EXCALIDRAW_CHROME'] = options.chrome
  const scope = await resolveScope(options.workspaces, options.scene)
  // stderr only: stdout is the stdio protocol channel.
  process.stderr.write(`excalidraw-mcp: workspaces ${scope.roots.join(', ')}\n`)
  const withRendererClosed = (close: () => Promise<void>) => async (): Promise<void> => {
    try {
      await close()
    } finally {
      // Always release the browser: a failing server close must not leak Chrome.
      const { closeRenderer } = await import('./render.js')
      await closeRenderer()
    }
  }
  if (options.transport === 'stdio') {
    const server = createMcpServer(scope)
    await server.connect(new StdioServerTransport())
    return { close: withRendererClosed(() => server.close()) }
  }
  const running = await startHttpServer({
    scope,
    host: options.host,
    port: options.port,
    ...(options.token !== undefined ? { token: options.token } : {}),
  })
  process.stderr.write(`excalidraw-mcp: listening on ${running.url}\n`)
  return { url: running.url, close: withRendererClosed(running.close) }
}

/** Run the CLI, mapping usage errors to exit code 2. */
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  let command: CliCommand
  try {
    command = parseArgs(argv)
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`excalidraw-mcp: ${error.message}\n\n${USAGE}`)
      process.exitCode = 2
      return
    }
    throw error
  }
  if (command.kind === 'help') {
    process.stdout.write(USAGE)
    return
  }
  if (command.kind === 'version') {
    process.stdout.write(`${PACKAGE_NAME} ${PACKAGE_VERSION}\n`)
    return
  }
  const running = await serve(command.options)
  if (running.url === undefined) return
  process.stderr.write('excalidraw-mcp: send JSON-RPC POST requests to the URL above\n')
  await new Promise<void>((resolve) => {
    process.once('SIGINT', resolve)
    process.once('SIGTERM', resolve)
  })
  await running.close()
}

/**
 * True when `entry` resolves to this module. npm installs the bin as a symlink,
 * so comparing raw paths would skip main().
 */
export function isEntryPoint(entry: string | undefined, moduleUrl: string = import.meta.url): boolean {
  if (entry === undefined) return false
  try {
    return realpathSync(entry) === fileURLToPath(moduleUrl)
  } catch {
    return false
  }
}

if (isEntryPoint(process.argv[1])) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`excalidraw-mcp: ${message}\n`)
    process.exit(1)
  })
}
