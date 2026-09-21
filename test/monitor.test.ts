import { describe, expect, it } from 'vitest'
import {
  cpuPercentBetween,
  cpuPercentFromPs,
  fromPosixSections,
  fromWindowsSnapshot,
  parseCpuStat,
  parseDarwinMemory,
  parseDf,
  parseLoadAvg,
  parseMeminfo,
  parseNetstatIB,
  parseProcNetDev,
  parsePs,
  parseSections,
  parseSysctlLoadAvg,
  primaryIface,
  ratesBetween,
} from '../electron/main/monitor-parse'

// ── /proc/stat ──────────────────────────────────────────────────────────────
describe('parseCpuStat', () => {
  it('parses a cpu line and treats iowait as idle', () => {
    // user nice system idle iowait
    expect(parseCpuStat('cpu  1000 0 500 8000 500 0 0 0 0 0')).toEqual({ idle: 8500, total: 10000 })
  })

  it('rejects malformed lines', () => {
    expect(parseCpuStat('cpu0 1 2 3 4')).toBeNull()
    expect(parseCpuStat('cpu  a b c d')).toBeNull()
    expect(parseCpuStat('intr 1 2 3')).toBeNull()
  })

  it('derives the busy percentage from two snapshots', () => {
    const before = parseCpuStat('cpu  1000 0 500 8000 500 0 0 0 0 0')!
    const after = parseCpuStat('cpu  1100 0 520 8800 520 0 0 0 0 0')!
    // 120 busy of 940 elapsed ticks
    expect(cpuPercentBetween(before, after)).toBe(12.8)
  })

  it('returns null instead of a bogus number when counters stall', () => {
    const stat = { idle: 1, total: 1 }
    expect(cpuPercentBetween(stat, stat)).toBeNull()
  })
})

describe('cpuPercentFromPs', () => {
  it('sums per-process cpu and clamps to 100', () => {
    expect(cpuPercentFromPs(parsePs(['  1 root 10.0 1.0 S a', '  2 root 20.5 1.0 R b']))).toBe(30.5)
    expect(cpuPercentFromPs([])).toBeNull()
  })
})

// ── load average ────────────────────────────────────────────────────────────
describe('load average', () => {
  it('reads /proc/loadavg', () => {
    expect(parseLoadAvg('0.42 0.38 0.31 1/234 5678')).toEqual([0.42, 0.38, 0.31])
  })

  it('reads the macOS sysctl form', () => {
    expect(parseSysctlLoadAvg('{ 0.42 0.38 0.31 }')).toEqual([0.42, 0.38, 0.31])
  })

  it('rejects garbage', () => {
    expect(parseLoadAvg('up 3 days')).toBeNull()
    expect(parseSysctlLoadAvg('not a load')).toBeNull()
  })
})

// ── memory ──────────────────────────────────────────────────────────────────
describe('parseMeminfo', () => {
  it('excludes buffers and reclaimable cache from "used"', () => {
    const mem = parseMeminfo([
      'MemTotal:       16384000 kB',
      'MemFree:         2048000 kB',
      'Buffers:          512000 kB',
      'Cached:          4096000 kB',
      'SReclaimable:     256000 kB',
      'SwapTotal:       2097152 kB',
      'SwapFree:        1048576 kB',
    ])
    expect(mem.total).toBe(16384000 * 1024)
    expect(mem.used).toBe(9472000 * 1024)
    expect(mem.swapTotal).toBe(2097152 * 1024)
    expect(mem.swapUsed).toBe(1048576 * 1024)
  })

  it('returns zeros for an empty section (macOS has no /proc/meminfo)', () => {
    expect(parseMeminfo([])).toEqual({ total: 0, used: 0, swapTotal: 0, swapUsed: 0 })
  })
})

describe('parseDarwinMemory', () => {
  it('reconstructs used memory from vm_stat page counts', () => {
    const mem = parseDarwinMemory('17179869184', [
      'Mach Virtual Memory Statistics: (page size of 16384 bytes)',
      'Pages free:                          100000.',
      'Pages active:                        200000.',
      'Pages wired down:                    100000.',
      'Pages occupied by compressor:         50000.',
    ])
    expect(mem.total).toBe(17179869184)
    expect(mem.used).toBe((200000 + 100000 + 50000) * 16384)
  })

  it('degrades to zero when the page size is missing', () => {
    expect(parseDarwinMemory('1024', ['Pages active: 5.'])).toEqual({ total: 1024, used: 0 })
  })
})

