// Main-process i18n: reads the persisted language preference and provides
// translated error/dialog strings for IPC-surfaced messages.
import { readPreferences } from './db'
import path from 'node:path'

type Lang = 'zh-CN' | 'en-US'

const MESSAGES = {
  'zh-CN': {
    noCredentials: '未配置认证凭据（密码或私钥），请在主机管理中补充',
    fetchHttpFailed: '拉取失败: HTTP {status} {statusText}',
    fetchEmpty: '拉取到的内容为空',
    fetchTimeout: '拉取超时（30s）',
    fetchTooLarge: '接口规范超过 10MB，无法导入',
    aiNoBase: '未配置 AI Base URL（设置 → 高级功能 → AI 接口配置）',
    aiNoKey: '未配置 AI API Key（设置 → 高级功能 → AI 接口配置）',
    aiAuthFailed: 'AI 认证失败（401）：请检查 API Key',
    aiNotFound: 'AI 接口 404：请检查 Base URL 与模型名（{url}）',
    aiRequestFailed: 'AI 请求失败: HTTP {status} {detail}',
    aiNotJson: 'AI 返回的不是 JSON：{text}',
    aiEmpty: 'AI 返回为空',
    aiTimeout: 'AI 请求超时（120s）',
    execTimeout: '请求超时（{ms}ms）',
    noHostsConfigured: 'TMX 中尚未配置任何主机',
    hostNotFound: '找不到主机 "{query}"，可用 list_hosts 查看已配置主机',
    confirmDenied: '用户在 TMX 中拒绝或未响应本次确认请求',
    hostNoCreds: '主机未配置凭据（密码或私钥），无法执行命令',
    execChannelFailed: '无法打开执行通道',
    argsRequired: '参数 {args} 必填',
    execSummary: '在 {name} ({userHost}) 执行命令:\n{command}',
    outputTruncated: '（输出被截断）',
    noActiveSessions: '当前没有活动的终端会话',
    sessionMissing: '会话不存在或已结束',
    noOutput: '（暂无输出）',
    inputSummary: '向终端会话「{title}」写入输入:\n{data}',
    inputWritten: '已写入',
    keyReadFailed: '无法读取私钥文件 ({path}): {reason}',
    sshFailed: 'SSH 连接失败',
    shellFailed: '无法打开远程 shell',
    sftpChannelFailed: '无法打开 SFTP 通道',
    fileTooLarge: '文件超过 2MB，不支持在线读取',
    binaryFile: '二进制文件不支持在线读取',
    nameExists: '同名文件已存在',
    pickDownloadDir: '选择下载保存目录',
    pickSendFile: '选择要发送的文件 (rz)',
    writeHandleMissing: '写入句柄不存在',
    fileReadFailed: '无法读取文件 {path}',
    ctxCut: '剪切',
    ctxCopy: '复制',
    ctxPaste: '粘贴',
    ctxSelectAll: '全选',
    fetchFailed: '拉取失败: HTTP {status}',
    fetchNoBody: '响应体为空',
    fetchNotJson: '响应不是合法 JSON',
    invalidArgs: '参数无效',
    hostNotFound: '找不到主机 "{query}"，可用 list_hosts 查看已配置主机',
    noHosts: 'TMX 中尚未配置任何主机',
    unknownTool: '未知工具: {tool}',
    methodNotFound: '方法不支持: {method}',
    tokenFailed: 'token 校验失败，请删除 ~/.tmx/bridge.json 后重启 TMX',
    dialogConfirmTitle: '请确认',
    dialogOk: '确定',
    dialogCancel: '取消',
    dialogQuitTitle: '退出 TMX',
    dialogQuitMessage: '仍有活动的 SSH 会话',
    dialogQuitDetail: '当前存在 {count} 个活动的 SSH 会话。退出将断开所有连接。',
    dialogQuitConfirm: '仍要退出',
    dialogSaveConfigTitle: '导出配置',
    dialogSaveDone: '已保存到 {path}',
    menuFile: '文件',
    menuView: '视图',
    menuWindow: '窗口',
    menuNewTab: '新建终端标签',
    menuCloseTab: '关闭当前标签',
    menuSettings: '设置…',
    menuCommandPalette: '命令面板…',
    menuCopilot: 'AI 助手',
    menuSftp: '文件管理 (SFTP)',
    menuSplit: '切换分屏',
    menuZen: '禅模式',
    menuMinimize: '最小化',
    menuQuit: '退出',
  },
  'en-US': {
    noCredentials: 'No credentials configured (password or private key). Add them in Host management.',
    fetchHttpFailed: 'Fetch failed: HTTP {status} {statusText}',
    fetchEmpty: 'Fetched content is empty',
    fetchTimeout: 'Fetch timed out (30s)',
    fetchTooLarge: 'API specification exceeds 10MB and cannot be imported',
    aiNoBase: 'AI Base URL not configured (Settings → Advanced → AI API)',
    aiNoKey: 'AI API Key not configured (Settings → Advanced → AI API)',
    aiAuthFailed: 'AI authentication failed (401): check the API Key',
    aiNotFound: 'AI endpoint 404: check Base URL and model ({url})',
    aiRequestFailed: 'AI request failed: HTTP {status} {detail}',
    aiNotJson: 'AI response is not JSON: {text}',
    aiEmpty: 'AI returned empty content',
    aiTimeout: 'AI request timed out (120s)',
    execTimeout: 'Request timed out ({ms}ms)',
    noHostsConfigured: 'No hosts configured in TMX yet',
    hostNotFound: 'Host "{query}" not found. Use list_hosts to see configured hosts',
    confirmDenied: 'The request was denied or timed out in TMX',
    hostNoCreds: 'Host has no credentials (password or private key); cannot execute',
    execChannelFailed: 'Failed to open execution channel',
    argsRequired: 'Missing required argument(s): {args}',
    execSummary: 'Execute on {name} ({userHost}):\n{command}',
    outputTruncated: ' (output truncated)',
    noActiveSessions: 'No active terminal sessions',
    sessionMissing: 'Session does not exist or has ended',
    noOutput: '(no output yet)',
    inputSummary: 'Write input to terminal session "{title}":\n{data}',
    inputWritten: 'Written',
    keyReadFailed: 'Cannot read private key ({path}): {reason}',
    sshFailed: 'SSH connection failed',
    shellFailed: 'Failed to open remote shell',
    sftpChannelFailed: 'Failed to open SFTP channel',
    fileTooLarge: 'File exceeds 2MB; inline reading not supported',
    binaryFile: 'Binary files cannot be read inline',
    nameExists: 'A file with the same name already exists',
    pickDownloadDir: 'Choose download folder',
    pickSendFile: 'Choose file to send (rz)',
    writeHandleMissing: 'Write handle does not exist',
    fileReadFailed: 'Cannot read file {path}',
    ctxCut: 'Cut',
    ctxCopy: 'Copy',
    ctxPaste: 'Paste',
    ctxSelectAll: 'Select All',
    fetchFailed: 'Fetch failed: HTTP {status}',
    fetchNoBody: 'Empty response body',
    fetchNotJson: 'Response is not valid JSON',
    invalidArgs: 'Invalid arguments',
    hostNotFound: 'Host "{query}" not found. Use list_hosts to see configured hosts',
    noHosts: 'No hosts configured in TMX yet',
    unknownTool: 'Unknown tool: {tool}',
    methodNotFound: 'Method not supported: {method}',
    tokenFailed: 'Token check failed. Delete ~/.tmx/bridge.json and restart TMX',
    dialogConfirmTitle: 'Confirm',
    dialogOk: 'OK',
    dialogCancel: 'Cancel',
    dialogQuitTitle: 'Quit TMX',
    dialogQuitMessage: 'Active SSH sessions are still open',
    dialogQuitDetail: '{count} active SSH session(s). Quitting will disconnect them all.',
    dialogQuitConfirm: 'Quit anyway',
    dialogSaveConfigTitle: 'Export configuration',
    dialogSaveDone: 'Saved to {path}',
    menuFile: 'File',
    menuView: 'View',
    menuWindow: 'Window',
    menuNewTab: 'New Terminal Tab',
    menuCloseTab: 'Close Tab',
    menuSettings: 'Settings…',
    menuCommandPalette: 'Command Palette…',
    menuCopilot: 'AI Copilot',
    menuSftp: 'File Manager (SFTP)',
    menuSplit: 'Toggle Split Pane',
    menuZen: 'Zen Mode',
    menuMinimize: 'Minimize',
    menuQuit: 'Quit',
  },
} as const

type Key = keyof (typeof MESSAGES)['zh-CN']

let cache: { lang: Lang; at: number } | null = null

export function getLang(): Lang {
  if (cache && Date.now() - cache.at < 3000) return cache.lang
  let lang: Lang = 'zh-CN'
  try {
    const prefs = readPreferences()
    const v = prefs?.['language']
    if (v === 'en-US') lang = 'en-US'
    else if (v === 'zh-CN') lang = 'zh-CN'
  } catch {
    // preferences unavailable — default Chinese
  }
  cache = { lang, at: Date.now() }
  return lang
}

/** Translate a main-process message with {param} interpolation. */
export function mt(key: Key, params?: Record<string, string | number>): string {
  const lang = getLang()
  let text: string = MESSAGES[lang][key] ?? MESSAGES['zh-CN'][key]
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
  }
  return text
}

/** Resolve a user-facing file name keeping only the basename (path-safe). */
export function baseName(p: string): string {
  return path.basename(p)
}
