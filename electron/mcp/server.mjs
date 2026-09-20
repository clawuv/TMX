#!/usr/bin/env node
// TMX MCP bridge — zero-dependency Model Context Protocol server over stdio.
//
// AI tools (Claude Desktop, Cursor, ...) spawn this process and speak
// newline-delimited JSON-RPC 2.0 on stdin/stdout. Tool calls are forwarded to a
// running TMX app over a local socket described by ~/.tmx/bridge.json
// (written by the app; contains socket path + auth token).
//
// Everything logged here MUST go to stderr — stdout is the protocol channel.

import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'

const BRIDGE_CONFIG_PATH = path.join(os.homedir(), '.tmx', 'bridge.json')
const CONNECT_TIMEOUT_MS = 3_000
const CALL_TIMEOUT_MS = 180_000
const PROTOCOL_VERSION = '2025-06-18'

const SERVER_NAME = 'tmx'
const SERVER_VERSION = '1.0.0'

const TOOLS = [
  {
    name: 'list_hosts',
    description: '列出 TMX 中已配置的 SSH 主机（名称、user@host、端口、分组、标签；不含任何凭据）',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'exec_command',
    description: '在指定 SSH 主机上执行一条命令并返回输出。host 为主机名称或 user@host',
    inputSchema: {
      type: 'object',
      required: ['host', 'command'],
      properties: {
        host: { type: 'string', description: '主机名称或 user@host' },
        command: { type: 'string', description: '要执行的命令' },
        timeout_s: { type: 'number', description: '超时秒数，默认 30' },
        max_bytes: { type: 'number', description: '返回输出最大字节数，默认 16384' },
      },
    },
  },
  {
    name: 'list_sessions',
    description: '列出当前 TMX 中活动的终端会话（标签页标题、主机、类型 local/ssh、会话 ID）',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'read_session_output',
    description: '读取某个活动终端会话最近的屏幕输出',
    inputSchema: {
      type: 'object',
      required: ['session_id'],
      properties: {
        session_id: { type: 'string', description: 'list_sessions 返回的会话 ID' },
        last_bytes: { type: 'number', description: '读取末尾多少字节，默认 4096' },
      },
    },
  },
  {
    name: 'send_session_input',
    description: '向活动终端会话写入输入（末尾加 \\n 表示回车执行）',
    inputSchema: {
      type: 'object',
      required: ['session_id', 'data'],
      properties: {
        session_id: { type: 'string' },
        data: { type: 'string', description: '要写入的内容，如 "ls -al\\n"' },
      },
    },
  },
  {
    name: 'run_snippet',
    description: '按标题执行 TMX 中保存的快捷脚本片段，可选指定目标主机（默认使用片段上次主机或需指定）',
    inputSchema: {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string', description: '片段标题（精确或前缀匹配）' },
        host: { type: 'string', description: '目标主机名称或 user@host（可选）' },
      },
    },
  },
  {
    name: 'sftp_list',
    description: '列出远程主机某目录下的文件（名称、类型、大小、修改时间）',
    inputSchema: {
      type: 'object',
      required: ['host', 'path'],
      properties: {
        host: { type: 'string' },
        path: { type: 'string', description: '远程绝对路径，如 /var/www' },
      },
    },
  },
  {
    name: 'sftp_read_file',
    description: '读取远程文本文件内容（不超过 2MB，二进制文件会报错）',
    inputSchema: {
      type: 'object',
      required: ['host', 'path'],
      properties: {
        host: { type: 'string' },
        path: { type: 'string', description: '远程文件绝对路径' },
      },
    },
  },
]

function log(...args) {
  console.error('[tmx-mcp]', ...args)
}

function readBridgeConfig() {
  try {
    const raw = fs.readFileSync(BRIDGE_CONFIG_PATH, 'utf8')
    const cfg = JSON.parse(raw)
    if (!cfg.socketPath || !cfg.token) throw new Error('missing fields')
    return cfg
  } catch {
    return null
  }
}