// ── disks ───────────────────────────────────────────────────────────────────
describe('parseDf', () => {
  it('keeps real filesystems and drops pseudo ones', () => {
    const disks = parseDf([
      'Filesystem     1024-blocks      Used Available Capacity Mounted on',
      '/dev/sda1         41943040  16777216  25165824      40% /',
      'tmpfs              8192000         0   8192000       0% /dev/shm',
      '/dev/sdb1        104857600  20971520  83886080      20% /data',
    ])
    expect(disks).toEqual([
      { mount: '/', fs: '/dev/sda1', total: 41943040 * 1024, used: 16777216 * 1024 },
      { mount: '/data', fs: '/dev/sdb1', total: 104857600 * 1024, used: 20971520 * 1024 },
    ])
  })

  it('keeps tmpfs when it is the root filesystem', () => {
    const disks = parseDf([
      'Filesystem 1024-blocks Used Available Capacity Mounted on',
      'tmpfs          1000  400       600      40% /',
    ])
    expect(disks).toHaveLength(1)
    expect(disks[0].mount).toBe('/')
  })

  it('rejoins mount points containing spaces', () => {
    const disks = parseDf([
      'Filesystem 1024-blocks Used Available Capacity Mounted on',
      '/dev/sdc1  1000  400  600  40% /mnt/my disk',
    ])
    expect(disks[0].mount).toBe('/mnt/my disk')
  })
})

// ── network ─────────────────────────────────────────────────────────────────
describe('parseProcNetDev', () => {
  it('reads rx/tx byte counters per interface', () => {
    const ifaces = parseProcNetDev([
      'Inter-|   Receive                                                |  Transmit',
      ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed',
      '    lo: 1000 10 0 0 0 0 0 0 1000 10 0 0 0 0 0 0',
      '  eth0: 5000000 100 0 0 0 0 0 0 2000000 90 0 0 0 0 0 0',
    ])
    expect(ifaces).toEqual([
      { name: 'lo', rxBytes: 1000, txBytes: 1000 },
      { name: 'eth0', rxBytes: 5000000, txBytes: 2000000 },
    ])
  })
})

describe('ratesBetween', () => {
  it('converts counter deltas into bytes per second', () => {
    const rates = ratesBetween(
      [{ name: 'eth0', rxBytes: 1000, txBytes: 2000 }],
      [{ name: 'eth0', rxBytes: 101000, txBytes: 52000 }],
      0.5,
    )
    expect(rates[0].rxRate).toBe(200000)
    expect(rates[0].txRate).toBe(100000)
  })

  it('reports zero rather than a negative rate after a counter reset', () => {
    const rates = ratesBetween(
      [{ name: 'eth0', rxBytes: 900000, txBytes: 900000 }],
      [{ name: 'eth0', rxBytes: 1000, txBytes: 2000 }],
      2,
    )
    expect(rates[0].rxRate).toBe(0)
    expect(rates[0].txRate).toBe(0)
  })
})

describe('parseNetstatIB (macOS)', () => {
  it('reads the busiest row per interface', () => {
    const ifaces = parseNetstatIB([
      'Name  Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll',
      'lo0   16384 <Link#1>                           100     0       1000       100     0       1000     0',
      'en0   1500  <Link#4>     aa:bb:cc:dd:ee:ff  50000     0   10485760     40000     0    5242880     0',
      'en0   1500  192.168.1.0   192.168.1.10       50000     0   10485760     40000     0    5242880     0',
    ])
    expect(ifaces).toHaveLength(2)
    expect(ifaces.find((i) => i.name === 'en0')).toEqual({
      name: 'en0',
      rxBytes: 10485760,
      txBytes: 5242880,
    })
  })
})

describe('primaryIface', () => {
  it('ignores loopback when a real interface exists', () => {
    const picked = primaryIface([
      { name: 'lo', rxBytes: 9e9, txBytes: 9e9, rxRate: 0, txRate: 0 },
      { name: 'eth0', rxBytes: 10, txBytes: 10, rxRate: 0, txRate: 0 },
    ])
    expect(picked?.name).toBe('eth0')
  })

  it('falls back to loopback when it is all there is', () => {
    expect(primaryIface([{ name: 'lo', rxBytes: 1, txBytes: 1, rxRate: 0, txRate: 0 }])?.name).toBe('lo')
    expect(primaryIface([])).toBeNull()
  })
})

