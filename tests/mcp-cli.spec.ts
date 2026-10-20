import { describe, expect, it } from 'vitest'
import { UsageError, parseArgs } from '../src/mcp.ts'

describe('excalidraw-mcp CLI arguments', () => {
  it('defaults to stdio and the current directory', () => {
    const command = parseArgs([], {})
    expect(command).toEqual({
      kind: 'run',
      options: { transport: 'stdio', workspace: process.cwd(), host: '127.0.0.1', port: 7801 },
    })
  })

  it('reads the workspace, scene, and HTTP settings from flags', () => {
    const command = parseArgs([
      '--http', '--workspace', '/tmp/ws', '--scene', 'board.excalidraw',
      '--host', '0.0.0.0', '--port', '9000', '--token', 'abc',
    ], {})
    expect(command).toEqual({
      kind: 'run',
      options: {
        transport: 'http',
        workspace: '/tmp/ws',
        scene: 'board.excalidraw',
        host: '0.0.0.0',
        port: 9000,
        token: 'abc',
      },
    })
  })

  it('falls back to environment variables', () => {
    const command = parseArgs([], {
      EXCALIDRAW_WORKSPACE: '/env/ws',
      EXCALIDRAW_SCENE: '/env/scene.json',
      EXCALIDRAW_MCP_PORT: '8123',
      EXCALIDRAW_MCP_HOST: '127.0.0.2',
      EXCALIDRAW_MCP_TOKEN: 'env-token',
    })
    expect(command).toMatchObject({
      kind: 'run',
      options: { workspace: '/env/ws', scene: '/env/scene.json', port: 8123, host: '127.0.0.2', token: 'env-token' },
    })
  })

  it('returns help and version commands', () => {
    expect(parseArgs(['--help'], {})).toEqual({ kind: 'help' })
    expect(parseArgs(['-v'], {})).toEqual({ kind: 'version' })
  })

  it('rejects unknown flags, missing values, and invalid ports', () => {
    expect(() => parseArgs(['--nope'], {})).toThrow(UsageError)
    expect(() => parseArgs(['--workspace'], {})).toThrow('requires a value')
    expect(() => parseArgs(['--port', 'abc'], {})).toThrow('non-negative integer')
    expect(() => parseArgs(['--port', '70000'], {})).toThrow('65535')
    expect(() => parseArgs(['--transport', 'sse'], {})).toThrow('stdio')
  })
})
