// Pure parsing helpers for the host monitor. Kept free of electron/ssh imports so
// the samplers can be exercised from plain node and unit-tested with vitest.

export interface MonitorProcess {
  pid: number
  user: string
  cpu: number
  mem: number
  /** Raw `ps` state token (e.g. "Ss", "R+"); mapped to a label in the renderer. */
  state: string
  command: string
}

export interface MonitorDisk {
  mount: string
  fs: string
  total: number
  used: number
}

export interface MonitorNetIface {
  name: string
  rxBytes: number
  txBytes: number
  rxRate: number
  txRate: number
}

export interface MonitorSample {
  os: string
  kernel: string
  hostname: string
  uptimeSec: number
  cpuPercent: number
  cpuCount: number
  cpuModel: string
  cpuMhz: number
  loadAvg: [number, number, number] | null
  memTotal: number
  memUsed: number
  swapTotal: number
  swapUsed: number
  disks: MonitorDisk[]
  net: MonitorNetIface[]
  processes: MonitorProcess[]
  /** Round-trip time of the sampling call itself, in ms. */
  rttMs: number
  sampledAt: number
}

/** Sections are delimited by `@@name` markers so one round trip carries everything. */
export function parseSections(raw: string): { name: string; lines: string[] }[] {
  const out: { name: string; lines: string[] }[] = []
  let current: { name: string; lines: string[] } | null = null
  // Drop the artifact of the final newline so the last section has no phantom line.
  const text = raw.endsWith('\n') ? raw.slice(0, -1) : raw
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (line.startsWith('@@')) {
      current = { name: line.slice(2).trim(), lines: [] }
      out.push(current)
      continue
    }
    if (current) current.lines.push(line)
  }
  return out
}

export function sectionOf(
  sections: { name: string; lines: string[] }[],
  name: string,
  occurrence = 0,
): string[] {
  const found = sections.filter((s) => s.name === name)
  return found[occurrence]?.lines ?? []
}

function num(value: string | undefined): number | null {
  if (value == null) return null
  const n = Number(value.trim())
  return Number.isFinite(n) ? n : null
}

function firstText(lines: string[]): string {
  return (lines.find((l) => l.trim().length > 0) ?? '').trim()
}

/** PowerShell's ConvertTo-Json collapses single-element arrays into a scalar. */
function asArray<T>(value: T[] | T | undefined | null): T[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

// ── /proc/stat ──────────────────────────────────────────────────────────────
// cpu  user nice system idle iowait irq softirq steal guest guest_nice
export function parseCpuStat(line: string): { idle: number; total: number } | null {
  const m = /^cpu\s+(.+)$/.exec(line.trim())
  if (!m) return null
  const parts = m[1].trim().split(/\s+/).map(Number)
  if (parts.length < 4 || parts.some((n) => !Number.isFinite(n))) return null
  const total = parts.reduce((a, b) => a + b, 0)
  // iowait counts as idle for a "busy" reading; steal/guest stay in the busy side.
  const idle = parts[3] + (parts[4] ?? 0)
  return { idle, total }
}

export function cpuPercentBetween(
  before: { idle: number; total: number },
  after: { idle: number; total: number },
): number | null {
  const dTotal = after.total - before.total
  const dIdle = after.idle - before.idle
  if (dTotal <= 0 || dIdle < 0) return null
  return clampPercent(100 * (1 - dIdle / dTotal))
}

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, Math.round(n * 10) / 10))
}

// ── /proc/loadavg ───────────────────────────────────────────────────────────
export function parseLoadAvg(line: string): [number, number, number] | null {
  const parts = line.trim().split(/\s+/)
  if (parts.length < 3) return null
  const nums = parts.slice(0, 3).map(Number)
  if (nums.some((n) => !Number.isFinite(n))) return null
  return [nums[0], nums[1], nums[2]]
}

/** macOS `sysctl -n vm.loadavg` → `{ 0.42 0.38 0.31 }`. */
export function parseSysctlLoadAvg(line: string): [number, number, number] | null {
  const m = /\{([^}]*)\}/.exec(line)
  if (!m) return null
  return parseLoadAvg(m[1])
}

