// Sampling scripts, kept separate from the electron plumbing so they can be
// imported (and executed) by plain node / vitest.

/** Seconds between the two snapshots inside one sampling run. */
export const SAMPLE_GAP_MS = 500

// ── POSIX sampling script ───────────────────────────────────────────────────
// Sections are marked so a single round trip carries every metric; the two `@@snap`
// blocks let CPU% and network rates be derived from a delta without keeping state
// on the remote side. Missing tools degrade to empty sections rather than failing.
export const POSIX_SCRIPT = [
  'LC_ALL=C; export LC_ALL',
  'emit() { printf "@@%s\\n" "$1"; }',
  'emit os',
  'if [ -r /etc/os-release ]; then ( . /etc/os-release 2>/dev/null; printf "%s\\n" "${PRETTY_NAME:-}" ); fi',
  'emit kernel',
  'uname -sr 2>/dev/null || true',
  'emit hostname',
  'uname -n 2>/dev/null || true',
  'emit uptime',
  'if [ -r /proc/uptime ]; then cut -d" " -f1 /proc/uptime; else sysctl -n kern.boottime 2>/dev/null || true; fi',
  'emit loadavg',
  'if [ -r /proc/loadavg ]; then cat /proc/loadavg; else sysctl -n vm.loadavg 2>/dev/null || uptime 2>/dev/null || true; fi',
  'emit cpuinfo',
  'if command -v nproc >/dev/null 2>&1; then nproc; else sysctl -n hw.ncpu 2>/dev/null || echo 0; fi',
  'if [ -r /proc/cpuinfo ]; then grep -m1 -i "model name" /proc/cpuinfo | cut -d: -f2- | sed "s/^[ \\t]*//"; else sysctl -n machdep.cpu.brand_string 2>/dev/null || true; fi',
  'emit cpumhz',
  'if [ -r /proc/cpuinfo ]; then grep -m1 -i "cpu MHz" /proc/cpuinfo | cut -d: -f2- | tr -d " "; fi',
  'emit mem',
  'if [ -r /proc/meminfo ]; then cat /proc/meminfo; fi',
  'emit darmem',
  'if [ ! -r /proc/meminfo ]; then sysctl -n hw.memsize 2>/dev/null || true; fi',
  'emit vmstat',
  'if [ ! -r /proc/meminfo ]; then vm_stat 2>/dev/null || true; fi',
  'emit disk',
  'df -kP 2>/dev/null || true',
  'emit ps',
  'ps -eo pid,user,pcpu,pmem,state,command 2>/dev/null | head -n 500 || true',
  'emit snap',
  'if [ -r /proc/stat ]; then grep "^cpu " /proc/stat; fi',
  'if [ -r /proc/net/dev ]; then cat /proc/net/dev; else netstat -ibn 2>/dev/null || true; fi',
  `sleep ${SAMPLE_GAP_MS / 1000}`,
  'emit snap',
  'if [ -r /proc/stat ]; then grep "^cpu " /proc/stat; fi',
  'if [ -r /proc/net/dev ]; then cat /proc/net/dev; else netstat -ibn 2>/dev/null || true; fi',
].join('\n')

// ── Windows sampling script ─────────────────────────────────────────────────
// Perf-formatted counters give CPU% and private working set in one pass; the
// marker keeps any stray provider chatter out of the JSON.
export const WINDOWS_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  '$osInfo = Get-CimInstance Win32_OperatingSystem',
  '$proc0 = Get-CimInstance Win32_Processor | Select-Object -First 1',
  '$cores = [int]$proc0.NumberOfLogicalProcessors',
  '$cpuTotal = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor | Where-Object { $_.Name -eq "_Total" } | Select-Object -First 1',
  '$memTotal = [double]$osInfo.TotalVisibleMemorySize * 1024',
  '$users = @{}',
  'Get-Process -IncludeUserName | ForEach-Object { $users[[int]$_.Id] = [string]$_.UserName }',
  '$perf = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $_.Name -ne "_Total" -and $_.Name -ne "Idle" }',
  // Guard the divisors as doubles up front: `[math]::Max(1, $double)` binds to the
  // Int32 overload and throws, which would silently drop every process row.
  '$cpuDivisor = [double]$cores; if ($cpuDivisor -lt 1) { $cpuDivisor = 1 }',
  '$memDivisor = [double]$memTotal; if ($memDivisor -lt 1) { $memDivisor = 1 }',
  '$procs = @($perf | ForEach-Object {',
  '  $ws = [double]$_.WorkingSetPrivate',
  '  [pscustomobject]@{',
  '    pid = [int]$_.IDProcess',
  '    user = [string]$users[[int]$_.IDProcess]',
  '    cpu = [math]::Round(([double]$_.PercentProcessorTime) / $cpuDivisor, 1)',
  '    mem = [math]::Round(($ws / $memDivisor) * 100, 1)',
  '    state = ""',
  '    command = [string]$_.Name',
  '  }',
  '})',
  '$disks = @(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object {',
  '  [pscustomobject]@{ mount = [string]$_.DeviceID; fs = [string]$_.FileSystem; total = [double]$_.Size; used = [double]($_.Size - $_.FreeSpace) }',
  '})',
  '$net = @(Get-NetAdapterStatistics | ForEach-Object {',
  '  [pscustomobject]@{ name = [string]$_.Name; rxBytes = [double]$_.ReceivedBytes; txBytes = [double]$_.SentBytes }',
  '})',
  '$uptime = [double]((Get-Date) - $osInfo.LastBootUpTime).TotalSeconds',
  '$payload = [pscustomobject]@{',
  '  os = [string]$osInfo.Caption',
  '  kernel = [string]$osInfo.Version',
  '  hostname = [string]$osInfo.CSName',
  '  uptimeSec = [math]::Round($uptime, 0)',
  '  cpuPercent = [double]$cpuTotal.PercentProcessorTime',
  '  cpuCount = $cores',
  '  cpuModel = [string]$proc0.Name',
  '  cpuMhz = [double]$proc0.MaxClockSpeed',
  '  memTotal = $memTotal',
  '  memUsed = $memTotal - ([double]$osInfo.FreePhysicalMemory * 1024)',
  '  swapTotal = [double]$osInfo.TotalVirtualMemorySize * 1024 - $memTotal',
  '  swapUsed = [double]$osInfo.TotalVirtualMemorySize * 1024 - $memTotal - (([double]$osInfo.FreeVirtualMemory * 1024) - ([double]$osInfo.FreePhysicalMemory * 1024))',
  '  disks = $disks',
  '  net = $net',
  '  processes = $procs',
  '}',
  'Write-Output "@@json"',
  'Write-Output ($payload | ConvertTo-Json -Depth 4 -Compress)',
].join('\n')

/** Marker separating the JSON payload from any provider chatter on stdout. */
export const WINDOWS_JSON_MARKER = '@@json'