/** Open a socket to the TMX app and complete the token handshake. */
function connectApp() {
  const cfg = readBridgeConfig()
  if (!cfg) {
    throw new Error(
      `无法找到 TMX 桥接配置 (${BRIDGE_CONFIG_PATH})。请先启动 TMX 桌面应用，并确认设置中「MCP 服务」已启用。`,
    )
  }
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(cfg.socketPath)
    let buffered = ''
    const fail = (err) => {
      socket.destroy()
      reject(err instanceof Error ? err : new Error(String(err)))
    }
    socket.setTimeout(CONNECT_TIMEOUT_MS, () => fail(new Error('连接 TMX 超时')))
    socket.on('error', (err) => {
      if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED') {
        fail(new Error('无法连接到 TMX。请先启动 TMX 桌面应用。'))
      } else {
        fail(new Error(`连接 TMX 失败: ${err.message}`))
      }
    })
    socket.on('connect', () => {
      socket.setTimeout(0)
      socket.write(JSON.stringify({ hello: cfg.token }) + '\n')
    })
    socket.on('data', function onData(chunk) {
      buffered += chunk.toString('utf8')
      const nl = buffered.indexOf('\n')
      if (nl === -1) return
      let msg
      try {
        msg = JSON.parse(buffered.slice(0, nl))
      } catch {
        socket.off('data', onData)
        return fail(new Error('TMX 桥接握手响应异常'))
      }
      if (msg.ok) {
        socket.off('data', onData)
        resolve(socket)
      } else {
        socket.off('data', onData)
        fail(new Error(msg.error || 'TMX 桥接握手被拒绝'))
      }
    })
  })
}

/** Send one tool call to the app and wait for its response. */
function callApp(socket, id, tool, args) {
  return new Promise((resolve, reject) => {
    let buffered = ''
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`调用 ${tool} 超时（${CALL_TIMEOUT_MS / 1000}s）`))
    }, CALL_TIMEOUT_MS)
    const onData = (chunk) => {
      buffered += chunk.toString('utf8')
      let nl
      while ((nl = buffered.indexOf('\n')) !== -1) {
        const line = buffered.slice(0, nl)
        buffered = buffered.slice(nl + 1)
        if (!line.trim()) continue
        let msg
        try {
          msg = JSON.parse(line)
        } catch {
          continue
        }
        if (msg.id !== id) continue
        cleanup()
        if (msg.ok) resolve(msg.data)
        else reject(new Error(msg.error || `${tool} 执行失败`))
        return
      }
    }
    const cleanup = () => {
      clearTimeout(timer)
      socket.off('data', onData)
    }
    socket.on('data', onData)
    socket.write(JSON.stringify({ id, tool, args: args ?? {} }) + '\n')
  })
}

function jsonResult(msg) {
  return { content: [{ type: 'text', text: typeof msg === 'string' ? msg : JSON.stringify(msg, null, 2) }] }
}

async function handleToolCall(id, params) {
  const tool = TOOLS.find((t) => t.name === params?.name)
  if (!tool) {
    return { jsonrpc: '2.0', id, error: { code: -32602, message: `未知工具: ${params?.name}` } }
  }
  let socket
  try {
    socket = await connectApp()
    const data = await callApp(socket, id, tool.name, params.arguments ?? {})
    return { jsonrpc: '2.0', id, result: jsonResult(data) }
  } catch (err) {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        isError: true,
      },
    }
  } finally {
    socket?.destroy()
  }
}

function route(msg) {
  if (!msg || typeof msg !== 'object') return null
  // Notifications (no id) never get a response.
  if (msg.id === undefined || msg.id === null) return null

  const { id, method, params } = msg
  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          // Echo the client's requested version when present so the pair always agrees.
          protocolVersion: params?.protocolVersion ?? PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        },
      }
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} }
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: TOOLS } }
    case 'tools/call':
      return handleToolCall(id, params)
    default:
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `方法不支持: ${method}` } }
  }
}

async function main() {
  log(`TMX MCP bridge 已启动 (配置: ${BRIDGE_CONFIG_PATH})`)
  const rl = readline.createInterface({ input: process.stdin, terminal: false })
  rl.on('line', (line) => {
    const trimmed = line.trim()
    if (!trimmed) return
    let msg
    try {
      msg = JSON.parse(trimmed)
    } catch {
      writeMessage({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON 解析失败' } })
      return
    }
    Promise.resolve(route(msg))
      .then((response) => {
        if (response) writeMessage(response)
      })
      .catch((err) => {
        if (msg.id !== undefined && msg.id !== null) {
          writeMessage({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: err?.message ?? '内部错误' } })
        }
      })
  })
  rl.on('close', () => {
    // stdin is done. Do NOT process.exit() here — it would truncate buffered
    // stdout writes (piped writes are async). Let pending responses flush and
    // the event loop drain for a natural exit; the unref'd timer below only
    // fires if a forwarded call wedges forever.
    const force = setTimeout(() => process.exit(0), 15_000)
    force.unref()
  })
}

function writeMessage(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

main().catch((err) => {
  log('启动失败:', err?.message ?? err)
  process.exit(1)
})