// ── /proc/meminfo ───────────────────────────────────────────────────────────
export function parseMeminfo(lines: string[]): {
  total: number
  used: number
  swapTotal: number
  swapUsed: number
} {
  const kv = new Map<string, number>()
  for (const line of lines) {
    const m = /^(\w+):\s+(\d+)\s*kB/.exec(line.trim())
    if (m) kv.set(m[1], Number(m[2]) * 1024)
  }
  const total = kv.get('MemTotal') ?? 0
  const free = kv.get('MemFree') ?? 0
  const buffers = kv.get('Buffers') ?? 0
  // Reclaimable slab counts as cache, otherwise every kernel is reported as ~90% full.
  const cached = (kv.get('Cached') ?? 0) + (kv.get('SReclaimable') ?? 0)
  const swapTotal = kv.get('SwapTotal') ?? 0
  return {
    total,
    used: Math.max(0, total - free - buffers - cached),
    swapTotal,
    swapUsed: Math.max(0, swapTotal - (kv.get('SwapFree') ?? 0)),
  }
}

/**
 * macOS has no /proc/meminfo: total comes from `hw.memsize`, used is reconstructed
 * from vm_stat page counts (active + wired + compressed, the same accounting
 * Activity Monitor shows as "Memory Used").
 */
export function parseDarwinMemory(
  memsizeLine: string,
  vmStatLines: string[],
): { total: number; used: number } {
  const total = num(memsizeLine) ?? 0
  let pageSize = 0
  for (const line of vmStatLines) {
    const m = /page size of (\d+) bytes/.exec(line)
    if (m) {
      pageSize = Number(m[1])
      break
    }
  }
  if (!pageSize || !total) return { total, used: 0 }
  const pages = (key: string): number => {
    for (const line of vmStatLines) {
      const m = new RegExp(`^${key}:\\s+(\\d+)`).exec(line.trim())
      if (m) return Number(m[1])
    }
    return 0
  }
  const used =
    (pages('Pages active') + pages('Pages wired down') + pages('Pages occupied by compressor')) *
    pageSize
  return { total, used: Math.max(0, Math.min(total, used)) }
}

// ── df -kP ──────────────────────────────────────────────────────────────────
const PSEUDO_FS = /^(tmpfs|devtmpfs|devfs|overlay|squashfs|proc|sysfs|none|udev|ramfs|autofs|cgroup2?|map|nsfs)$/

export function parseDf(lines: string[]): MonitorDisk[] {
  const out: MonitorDisk[] = []
  for (const line of lines) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 6) continue
    const [fs, blocks, used] = parts
    // Mount points with spaces come back split, so rejoin everything after %iused.
    const mount = parts.slice(5).join(' ')
    const total = num(blocks)
    const usedBytes = num(used)
    if (total == null || usedBytes == null || total <= 0) continue
    if (PSEUDO_FS.test(fs) && mount !== '/') continue
    out.push({ mount, fs, total: total * 1024, used: usedBytes * 1024 })
  }
  return out
}

// ── /proc/net/dev ───────────────────────────────────────────────────────────
export function parseProcNetDev(lines: string[]): { name: string; rxBytes: number; txBytes: number }[] {
  const out: { name: string; rxBytes: number; txBytes: number }[] = []
  for (const line of lines) {
    const m = /^\s*([^:]+):\s*(.+)$/.exec(line)
    if (!m) continue
    const parts = m[2].trim().split(/\s+/).map(Number)
    // rx: bytes packets errs drop fifo frame compressed multicast | tx: bytes ...
    if (parts.length < 16 || parts.some((n) => !Number.isFinite(n))) continue
    out.push({ name: m[1].trim(), rxBytes: parts[0], txBytes: parts[8] })
  }
  return out
}

/**
 * macOS `netstat -ibn`: Name Mtu Network [Address] Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll.
 * The Address column is omitted for rows like loopback, which shifts every index, so
 * the counters are read from the right where the layout is stable.
 */
export function parseNetstatIB(lines: string[]): { name: string; rxBytes: number; txBytes: number }[] {
  const byName = new Map<string, { name: string; rxBytes: number; txBytes: number }>()
  for (const line of lines) {
    const parts = line.trim().split(/\s+/)
    // name mtu network + the 7 counter columns
    if (parts.length < 10) continue
    const name = parts[0]
    const rxBytes = num(parts[parts.length - 5])
    const txBytes = num(parts[parts.length - 2])
    if (rxBytes == null || txBytes == null) continue
    // Multiple address rows per interface; the counters repeat, so take the max.
    const prev = byName.get(name)
    if (!prev || rxBytes > prev.rxBytes) byName.set(name, { name, rxBytes, txBytes })
  }
  return [...byName.values()]
}

