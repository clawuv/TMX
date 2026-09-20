import type { TerminalLine, ConnectionHost } from '../types';
export function simulateCommandOutput(
  cmd: string,
  host: ConnectionHost,
  onOpenPalette?: () => void
): TerminalLine[] {
  const trimmed = cmd.trim();
  const id = () => Math.random().toString(36).substring(2, 9);
  const now = new Date().toLocaleTimeString();

  if (!trimmed) {
    return [];
  }

  const parts = trimmed.split(' ');
  const mainCommand = parts[0].toLowerCase();

  switch (mainCommand) {
    case 'help':
      return [
        {
          id: id(),
          type: 'output',
          content: `TMX SSH 交互式模拟环境支持的命令:
  • fastfetch / neofetch : 显示系统配置、内核、硬件与终端信息
  • htop                 : 实时终端多核进程与内存监视器
  • docker ps            : 列出当前正在运行的容器
  • ls [-la]             : 列出当前工作目录文件
  • cat <filename>       : 查看文件内容 (如 cat package.json, cat nginx.conf)
  • git status           : 查看当前仓库变更与分支状态
  • ping <host>          : 测试网络往返延迟
  • df -h                : 查看挂载卷磁盘配额
  • uptime               : 查看机器运行时间与平均负载
  • palette              : 🎨 打开专属极简配色方案与设计规范看板
  • ai <自然语言问题>     : 启动终端智能副驾生成命令或解答问题
  • clear                : 清空终端输出缓冲区 (快捷键 Ctrl+L)`
        }
      ];

    case 'fastfetch':
    case 'neofetch':
      return [
        {
          id: id(),
          type: 'output',
          content: `       _,met$$$$$gg.          ${host.user}@${host.name}
    ,g$$$$$$$$$$$$$$$P.       ------------------------------------
  ,g$$P"        """Y$$.".     OS: Ubuntu 24.04.1 LTS x86_64
 ,$$P'              \`$$$.     Host: KVM Cloud Compute Instance
',$$P       ,ggs.     \`$$b:   Kernel: Linux 6.8.0-45-generic
\`d$$'     ,$P"'   .    $$$    Uptime: 42 days, 7 hours, 18 mins
 $$P      d$'     ,    $$P    Packages: 942 (dpkg), 8 (snap)
 $$:      $$.   -    ,d$$'    Shell: zsh 5.9 (x86_64-ubuntu-linux-gnu)
 $$\;      Y$b._   _,d$P'     Terminal: TMX-v2.4.0 (Mica/Glass)
 Y$$.    \`.\`"Y$$$$P"'         CPU: AMD EPYC 7763 (8) @ 2.445GHz
 \`$$b      "-.__              GPU: NVIDIA A10G Tensor Core 24GB
  \`Y$$                        Memory: 5382MiB / 16048MiB (33%)
   \`$$b.                      Disk (/): 45G / 120G (38%)
     \`Y$$b.                   Latency: ${host.pingMs}ms [Direct WireGuard]`
        }
      ];

    case 'docker':
      if (parts[1] === 'ps' || parts[1] === 'container') {
        return [
          {
            id: id(),
            type: 'output',
            content: `CONTAINER ID   IMAGE                 COMMAND                  CREATED         STATUS         PORTS                    NAMES
a8f9c2d10e34   nginx:alpine          "/docker-entrypoint.…"   4 days ago      Up 4 days      0.0.0.0:80->80/tcp       prod-gateway
5b31e847c9aa   node:20-alpine        "docker-entrypoint.s…"   4 days ago      Up 4 days      0.0.0.0:3000->3000/tcp   api-service
9d44a1078f21   postgres:16-alpine    "docker-entrypoint.s…"   2 weeks ago     Up 2 weeks     0.0.0.0:5432->5432/tcp   postgres-primary
11e4f9b8c002   redis:7-alpine        "docker-entrypoint.s…"   2 weeks ago     Up 2 weeks     0.0.0.0:6379->6379/tcp   redis-cache`
          }
        ];
      }
      return [
        {
          id: id(),
          type: 'output',
          content: `Docker version 27.2.0, build 3ab4256. Use 'docker ps' to inspect running services.`
        }
      ];

    case 'htop':
    case 'top':
      return [
        {
          id: id(),
          type: 'output',
          content: `  1  [||||||||||||||                24.5%]   Tasks: 78, 122 thr; 1 running
  2  [||||||||||                    18.2%]   Load average: 0.42 0.38 0.31
  3  [||||||||||||||||||||          34.0%]   Uptime: 42 days, 07:18:22
  4  [||||||                        11.8%]
  Mem[||||||||||||||||||||   5.25G/15.7G]
  Swp[||                      256M/4.00G]

  PID USER      PRI  NI  VIRT   RES   SHR S CPU% MEM%   TIME+  Command
 1420 deploy     20   0 1482M  480M  120M S 14.2  3.0 12:45.10 node server.js
  842 root       20   0  980M  140M   45M S  8.4  0.9  4:20.15 /usr/sbin/nginx -g daemon off;
 2110 postgres   20   0 3200M  890M  310M S  4.1  5.6 48:19.82 postgres: writer process
  105 root       20   0  120M   18M   12M S  0.5  0.1  0:12.44 /usr/lib/systemd/systemd-journald`
        }
      ];

    case 'git':
      if (parts[1] === 'status') {
        return [
          {
            id: id(),
            type: 'output',
            content: `On branch main
Your branch is up to date with 'origin/main'.

Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
  (use "git restore <file>..." to discard changes in working directory)
	modified:   config/production.env
	modified:   src/server.ts

Untracked files:
  (use "git add <file>..." to include in what will be committed)
	deploy/migration-2026.sql

no changes added to commit (use "git add" to track)`
          }
        ];
      }
      return [
        {
          id: id(),
          type: 'output',
          content: `git version 2.43.0. Try 'git status' or 'git log --oneline -5'`
        }
      ];

    case 'ls':
      return [
        {
          id: id(),
          type: 'output',
          content: `total 48
drwxr-xr-x 6 deploy deploy 4096 Sep 16 05:40 app
drwxr-xr-x 2 deploy deploy 4096 Sep 14 09:30 config
-rwxr-xr-x 1 deploy deploy 4120 Sep 10 16:18 deploy.sh
-rw-r--r-- 1 deploy deploy 3280 Sep 15 18:22 docker-compose.yml
drwxr-xr-x 2 deploy deploy 4096 Sep 16 05:40 logs
-rw-r--r-- 1 root   root   1840 Sep 12 11:05 nginx.conf
-rw-r--r-- 1 deploy deploy 2450 Sep 16 03:55 package.json
-rw-r--r-- 1 deploy deploy  890 Sep 15 20:45 .env.production`
        }
      ];

    case 'cat':
      const target = parts[1] || '';
      if (target.includes('package.json')) {
        return [
          {
            id: id(),
            type: 'output',
            content: `{\n  "name": "core-api-gateway",\n  "version": "2.4.0",\n  "main": "dist/server.js",\n  "dependencies": {\n    "fastify": "^4.26.0",\n    "ioredis": "^5.3.2",\n    "pg": "^8.11.3"\n  }\n}`
          }
        ];
      }
      if (target.includes('nginx.conf')) {
        return [
          {
            id: id(),
            type: 'output',
            content: `server {\n    listen 80;\n    server_name api.infra.internal;\n    location / {\n        proxy_pass http://127.0.0.1:3000;\n        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n    }\n}`
          }
        ];
      }
      return [
        {
          id: id(),
          type: 'output',
          content: `# File: ${target || 'sample.txt'}\nDEPLOY_ENV=production\nPORT=3000\nCLUSTER_NODE_ID=${host.name}`
        }
      ];

    case 'ping':
      return [
        {
          id: id(),
          type: 'output',
          content: `PING ${parts[1] || '8.8.8.8'} (8.8.8.8) 56(84) bytes of data.
64 bytes from 8.8.8.8: icmp_seq=1 ttl=118 time=17.8 ms
64 bytes from 8.8.8.8: icmp_seq=2 ttl=118 time=18.2 ms
64 bytes from 8.8.8.8: icmp_seq=3 ttl=118 time=17.9 ms
--- 8.8.8.8 ping statistics ---
3 packets transmitted, 3 received, 0% packet loss, time 2003ms
rtt min/avg/max/mdev = 17.8/18.0/18.2/0.2 ms`
        }
      ];

    case 'df':
      return [
        {
          id: id(),
          type: 'output',
          content: `Filesystem     1K-blocks      Used Available Use% Mounted on
/dev/root      121946112  46382104  70211568  40% /
tmpfs            8024064      1240   8022824   1% /dev/shm
/dev/nvme0n1p1    523248      6180    517068   2% /boot/efi
/dev/sdb1      515949568 184201984 305547584  38% /data/storage`
        }
      ];

    case 'uptime':
      return [
        {
          id: id(),
          type: 'output',
          content: ` 05:52:14 up 42 days,  7:18,  2 users,  load average: 0.42, 0.38, 0.31`
        }
      ];

    case 'palette':
    case 'theme':
      if (onOpenPalette) {
        onOpenPalette();
      }
      return [
        {
          id: id(),
          type: 'system',
          content: `已为你唤起【极简现代设计规范与配色方案看板】！你可以在弹出面板中实时查看对比度指标与 ANSI 16 色调色板。`
        }
      ];

    case 'ai':
      const prompt = parts.slice(1).join(' ');
      return [
        {
          id: id(),
          type: 'ai',
          content: `针对你的需求：「${prompt || '排查当前服务器负载'}」
诊断结论：
1. 当前系统 Load 0.42 (8 核 CPU)，负载极低处于健康区间；
2. 建议执行以下推荐命令进一步核查高频写入：
   👉 iotop -oP -d 2 (查看真实磁盘 IO 消耗)
   👉 ss -s (查看当前 TCP Socket 活跃连接数)`
        }
      ];

    default:
      return [
        {
          id: id(),
          type: 'output',
          content: `zsh: command executed: ${cmd} (exit code 0). 输入 'help' 查看支持的交互命令。`
        }
      ];
  }
}