// ── processes ───────────────────────────────────────────────────────────────
describe('parsePs', () => {
  it('skips the header, sorts by cpu and honours the limit', () => {
    const procs = parsePs(
      [
        '    PID USER      %CPU %MEM STAT COMMAND',
        '      1 root       0.0  0.1 Ss   /sbin/init',
        '   1420 deploy    14.2  3.8 Sl   node /var/www/app/server.js',
        '    842 root       8.4  1.1 S    nginx: worker process',
      ],
      2,
    )
    expect(procs.map((p) => p.pid)).toEqual([1420, 842])
    expect(procs[0]).toEqual({
      pid: 1420,
      user: 'deploy',
      cpu: 14.2,
      mem: 3.8,
      state: 'Sl',
      command: 'node /var/www/app/server.js',
    })
  })

  it('drops rows without a command', () => {
    expect(parsePs(['   1 root 0.0 0.1 S   '])).toHaveLength(0)
  })
})

// ── section plumbing ────────────────────────────────────────────────────────
describe('parseSections', () => {
  it('keeps repeated sections in order', () => {
    const sections = parseSections('@@a\n1\n@@snap\ncpu 1\n@@snap\ncpu 2\n')
    expect(sections.map((s) => s.name)).toEqual(['a', 'snap', 'snap'])
    expect(sections[2].lines).toEqual(['cpu 2'])
  })

  it('tolerates CRLF output', () => {
    expect(parseSections('@@a\r\nvalue\r\n')[0].lines).toEqual(['value'])
  })
})

// ── end-to-end POSIX assembly ───────────────────────────────────────────────
const POSIX_FIXTURE = [
  '@@os',
  'Ubuntu 24.04.1 LTS',
  '@@kernel',
  'Linux 6.8.0-45-generic',
  '@@hostname',
  'prod-api-cluster-01',
  '@@uptime',
  '3628800.42',
  '@@loadavg',
  '0.42 0.38 0.31 2/512 9012',
  '@@cpuinfo',
  '8',
  'AMD EPYC 7B13 64-Core Processor',
  '@@cpumhz',
  '2450.000',
  '@@mem',
  'MemTotal:       16384000 kB',
  'MemFree:         2048000 kB',
  'Buffers:          512000 kB',
  'Cached:          4096000 kB',
  'SReclaimable:     256000 kB',
  'SwapTotal:       2097152 kB',
  'SwapFree:        1048576 kB',
  '@@darmem',
  '@@vmstat',
  '@@disk',
  'Filesystem     1024-blocks      Used Available Capacity Mounted on',
  '/dev/sda1         41943040  16777216  25165824      40% /',
  'tmpfs              8192000         0   8192000       0% /dev/shm',
  '@@ps',
  '    PID USER      %CPU %MEM STAT COMMAND',
  '   1420 deploy    14.2  3.8 Sl   node /var/www/app/server.js',
  '    842 root       8.4  1.1 S    nginx: worker process',
  '@@snap',
  'cpu  1000 0 500 8000 500 0 0 0 0 0',
  '    lo: 1000 10 0 0 0 0 0 0 1000 10 0 0 0 0 0 0',
  '  eth0: 5000000 100 0 0 0 0 0 0 2000000 90 0 0 0 0 0 0',
  '@@snap',
  'cpu  1100 0 520 8800 520 0 0 0 0 0',
  '    lo: 2000 20 0 0 0 0 0 0 2000 20 0 0 0 0 0 0',
  '  eth0: 5100000 110 0 0 0 0 0 0 2050000 95 0 0 0 0 0 0',
].join('\n')