export function ratesBetween(
  before: { name: string; rxBytes: number; txBytes: number }[],
  after: { name: string; rxBytes: number; txBytes: number }[],
  seconds: number,
): MonitorNetIface[] {
  const prev = new Map(before.map((i) => [i.name, i]))
  const out: MonitorNetIface[] = []
  for (const iface of after) {
    const start = prev.get(iface.name)
    const rx = start ? iface.rxBytes - start.rxBytes : 0
    const tx = start ? iface.txBytes - start.txBytes : 0
    // A counter reset (interface bounced) must not show up as a negative rate.
    const rxRate = start && rx >= 0 ? rx / seconds : 0
    const txRate = start && tx >= 0 ? tx / seconds : 0
    out.push({ name: iface.name, rxBytes: iface.rxBytes, txBytes: iface.txBytes, rxRate, txRate })
  }
  return out
}

/** Interface the throughput card should report: busiest non-loopback link. */
export function primaryIface(ifaces: MonitorNetIface[]): MonitorNetIface | null {
  const real = ifaces.filter((i) => !/^(lo|lo0|Loopback)/i.test(i.name))
  const pool = real.length ? real : ifaces
  if (!pool.length) return null
  return pool.reduce((best, i) =>
    i.rxBytes + i.txBytes > best.rxBytes + best.txBytes ? i : best,
  )
}

// ── ps ──────────────────────────────────────────────────────────────────────
export function parsePs(lines: string[], limit = 40): MonitorProcess[] {
  const out: MonitorProcess[] = []
  for (const line of lines) {
    const m = /^\s*(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\S+)\s+(.*)$/.exec(line)
    if (!m) continue
    const command = m[6].trim()
    if (!command) continue
    out.push({
      pid: Number(m[1]),
      user: m[2],
      cpu: Number(m[3]),
      mem: Number(m[4]),
      state: m[5],
      command,
    })
  }
  out.sort((a, b) => b.cpu - a.cpu || b.mem - a.mem)
  return out.slice(0, limit)
}

/** Fallback when /proc/stat is unavailable (macOS): sum of per-process CPU. */
export function cpuPercentFromPs(processes: MonitorProcess[]): number | null {
  if (!processes.length) return null
  return clampPercent(processes.reduce((sum, p) => sum + p.cpu, 0))
}

// ── uptime ──────────────────────────────────────────────────────────────────
export function parseDarwinBootSec(line: string): number | null {
  const m = /sec\s*=\s*(\d+)/.exec(line)
  return m ? Number(m[1]) : null
}

export function uptimeFromBootSec(bootSec: number | null, nowSec: number): number {
  if (bootSec == null) return 0
  return Math.max(0, Math.round(nowSec - bootSec))
}

// ── Windows (PowerShell emits JSON, so only shape validation is needed) ─────
export interface WindowsSnapshot {
  os?: string
  kernel?: string
  hostname?: string
  uptimeSec?: number
  cpuPercent?: number
  cpuCount?: number
  cpuModel?: string
  cpuMhz?: number
  memTotal?: number
  memUsed?: number
  swapTotal?: number
  swapUsed?: number
  disks?: { mount?: string; fs?: string; total?: number; used?: number }[]
  net?: { name?: string; rxBytes?: number; txBytes?: number }[]
  processes?: { pid?: number; user?: string; cpu?: number; mem?: number; state?: string; command?: string }[]
}

