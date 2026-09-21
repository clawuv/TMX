export interface AnsiColors {
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface ThemeConfig {
  id: string;
  name: string;
  nameCn: string;
  tagline: string;
  description: string;
  bgBase: string;          // Deepest window background
  bgSurface: string;       // Primary panels & sidebar
  bgCanvas: string;        // Terminal black/canvas background
  bgActive: string;        // Active tab, hover highlight
  bgInput: string;         // Input area, command bar
  borderSubtle: string;    // Hairline border
  borderHover: string;
  textPrimary: string;     // High readability white/off-white
  textSecondary: string;   // Subdued metadata
  textMuted: string;       // Line numbers, inactive
  accentPrimary: string;   // Frost cyan / signature highlight
  accentSoft: string;      // Accent with alpha/glow
  accentSuccess: string;   // Latency < 50ms, status ok
  accentWarning: string;   // High CPU, load
  accentError: string;     // Offline, syntax error
  light?: boolean;         // Light scheme: flips hardcoded slate text via CSS vars
  ansi: AnsiColors;
}

export interface ConnectionHost {
  id: string;
  name: string;
  host: string;
  user: string;
  port: number;
  /** Free-form group name; custom groups are allowed (see HostDrawer). */
  group: string;
  tag: string;
  status: 'online' | 'standby' | 'offline';
  pingMs: number;
  cpuLoad: number;
  memLoad: number;
  diskLoad: number;
  os: string;
  fingerprint: string;
  authMethod: 'Ed25519 Key' | 'RSA 4096' | 'Password';
  /** Bookmarked hosts sort first in the host list; order = sortIndex. */
  favorite?: boolean;
  /** Bookmark order among favorited hosts (1-based). */
  sortIndex?: number;
  /** In-memory only credentials for real SSH sessions; never persisted. */
  password?: string;
  privateKeyPath?: string;
  /** Passphrase for encrypted private keys; in-memory only. */
  passphrase?: string;
}

export type TabContentType = 'terminal' | 'sftp' | 'monitor';

export interface TabItem {
  id: string;
  hostId: string;
  title: string;
  hostName: string;
  userHost: string;
  contentType: TabContentType;
  status: 'connected' | 'connecting' | 'disconnected';
  isSplit?: boolean;
  splitDirection?: 'horizontal' | 'vertical';
}

export interface SFTPFile {
  id: string;
  name: string;
  type: 'file' | 'dir';
  size: string;
  /** Raw byte size from the remote stat, when available. */
  sizeBytes?: number;
  permissions: string;
  owner: string;
  group: string;
  modified: string;
  /** epoch ms, from the remote stat, when available. */
  mtime?: number;
  ext?: string;
  hidden?: boolean;
}

/** Raw directory entry from the main-process SFTP listing (presentation done in the renderer). */
export interface SftpEntry {
  name: string;
  isDir: boolean;
  size: number;
  /** epoch ms */
  mtime: number;
  mode: number;
  uid: number;
  gid: number;
}

/** What the monitor page should sample. `local` targets the machine running TMX. */
export type MonitorTarget =
  | { kind: 'local' }
  | {
      kind: 'ssh';
      host: string;
      port: number;
      username: string;
      password?: string;
      privateKeyPath?: string;
      passphrase?: string;
      keepaliveInterval?: number;
    };

export interface MonitorProcess {
  pid: number;
  user: string;
  cpu: number;
  mem: number;
  /** Raw `ps` state token (e.g. "Ss", "R+") on Unix; the process name on Windows. */
  state: string;
  command: string;
}

export interface MonitorDisk {
  mount: string;
  fs: string;
  total: number;
  used: number;
}

export interface MonitorNetIface {
  name: string;
  rxBytes: number;
  txBytes: number;
  /** bytes per second */
  rxRate: number;
  /** bytes per second */
  txRate: number;
}

/** One sampled snapshot of a monitored host (mirrors electron/main/monitor-parse.ts). */
export interface MonitorSample {
  os: string;
  kernel: string;
  hostname: string;
  uptimeSec: number;
  cpuPercent: number;
  cpuCount: number;
  cpuModel: string;
  cpuMhz: number;
  loadAvg: [number, number, number] | null;
  memTotal: number;
  memUsed: number;
  swapTotal: number;
  swapUsed: number;
  disks: MonitorDisk[];
  net: MonitorNetIface[];
  processes: MonitorProcess[];
  /** Round-trip time of the sampling call itself, in ms. */
  rttMs: number;
  sampledAt: number;
}

export type TransferDirection = 'upload' | 'download';
export type TransferStatus = 'queued' | 'active' | 'done' | 'error' | 'cancelled';
export interface TransferItem {
  id: string;
  direction: TransferDirection;
  name: string;
  remotePath: string;
  /** Local file path: upload source or download destination. */
  localPath: string;
  size: number;
  loaded: number;
  status: TransferStatus;
  error?: string;
}

export interface TerminalLine {
  id: string;
  type: 'command' | 'output' | 'error' | 'system' | 'ai';
  content: string;
  prompt?: string;
  timestamp?: string;
}

export interface QuickSnippet {
  id: string;
  title: string;
  command: string;
  category: 'Linux' | 'Mac' | 'Windows';
  description: string;
}

export type SettingTabId = 'language' | 'appearance' | 'shortcuts' | 'sidebar' | 'advanced' | 'security' | 'bookmarks' | 'storage' | 'mcp' | 'about';

export interface UserPreferences {
  // 语言
  language?: 'zh-CN' | 'en-US';
  terminalEncoding: 'UTF-8' | 'GBK' | 'ISO-8859-1';
  timeFormat: '24h' | '12h' | 'ISO';
  
  // 外观
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  cursorStyle: 'block' | 'line' | 'underline';
  cursorBlink: boolean;
  showWatermark: boolean;
  watermarkOpacity: number;
  showGrid: boolean;

  // 快捷命令
  fuzzySearch: boolean;
  autoSuggestHistory: boolean;

  // 左侧菜单显示开关
  sidebarVisibleItems: {
    hosts: boolean;
    sftp: boolean;
    snippets: boolean;
    ai: boolean;
    monitor: boolean;
    test: boolean;
  };
  sidebarPosition: 'left' | 'right';
  sidebarCompact: boolean;

  // 高级功能
  sshKeepAlive: number;
  autoReconnect: boolean;
  scrollbackLimit: number;
  copyOnSelect: boolean;
  pasteOnRightClick: boolean;
  aiModel: string;
  aiStreamResponse: boolean;
  warnOnCloseSession: boolean;

  // AI 接口（OpenAI 兼容；Test 批量接口测试使用）
  aiBaseUrl: string;
  /** Plaintext, stored in SQLite like other local credentials. */
  aiApiKey: string;
  aiApiModel: string;

  // MCP 服务
  /** Expose TMX capabilities to external AI tools via a local stdio bridge. */
  mcpEnabled: boolean;
  /** Ask for confirmation inside TMX before MCP tools execute commands. */
  mcpRequireConfirm: boolean;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  // language omitted → follow the system locale (resolved in I18nProvider)
  terminalEncoding: 'UTF-8',
  timeFormat: '24h',
  fontFamily: 'Fira Code',
  fontSize: 14,
  lineHeight: 1.6,
  cursorStyle: 'block',
  cursorBlink: true,
  showWatermark: true,
  watermarkOpacity: 12,
  showGrid: true,
  fuzzySearch: true,
  autoSuggestHistory: true,
  sidebarVisibleItems: {
    hosts: true,
    sftp: true,
    snippets: true,
    // Copilot and API batch testing are opt-in: hidden until enabled in settings.
    ai: false,
    monitor: true,
    test: false,
  },
  sidebarPosition: 'left',
  sidebarCompact: false,
  sshKeepAlive: 30,
  autoReconnect: true,
  scrollbackLimit: 5000,
  copyOnSelect: true,
  pasteOnRightClick: true,
  aiModel: 'Google Gemini 2.0 Flash (极速)',
  aiStreamResponse: true,
  warnOnCloseSession: true,
  aiBaseUrl: 'https://api.deepseek.com',
  aiApiKey: '',
  aiApiModel: 'deepseek-chat',
  mcpEnabled: true,
  mcpRequireConfirm: true,
};