describe('fromPosixSections', () => {
  const sample = fromPosixSections(parseSections(POSIX_FIXTURE), 0.5, 12)

  it('collects host identity', () => {
    expect(sample.os).toBe('Ubuntu 24.04.1 LTS')
    expect(sample.kernel).toBe('Linux 6.8.0-45-generic')
    expect(sample.hostname).toBe('prod-api-cluster-01')
    expect(sample.uptimeSec).toBe(3628800)
    expect(sample.rttMs).toBe(12)
  })

  it('collects cpu facts', () => {
    expect(sample.cpuCount).toBe(8)
    expect(sample.cpuModel).toBe('AMD EPYC 7B13 64-Core Processor')
    expect(sample.cpuMhz).toBe(2450)
    expect(sample.cpuPercent).toBe(12.8)
    expect(sample.loadAvg).toEqual([0.42, 0.38, 0.31])
  })

  it('collects memory and disks', () => {
    expect(sample.memTotal).toBe(16384000 * 1024)
    expect(sample.memUsed).toBe(9472000 * 1024)
    expect(sample.disks).toHaveLength(1)
    expect(sample.disks[0].mount).toBe('/')
  })

  it('collects network rates from the two snapshots', () => {
    const eth0 = sample.net.find((i) => i.name === 'eth0')
    expect(eth0?.rxRate).toBe(200000)
    expect(eth0?.txRate).toBe(100000)
  })

  it('collects processes', () => {
    expect(sample.processes.map((p) => p.pid)).toEqual([1420, 842])
  })

  it('never throws on an empty payload', () => {
    const empty = fromPosixSections([], 0.5, 0)
    expect(empty.cpuPercent).toBe(0)
    expect(empty.disks).toEqual([])
    expect(empty.processes).toEqual([])
    expect(empty.net).toEqual([])
  })
})

// ── Windows payload ─────────────────────────────────────────────────────────
describe('fromWindowsSnapshot', () => {
  it('normalises a payload and computes network rates', () => {
    const sample = fromWindowsSnapshot(
      {
        os: 'Microsoft Windows 11 Pro',
        kernel: '10.0.22631',
        hostname: 'DEV-PC',
        uptimeSec: 7200,
        cpuPercent: 15,
        cpuCount: 6,
        cpuModel: 'Intel Core i5-9600K',
        cpuMhz: 3696,
        memTotal: 17179869184,
        memUsed: 8589934592,
        swapTotal: 2147483648,
        swapUsed: 1073741824,
        disks: [{ mount: 'C:', fs: 'NTFS', total: 499005296640, used: 412303036416 }],
        net: [{ name: 'Ethernet', rxBytes: 101000, txBytes: 52000 }],
        processes: [
          { pid: 4, user: 'SYSTEM', cpu: 0.8, mem: 0.1, state: '', command: 'System' },
          { pid: 11932, user: 'dev', cpu: 12, mem: 2.3, state: '', command: 'Code' },
        ],
      },
      [{ name: 'Ethernet', rxBytes: 1000, txBytes: 2000 }],
      0.5,
      8,
    )
    expect(sample.os).toBe('Microsoft Windows 11 Pro')
    expect(sample.cpuCount).toBe(6)
    expect(sample.loadAvg).toBeNull()
    expect(sample.disks).toHaveLength(1)
    expect(sample.net[0].rxRate).toBe(200000)
    expect(sample.net[0].txRate).toBe(100000)
    // Sorted by cpu desc, so the busier process leads.
    expect(sample.processes.map((p) => p.pid)).toEqual([11932, 4])
    expect(sample.rttMs).toBe(8)
  })

  it('accepts single-element arrays collapsed to scalars by ConvertTo-Json', () => {
    const sample = fromWindowsSnapshot(
      {
        disks: { mount: 'C:', fs: 'NTFS', total: 100, used: 40 },
        net: { name: 'Ethernet', rxBytes: 10, txBytes: 20 },
        processes: { pid: 7, user: 'dev', cpu: 1, mem: 2, state: '', command: 'svc' },
      },
      [],
      1,
      0,
    )
    expect(sample.disks).toHaveLength(1)
    expect(sample.net).toHaveLength(1)
    expect(sample.processes).toHaveLength(1)
  })

  it('drops junk entries instead of rendering broken rows', () => {
    const sample = fromWindowsSnapshot(
      {
        disks: [{ mount: '', total: 0 }, { mount: 'D:', fs: 'NTFS', total: 100, used: 1 }],
        processes: [{ pid: 0, command: '' }, { pid: 5, command: 'ok', cpu: 1, mem: 1, user: 'u', state: '' }],
      },
      [],
      1,
      0,
    )
    expect(sample.disks).toHaveLength(1)
    expect(sample.processes.map((p) => p.pid)).toEqual([5])
  })

  it('survives a completely empty payload', () => {
    const sample = fromWindowsSnapshot({}, [], 1, 0)
    expect(sample.disks).toEqual([])
    expect(sample.net).toEqual([])
    expect(sample.processes).toEqual([])
    expect(sample.cpuPercent).toBe(0)
  })
})