export function fromWindowsSnapshot(
  snap: WindowsSnapshot,
  previousNet: { name: string; rxBytes: number; txBytes: number }[],
  seconds: number,
  rttMs: number,
): MonitorSample {
  const disks: MonitorDisk[] = asArray(snap.disks)
    .map((d) => ({
      mount: String(d.mount ?? ''),
      fs: String(d.fs ?? ''),
      total: Number(d.total ?? 0),
      used: Number(d.used ?? 0),
    }))
    .filter((d) => d.mount && d.total > 0)

  const net = ratesBetween(
    previousNet,
    asArray(snap.net).map((n) => ({
      name: String(n.name ?? ''),
      rxBytes: Number(n.rxBytes ?? 0),
      txBytes: Number(n.txBytes ?? 0),
    })),
    seconds,
  )

  const processes: MonitorProcess[] = asArray(snap.processes)
    .map((p) => ({
      pid: Number(p.pid ?? 0),
      user: String(p.user ?? ''),
      cpu: Number(p.cpu ?? 0),
      mem: Number(p.mem ?? 0),
      state: String(p.state ?? ''),
      command: String(p.command ?? ''),
    }))
    .filter((p) => p.pid > 0 && p.command)

  return {
    os: String(snap.os ?? 'Windows'),
    kernel: String(snap.kernel ?? ''),
    hostname: String(snap.hostname ?? ''),
    uptimeSec: Number(snap.uptimeSec ?? 0),
    cpuPercent: clampPercent(Number(snap.cpuPercent ?? 0)),
    cpuCount: Number(snap.cpuCount ?? 0),
    cpuModel: String(snap.cpuModel ?? ''),
    cpuMhz: Number(snap.cpuMhz ?? 0),
    loadAvg: null,
    memTotal: Number(snap.memTotal ?? 0),
    memUsed: Number(snap.memUsed ?? 0),
    swapTotal: Number(snap.swapTotal ?? 0),
    swapUsed: Number(snap.swapUsed ?? 0),
    disks,
    net,
    processes: processes.sort((a, b) => b.cpu - a.cpu).slice(0, 40),
    rttMs,
    sampledAt: Date.now(),
  }
}

// ── POSIX section → sample ──────────────────────────────────────────────────
export function fromPosixSections(
  sections: { name: string; lines: string[] }[],
  seconds: number,
  rttMs: number,
): MonitorSample {
  const one = (name: string) => firstText(sectionOf(sections, name))
  const snap1 = sectionOf(sections, 'snap', 0)
  const snap2 = sectionOf(sections, 'snap', 1)

  const cpuLines = (snap: string[]) => snap.filter((l) => l.startsWith('cpu'))
  const netLines = (snap: string[]) => snap.filter((l) => !l.startsWith('cpu'))

  const statBefore = parseCpuStat(cpuLines(snap1)[0] ?? '')
  const statAfter = parseCpuStat(cpuLines(snap2)[0] ?? '')
  const processes = parsePs(sectionOf(sections, 'ps'))

  const netBefore = parseProcNetDev(netLines(snap1))
  const netAfter = parseProcNetDev(netLines(snap2))
  const net = netAfter.length
    ? ratesBetween(netBefore, netAfter, seconds)
    : ratesBetween(parseNetstatIB(netLines(snap1)), parseNetstatIB(netLines(snap2)), seconds)

  const meminfo = sectionOf(sections, 'mem')
  const isDarwinMem = sectionOf(sections, 'darmem').length > 0
  const darwinMem = isDarwinMem
    ? parseDarwinMemory(firstText(sectionOf(sections, 'darmem')), sectionOf(sections, 'vmstat'))
    : null
  const linuxMem = isDarwinMem ? null : parseMeminfo(meminfo)

  const cpuInfoLines = sectionOf(sections, 'cpuinfo')
  const cpuCount = num(cpuInfoLines[0]) ?? 0
  const cpuModel = (cpuInfoLines[1] ?? '').trim()

  const loadRaw = one('loadavg')
  const loadAvg =
    parseLoadAvg(loadRaw) ??
    parseSysctlLoadAvg(loadRaw) ??
    null

  const uptimeRaw = one('uptime')
  const uptimeSec = /^\d+(\.\d+)?$/.test(uptimeRaw)
    ? Math.round(Number(uptimeRaw))
    : uptimeFromBootSec(parseDarwinBootSec(uptimeRaw), Math.floor(Date.now() / 1000))

  const cpuPercent =
    statBefore && statAfter
      ? (cpuPercentBetween(statBefore, statAfter) ?? 0)
      : (cpuPercentFromPs(processes) ?? 0)

  const memTotal = darwinMem?.total ?? linuxMem?.total ?? 0
  const memUsed = darwinMem?.used ?? linuxMem?.used ?? 0

  return {
    os: one('os') || one('kernel') || 'Unix',
    kernel: one('kernel'),
    hostname: one('hostname'),
    uptimeSec,
    cpuPercent: clampPercent(cpuPercent),
    cpuCount,
    cpuModel,
    cpuMhz: num(one('cpumhz')) ?? 0,
    loadAvg,
    memTotal,
    memUsed,
    swapTotal: linuxMem?.swapTotal ?? 0,
    swapUsed: linuxMem?.swapUsed ?? 0,
    disks: parseDf(sectionOf(sections, 'disk')),
    net,
    processes,
    rttMs,
    sampledAt: Date.now(),
  }
}
