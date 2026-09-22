import React, { useEffect, useRef, useState } from 'react';
import {
  Folder,
  FileText,
  FileCode,
  FileJson,
  FileCog,
  FileArchive,
  Upload,
  Download,
  RefreshCw,
  Plus,
  Search,
  ArrowUp,
  Trash2,
  HardDrive,
  CheckCircle2,
  X,
  Edit3,
  Save,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  FolderOpen,
  MoreHorizontal
} from 'lucide-react';
import type { SFTPFile, SftpEntry, ThemeConfig, ConnectionHost, TransferItem } from '../types';
import { INITIAL_SFTP_FILES } from '../data/mockData';
import { useT } from '../i18n/context';
import { nativeConfirm, showContextMenu, type MenuItemSpec } from '../utils/desktop';

const IN_ELECTRON =
  typeof window !== 'undefined' && typeof window.ipcRenderer !== 'undefined';

/** Max parallel transfers dispatched from the queue. */
const MAX_CONCURRENT = 3;
/** Preview/read-back cap; the main process enforces the same limit. */
const PREVIEW_LIMIT = 2 * 1024 * 1024;
/** Extensions that never preview as text — offer download instead. */
const BINARY_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'pdf', 'zip', 'gz', 'tgz',
  'tar', 'bz2', 'xz', '7z', 'rar', 'bin', 'exe', 'dll', 'so', 'dylib', 'woff',
  'woff2', 'ttf', 'otf', 'mp3', 'mp4', 'mov', 'avi', 'sqlite', 'db', 'pyc',
]);

interface SFTPDrawerProps {
  theme: ThemeConfig;
  host: ConnectionHost;
  /** Browse the local machine's filesystem instead of an SSH host. */
  local?: boolean;
  mode?: 'docked' | 'full';
  onCloseDock?: () => void;
  onRunFileInTerminal?: (fileName: string) => void;
  className?: string;
  onNotify?: (message: string) => void;
  /** SSH keep-alive seconds for the pooled SFTP connection (0 disables). */
  keepaliveInterval?: number;
}

// ── Formatting helpers ───────────────────────────────────────────────────────
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = -1;
  do {
    v /= 1024;
    i++;
  } while (v >= 1024 && i < units.length - 1);
  return `${v.toFixed(1)} ${units[i]}`;
}

function formatMode(mode: number): string {
  const typeChar =
    (mode & 0o170000) === 0o040000 ? 'd' : (mode & 0o170000) === 0o120000 ? 'l' : '-';
  let str = typeChar;
  for (let i = 8; i >= 0; i--) {
    str += (mode >> i) & 1 ? 'rwx'[2 - (i % 3)] : '-';
  }
  return str;
}

function formatTime(mtime: number): string {
  const d = new Date(mtime);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const joinRemote = (dir: string, name: string) => `${dir.replace(/[/\\]+$/, '')}/${name}`;

/** Path segments with separators normalized to '/'. 'C:/Users' → ['C:','Users'] */
function pathParts(p: string): string[] {
  return p.replace(/\\/g, '/').split('/').filter(Boolean);
}

/** Rebuild a path from segments, keeping a Windows drive root ('C:/...'). */
function buildPath(parts: string[]): string {
  if (parts.length === 0) return '/';
  return /^[A-Za-z]:$/.test(parts[0]) ? parts.join('/') : '/' + parts.join('/');
}

/** Rebuild a directory path from segments, keeping a Windows drive root ('C:/'). */
function buildDir(parts: string[]): string {
  if (parts.length === 0) return '/';
  if (parts.length === 1 && /^[A-Za-z]:$/.test(parts[0])) return parts[0] + '/';
  return buildPath(parts);
}

/** Root means POSIX '/' or a drive root like 'C:/'. */
function isRootPath(p: string): boolean {
  const norm = p.replace(/\\/g, '/');
  return norm === '/' || /^[A-Za-z]:\/?$/.test(norm);
}

function parentPath(p: string): string {
  const parts = pathParts(p);
  if (parts.length === 0) return '/';
  if (parts.length === 1) return /^[A-Za-z]:$/.test(parts[0]) ? parts[0] + '/' : '/';
  return buildDir(parts.slice(0, -1));
}

const extOf = (name: string): string | undefined => {
  const parts = name.split('.');
  return parts.length > 1 ? parts.pop()?.toLowerCase() : undefined;
};

const compareEntries = (a: SFTPFile, b: SFTPFile): number => {
  if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
  return a.name.localeCompare(b.name);
};

export const SFTPDrawer: React.FC<SFTPDrawerProps> = ({
  theme,
  host,
  local = false,
  mode = 'docked',
  onCloseDock,
  onRunFileInTerminal,
  className,
  onNotify,
  keepaliveInterval = 0,
}) => {
  const t = useT()
  // ── Connection & listing state ──
  const [connState, setConnState] = useState<'idle' | 'connecting' | 'connected' | 'error'>(IN_ELECTRON ? 'idle' : 'connected');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [files, setFiles] = useState<SFTPFile[]>(IN_ELECTRON ? [] : INITIAL_SFTP_FILES);
  const [currentPath, setCurrentPath] = useState(IN_ELECTRON ? '/' : '/var/www/app');
  const [loading, setLoading] = useState(false);
  const [menuFileId, setMenuFileId] = useState<string | null>(null);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // ── Preview / editor ──
  const [previewFile, setPreviewFile] = useState<SFTPFile | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  // Close the row action menu on any click outside of it
  useEffect(() => {
    if (!menuFileId) return;
    const onDown = () => setMenuFileId(null);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuFileId]);
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState('');

  // ── Upload UI ──
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── New file / folder modal ──
  const [isNewFileModalOpen, setIsNewFileModalOpen] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [newFileType, setNewFileType] = useState<'file' | 'dir'>('file');

  // ── Transfer queue ──
  const [transfers, setTransfers] = useState<TransferItem[]>([]);
  const [speeds, setSpeeds] = useState<Record<string, number>>({});
  const [queueOpen, setQueueOpen] = useState(true);
  const [downloadDir, setDownloadDir] = useState<string | null>(null);
  const transfersRef = useRef(transfers);
  transfersRef.current = transfers;
  const speedTrackRef = useRef<Record<string, { ts: number; loaded: number }>>({});

  // ── Toast ──
  const [uploadToast, setUploadToast] = useState<string | null>(null);
  const [toastKind, setToastKind] = useState<'ok' | 'err'>('ok');
  const toastTimerRef = useRef<number | null>(null);
  const showToast = (msg: string, kind: 'ok' | 'err' = 'ok') => {
    setUploadToast(msg);
    setToastKind(kind);
    onNotify?.(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setUploadToast(null), 2500);
  };

  // A real target must exist before any filesystem IPC: either a selected
  // remote host, or the local machine (local shell tab). Otherwise show a
  // neutral placeholder instead of a connection error.
  const canBrowse = local || !IN_ELECTRON || Boolean(host?.host);
  const hasRemoteHost = canBrowse;

  const buildCfg = () => ({
    host: host.host,
    port: host.port,
    username: host.user,
    password: host.password,
    privateKeyPath: host.privateKeyPath,
    passphrase: host.passphrase,
    keepaliveInterval,
  });

  // ── Backend adapters: local filesystem (local tab) vs remote SFTP ──
  const fsHome = (): Promise<string> =>
    local
      ? (window.ipcRenderer.invoke('localfs:home') as Promise<string>)
      : (window.ipcRenderer.invoke('sftp:home', buildCfg()) as Promise<{ path: string }>).then((r) => r.path);
  const fsList = (p: string) =>
    local ? window.ipcRenderer.invoke('localfs:list', p) : window.ipcRenderer.invoke('sftp:list', buildCfg(), p);
  const fsMkdir = (p: string) =>
    local ? window.ipcRenderer.invoke('localfs:mkdir', p) : window.ipcRenderer.invoke('sftp:mkdir', buildCfg(), p);
  const fsTouch = (p: string) =>
    local ? window.ipcRenderer.invoke('localfs:touch', p) : window.ipcRenderer.invoke('sftp:touch', buildCfg(), p);
  const fsRemove = (p: string, isDir: boolean) =>
    local
      ? window.ipcRenderer.invoke('localfs:remove', p, isDir)
      : window.ipcRenderer.invoke('sftp:remove', buildCfg(), p, isDir);
  const fsRead = (p: string) =>
    local
      ? window.ipcRenderer.invoke('localfs:read-file', p)
      : window.ipcRenderer.invoke('sftp:read-file', buildCfg(), p);
  const fsWrite = (p: string, content: string) =>
    local
      ? window.ipcRenderer.invoke('localfs:write-file', p, content)
      : window.ipcRenderer.invoke('sftp:write-file', buildCfg(), p, content);

  const loadPath = async (path: string) => {
    if (!IN_ELECTRON) {
      // Web preview: keep the mock listing, just move the breadcrumb
      setCurrentPath(path);
      return;
    }
    if (!hasRemoteHost) {
      setConnState('idle');
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const entries = (await fsList(path)) as SftpEntry[];
      const mapped: SFTPFile[] = entries.map((e) => ({
        id: `f-${e.name}-${e.mtime}`,
        name: e.name,
        type: e.isDir ? 'dir' : 'file',
        sizeBytes: e.size,
        size: e.isDir ? '-' : formatBytes(e.size),
        permissions: formatMode(e.mode),
        owner: String(e.uid),
        group: String(e.gid),
        modified: formatTime(e.mtime),
        mtime: e.mtime,
        ext: e.isDir ? undefined : extOf(e.name),
        hidden: e.name.startsWith('.'),
      }));
      setCurrentPath(path);
      setFiles(mapped.sort(compareEntries));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const connect = async () => {
    if (!IN_ELECTRON) {
      setConnState('connected');
      return;
    }
    if (!hasRemoteHost) {
      setConnState('idle');
      setLoadError(null);
      return;
    }
    setConnState('connecting');
    setLoadError(null);
    try {
      const home = await fsHome();
      setConnState('connected');
      await loadPath(home);
    } catch (err) {
      setConnState('error');
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  };

  // Connect whenever the drawer mounts or the bound host changes.
  useEffect(() => {
    if (!hasRemoteHost) {
      setConnState('idle');
      setLoadError(null);
      return;
    }
    void connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host.id, hasRemoteHost, local]);

  // Default download destination = the OS downloads folder.
  useEffect(() => {
    if (!IN_ELECTRON) return;
    window.ipcRenderer
      .invoke('sftp:default-download-dir')
      .then((dir: string) => setDownloadDir(dir))
      .catch(() => {});
  }, []);

  // ── Transfer progress events from main ──
  useEffect(() => {
    if (!IN_ELECTRON) return;
    const unsubscribe = window.ipcRenderer.on('sftp:transfer', (...args) => {
      const p = args[0] as {
        transferId: string;
        direction: 'upload' | 'download';
        name: string;
        loaded: number;
        total: number;
        status: 'active' | 'done' | 'cancelled' | 'error';
        error?: string;
      };

      // Rolling bytes/s from consecutive progress samples.
      const track = speedTrackRef.current[p.transferId];
      const now = performance.now();
      if (track) {
        const dt = (now - track.ts) / 1000;
        if (dt > 0.2) {
          const bps = Math.max(0, (p.loaded - track.loaded) / dt);
          setSpeeds((prev) => ({ ...prev, [p.transferId]: bps }));
          speedTrackRef.current[p.transferId] = { ts: now, loaded: p.loaded };
        }
      } else {
        speedTrackRef.current[p.transferId] = { ts: now, loaded: p.loaded };
      }

      setTransfers((prev) =>
        prev.map((t) => {
          if (t.id !== p.transferId) return t;
          const next = { ...t, loaded: p.loaded, size: p.total || t.size };
          if (p.status === 'done') return { ...next, status: 'done' as const };
          if (p.status === 'cancelled') return { ...next, status: 'cancelled' as const };
          if (p.status === 'error') return { ...next, status: 'error' as const, error: p.error };
          return next;
        }),
      );
      if (p.status !== 'active') {
        delete speedTrackRef.current[p.transferId];
        setSpeeds((prev) => {
          const next = { ...prev };
          delete next[p.transferId];
          return next;
        });
      }
    });
    return unsubscribe;
  }, []);

  // ── Queue pump: keep up to MAX_CONCURRENT transfers in flight ──
  useEffect(() => {
    if (!IN_ELECTRON) return;
    const active = transfers.filter((t) => t.status === 'active').length;
    if (active >= MAX_CONCURRENT) return;
    const queued = transfers.filter((t) => t.status === 'queued').slice(0, MAX_CONCURRENT - active);
    queued.forEach((t) => {
      // Flip queued → active first so the effect never double-dispatches.
      setTransfers((prev) =>
        prev.map((x) => (x.id === t.id && x.status === 'queued' ? { ...x, status: 'active' } : x)),
      );
      const invoke = local
        ? window.ipcRenderer.invoke(
            'localfs:copy',
            t.direction === 'download' ? t.remotePath : t.localPath,
            t.direction === 'download' ? t.localPath : t.remotePath,
          )
        : t.direction === 'download'
          ? window.ipcRenderer.invoke('sftp:download', buildCfg(), t.remotePath, t.localPath, t.id)
          : window.ipcRenderer.invoke('sftp:upload', buildCfg(), t.localPath, t.remotePath, t.id);
      invoke
        .then(() => {
          // Cancel also resolves the invoke; only mark done if still active
          // (functional updates apply in event order, so a 'cancelled' event wins).
          setTransfers((prev) =>
            prev.map((x) => (x.id === t.id && x.status === 'active' ? { ...x, status: 'done' as const } : x)),
          );
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          setTransfers((prev) =>
            prev.map((x) =>
              x.id === t.id && x.status === 'active' ? { ...x, status: 'error' as const, error: msg } : x,
            ),
          );
        });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transfers]);

  const activeCount = transfers.filter((t) => t.status === 'active').length;
  const queuedCount = transfers.filter((t) => t.status === 'queued').length;
  const finishedCount = transfers.filter(
    (t) => t.status === 'done' || t.status === 'error' || t.status === 'cancelled',
  ).length;

  const enqueueUploads = (list: FileList | File[]) => {
    if (!IN_ELECTRON) { showToast(t('sftp.webUpload'), 'err'); return; }
    if (!hasRemoteHost) { showToast(t('sftp.noHostShort'), 'err'); return; }
    const items: TransferItem[] = Array.from(list)
      .map((f) => ({ path: window.ipcRenderer.getPathForFile(f), name: f.name }))
      .filter((f) => !!f.path)
      .map(({ path, name }) => ({
        id: `tr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        direction: 'upload' as const,
        name,
        remotePath: joinRemote(currentPath, name),
        localPath: path,
        size: 0,
        loaded: 0,
        status: 'queued' as const,
      }));
    if (items.length === 0) {
      showToast(t('sftp.webNoLocalPath'), 'err');
      return;
    }
    setTransfers((prev) => [...prev, ...items]);
    setQueueOpen(true);
    showToast(t('sftp.uploadQueued', { count: items.length }));
  };

  const handleDownloadFile = (file: SFTPFile) => {
    if (!IN_ELECTRON) { showToast(t('sftp.webDownload'), 'err'); return; }
    if (!downloadDir) {
      showToast(t('sftp.locatingDir'), 'err');
      return;
    }
    const item: TransferItem = {
      id: `tr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      direction: 'download',
      name: file.name,
      remotePath: joinRemote(currentPath, file.name),
      localPath: `${downloadDir.replace(/\/+$/, '')}/${file.name}`,
      size: file.sizeBytes ?? 0,
      loaded: 0,
      status: 'queued',
    };
    setTransfers((prev) => [...prev, item]);
    setQueueOpen(true);
    showToast(t('sftp.downloadQueued', { name: file.name }));
  };

  const cancelTransfer = (id: string) => {
    // Mark a queued item locally before it reaches the main-process transfer
    // map; the IPC call also covers the race where dispatch has just started.
    setTransfers((prev) =>
      prev.map((transfer) =>
        transfer.id === id && transfer.status === 'queued'
          ? { ...transfer, status: 'cancelled' as const }
          : transfer,
      ),
    );
    void window.ipcRenderer.invoke('sftp:cancel', id);
  };

  const clearFinishedTransfers = () => {
    setTransfers((prev) =>
      prev.filter((t) => t.status === 'queued' || t.status === 'active'),
    );
  };

  // ── File operations ──
  const handleCreateNewItem = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newFileName.trim();
    if (!name) return;
    try {
      if (newFileType === 'dir') {
        await fsMkdir(joinRemote(currentPath, name));
      } else {
        await fsTouch(joinRemote(currentPath, name));
      }
      setIsNewFileModalOpen(false);
      setNewFileName('');
      showToast(t('sftp.created', { kind: newFileType === 'dir' ? t('sftp.kindDir') : t('sftp.kindFile'), name }));
      void loadPath(currentPath);
    } catch (err) {
      showToast(t('sftp.createFailed', { error: err instanceof Error ? err.message : String(err) }), 'err');
    }
  };

  const handleDeleteFile = async (file: SFTPFile) => {
    if (!IN_ELECTRON) { showToast(t('sftp.webDelete'), 'err'); return; }
    const what = file.type === 'dir' ? t('sftp.kindDirFull') : t('sftp.kindFilePlain');
    if (!(await nativeConfirm({ message: t('sftp.deleteConfirm', { kind: what, name: file.name }), danger: true }))) return;
    try {
      await fsRemove(joinRemote(currentPath, file.name), file.type === 'dir');
      showToast(t('sftp.deleted', { name: file.name }));
      void loadPath(currentPath);
    } catch (err) {
      showToast(t('sftp.deleteFailed', { error: err instanceof Error ? err.message : String(err) }), 'err');
    }
  };

  const handleOpenPreview = async (file: SFTPFile, editMode = false) => {
    if (!IN_ELECTRON) { showToast(t('sftp.webEdit'), 'err'); return; }
    if ((file.sizeBytes ?? 0) > PREVIEW_LIMIT) {
      showToast('文件超过 2MB，不支持在线预览，请直接下载', 'err');
      return;
    }
    if (file.ext && BINARY_EXTS.has(file.ext)) {
      showToast('二进制文件不支持在线预览，请直接下载', 'err');
      return;
    }
    setPreviewFile(file);
    setIsEditing(editMode);
    setEditedContent('');
    setPreviewLoading(true);
    try {
      const result = (await fsRead(joinRemote(currentPath, file.name))) as { content: string };
      setEditedContent(result.content);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'err');
      setPreviewFile(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleSaveFileContent = async () => {
    if (!previewFile) return;
    try {
      await fsWrite(joinRemote(currentPath, previewFile.name), editedContent);
      setIsEditing(false);
      showToast(t('sftp.savedFile', { name: previewFile.name }));
      void loadPath(currentPath);
    } catch (err) {
      showToast(t('sftp.saveFailed', { error: err instanceof Error ? err.message : String(err) }), 'err');
    }
  };

  const pickDownloadDir = async () => {
    try {
      const dir = (await window.ipcRenderer.invoke('sftp:pick-download-dir')) as string | null;
      if (dir) {
        setDownloadDir(dir);
        showToast(t('sftp.downloadDir', { dir }));
      }
    } catch {
      // dialog unavailable — ignore
    }
  };

  const getFileIcon = (file: SFTPFile) => {
    if (file.type === 'dir') {
      return <Folder className="w-4 h-4 text-amber-400 fill-amber-400/20 shrink-0" />;
    }
    const ext = file.ext?.toLowerCase();
    if (ext === 'json') return <FileJson className="w-4 h-4 text-yellow-400 shrink-0" />;
    if (ext === 'yml' || ext === 'yaml' || ext === 'conf' || ext === 'env') return <FileCog className="w-4 h-4 text-emerald-400 shrink-0" />;
    if (ext === 'sh' || ext === 'ts' || ext === 'js' || ext === 'py') return <FileCode className="w-4 h-4 text-sky-400 shrink-0" />;
    if (ext === 'tar' || ext === 'gz' || ext === 'zip') return <FileArchive className="w-4 h-4 text-rose-400 shrink-0" />;
    return <FileText className="w-4 h-4 text-slate-400 shrink-0" />;
  };

  const filteredFiles = files.filter((f) =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const statusDot =
    connState === 'connected'
      ? theme.accentSuccess
      : connState === 'connecting'
        ? '#FBBF24'
        : connState === 'idle'
          ? theme.textMuted
          : '#FB7185';

  return (
    <div
      className={
        className
          ? className
          : `flex flex-col border-r h-full select-none transition-colors duration-150 relative ${
              mode === 'docked' ? 'w-[320px] shrink-0 z-20' : 'w-full flex-1'
            }`
      }
      style={{
        backgroundColor: theme.bgSurface,
        borderColor: theme.borderSubtle,
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (hasRemoteHost) setIsDragOver(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        setIsDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          enqueueUploads(e.dataTransfer.files);
        }
      }}
    >
      {/* Hidden native file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) enqueueUploads(e.target.files);
          e.target.value = '';
        }}
      />

      {/* Drag Over Overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-40 bg-sky-500/20 border-2 border-dashed border-sky-400 backdrop-blur-xs flex flex-col items-center justify-center p-4 text-center animate-in fade-in">
          <Upload className="w-10 h-10 text-sky-400 mb-2 animate-bounce" />
          <div className="text-sm font-semibold text-slate-100">{t('sftp.dropUpload')}</div>
          <div className="text-xs text-slate-300 mt-1">{t('sftp.dropUploadTo', { path: currentPath, concurrency: MAX_CONCURRENT })}</div>
        </div>
      )}

      {/* SFTP Header */}
      <div
        className="flex items-center justify-between h-10 px-3 border-b shrink-0"
        style={{
          backgroundColor: theme.bgBase,
          borderColor: theme.borderSubtle,
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold text-xs text-slate-200 shrink-0">SFTP</span>
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: statusDot }} />
          <span className="text-[11px] text-slate-500 font-mono truncate">
            {local ? t('sftp.localHost') : hasRemoteHost ? `${host.user}@${host.host}` : t('sftp.noHostShort')}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsNewFileModalOpen(true)}
            disabled={!hasRemoteHost}
            title={t('sftp.newEntry')}
            className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-white/10 transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => void loadPath(currentPath)}
            disabled={!hasRemoteHost}
            title={t('sftp.refreshDir')}
            className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-white/10 transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Connection error banner */}
      {connState === 'error' && (
        <div className="mx-2 mt-2 p-2 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs space-y-1.5">
          <div className="flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="break-all">{t('sftp.connectFailed')}: {loadError}</span>
          </div>
          <button
            onClick={() => void connect()}
            className="px-2.5 py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 font-medium transition-colors"
          >
            {t('sftp.retryConnect')}
          </button>
        </div>
      )}

      {/* Path Breadcrumb & Search */}
      {connState !== 'error' && connState !== 'idle' && (
        <div className="p-2 space-y-1.5 border-b shrink-0" style={{ borderColor: theme.borderSubtle }}>
          <div className="flex items-center gap-1">
            <button
              onClick={() => void loadPath(parentPath(currentPath))}
              disabled={isRootPath(currentPath)}
              title={t('sftp.parentDir')}
              className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-white/10 transition-colors disabled:opacity-30 disabled:hover:bg-transparent shrink-0"
            >
              <ArrowUp className="w-3.5 h-3.5" />
            </button>
            <div
              className="flex items-center gap-0.5 px-2 py-1 rounded text-[11px] font-mono border overflow-x-auto no-scrollbar flex-1 min-w-0"
              style={{
                backgroundColor: theme.bgInput,
                borderColor: theme.borderSubtle,
              }}
            >
              {(() => {
                const parts = pathParts(currentPath);
                const rootLabel = parts.length && /^[A-Za-z]:$/.test(parts[0]) ? parts[0] + '/' : '/';
                return (
                  <>
                    <button
                      onClick={() => void loadPath(rootLabel)}
                      className="hover:underline shrink-0"
                      style={{ color: theme.accentPrimary }}
                    >
                      {rootLabel}
                    </button>
                    {parts.map((seg, i) => {
                      // The drive segment is already rendered as the root button.
                      if (i === 0 && /^[A-Za-z]:$/.test(seg)) return null;
                      const target = buildPath(parts.slice(0, i + 1));
                      const isLast = i === parts.length - 1;
                      return (
                        <React.Fragment key={target}>
                          <button
                            onClick={() => void loadPath(target)}
                            className={`whitespace-nowrap hover:underline ${isLast ? 'font-semibold' : ''}`}
                            style={{ color: theme.accentPrimary }}
                          >
                            {seg}
                          </button>
                          {!isLast && <span style={{ color: theme.textSecondary }}>/</span>}
                        </React.Fragment>
                      );
                    })}
                  </>
                );
              })()}
            </div>
          </div>

          {/* Search */}
          <div
            className="flex items-center gap-1.5 px-2 py-1 rounded text-xs border"
            style={{
              backgroundColor: theme.bgInput,
              borderColor: theme.borderSubtle,
            }}
          >
            <Search className="w-3.5 h-3.5 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('sftp.searchPlaceholder')}
              className="w-full bg-transparent border-none outline-none text-xs text-slate-200 placeholder-slate-500"
            />
          </div>
        </div>
      )}

      {/* Toast Alert */}
      {uploadToast && (
        <div
          className={`mx-2 mt-2 p-2 rounded-lg text-xs flex items-center gap-1.5 animate-in fade-in border ${
            toastKind === 'ok'
              ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/15 border-rose-500/30 text-rose-300'
          }`}
        >
          {toastKind === 'ok' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          <span>{uploadToast}</span>
        </div>
      )}

      {/* File Tree List */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5 text-xs font-mono-term">
        {connState === 'idle' ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 px-4 text-center">
            <HardDrive className="w-9 h-9 text-slate-600" />
            <div className="text-xs text-slate-400">{t('sftp.noHostTitle')}</div>
            <div className="text-[11px] text-slate-600 leading-relaxed">{t('sftp.noHostHint')}</div>
          </div>
        ) : connState === 'connecting' || loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-xs">{connState === 'connecting' ? t('sftp.connectingSftp') : t('sftp.loadingDir')}</span>
          </div>
        ) : loadError ? (
          <div className="p-3 text-center text-rose-300/80 text-xs space-y-2">
            <div className="break-all">{t('sftp.listFailed')}: {loadError}</div>
            <button
              onClick={() => void loadPath(currentPath)}
              className="px-3 py-1 rounded bg-white/10 text-slate-200 hover:bg-white/20 transition-colors"
            >
              {t('common.retry')}
            </button>
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-400">
            {searchQuery ? t('sftp.noMatch') : t('sftp.empty')}
          </div>
        ) : (
          <>
            {!isRootPath(currentPath) && (
              <div
                onClick={() => void loadPath(parentPath(currentPath))}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors text-slate-500 hover:bg-white/5"
              >
                <FolderOpen className="w-4 h-4 shrink-0" />
                <span className="text-xs">..</span>
              </div>
            )}
            {filteredFiles.map((file) => {
              const isSelected = selectedFileId === file.id;
              const previewable =
                file.type === 'file' &&
                (file.sizeBytes ?? 0) <= PREVIEW_LIMIT &&
                !(file.ext && BINARY_EXTS.has(file.ext));

              return (
                <div
                  key={file.id}
                  onClick={() => setSelectedFileId(file.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSelectedFileId(file.id);
                    const items: MenuItemSpec[] = [];
                    if (previewable) items.push({ id: 'edit', label: t('sftp.editFile') });
                    if (file.type === 'file') items.push({ id: 'download', label: t('sftp.downloadFile') });
                    if (onRunFileInTerminal && file.ext === 'sh') items.push({ id: 'run', label: t('sftp.runInTerminal') });
                    if (file.name !== '..') {
                      if (items.length) items.push({ type: 'separator' });
                      items.push({ id: 'delete', label: t('sftp.deleteFile') });
                    }
                    showContextMenu(items, (id) => {
                      if (id === 'edit') void handleOpenPreview(file, true);
                      else if (id === 'download') handleDownloadFile(file);
                      else if (id === 'run') onRunFileInTerminal?.(`./${file.name}`);
                      else if (id === 'delete') void handleDeleteFile(file);
                    });
                  }}
                  onDoubleClick={() => {
                    if (file.type === 'dir') {
                      void loadPath(joinRemote(currentPath, file.name));
                    } else if (previewable) {
                      void handleOpenPreview(file);
                    } else {
                      handleDownloadFile(file);
                    }
                  }}
                  className="sftp-file-row group relative flex items-center justify-between px-2 py-1.5 rounded-lg cursor-pointer transition-colors border"
                  style={{
                    ...(isSelected ? { backgroundColor: theme.bgActive } : {}),
                    borderColor: isSelected ? theme.borderHover : 'transparent',
                    color: isSelected ? theme.textPrimary : theme.textSecondary,
                  }}
                >
                  <div className="flex items-center gap-2 truncate">
                    {getFileIcon(file)}
                    <span className={`truncate text-xs ${file.hidden ? 'opacity-60 italic' : ''}`}>
                      {file.name}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[10px] text-slate-500 font-sans">{file.size}</span>

                    {/* Hover: 更多 button; actions open in a dropdown */}
                    <div
                      className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center rounded-md px-1 py-0.5"
                      style={{ backgroundColor: theme.bgBase }}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() => setMenuFileId((prev) => (prev === file.id ? null : file.id))}
                        title={t('sftp.moreActions')}
                        className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-slate-200 transition-colors"
                      >
                        <MoreHorizontal className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {menuFileId === file.id && (
                      <div
                        className="absolute right-1 top-full mt-1 z-40 w-36 rounded-lg border py-1"
                        style={{ backgroundColor: theme.bgSurface, borderColor: theme.borderHover }}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {previewable && (
                          <button
                            onClick={() => {
                              void handleOpenPreview(file, true);
                              setMenuFileId(null);
                            }}
                            className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left text-slate-300 hover:bg-white/10 transition-colors"
                          >
                            <Edit3 className="w-3 h-3" />
                            <span>{t('sftp.editFile')}</span>
                          </button>
                        )}
                        {file.type === 'file' && (
                          <button
                            onClick={() => {
                              handleDownloadFile(file);
                              setMenuFileId(null);
                            }}
                            className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left text-slate-300 hover:bg-white/10 transition-colors"
                          >
                            <Download className="w-3 h-3" />
                            <span>{t('sftp.downloadFile')}</span>
                          </button>
                        )}
                        {onRunFileInTerminal && file.ext === 'sh' && (
                          <button
                            onClick={() => {
                              onRunFileInTerminal(`./${file.name}`);
                              setMenuFileId(null);
                            }}
                            className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left text-slate-300 hover:bg-white/10 transition-colors"
                          >
                            <FileCode className="w-3 h-3" />
                            <span>{t('sftp.runInTerminal')}</span>
                          </button>
                        )}
                        {file.name !== '..' && (
                          <button
                            onClick={() => {
                              void handleDeleteFile(file);
                              setMenuFileId(null);
                            }}
                            className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left text-rose-400 hover:bg-rose-500/20 transition-colors"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>{t('sftp.deleteFile')}</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Transfer Queue Panel */}
      {transfers.length > 0 && (
        <div className="border-t shrink-0" style={{ borderColor: theme.borderSubtle }}>
          <div
            className="flex items-center justify-between px-2.5 py-1.5 cursor-pointer hover:bg-white/5 transition-colors"
            onClick={() => setQueueOpen((v) => !v)}
          >
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-300">
              {queueOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
              <span>{t('sftp.transfers')}</span>
              <span className="text-slate-500 font-normal">
                {activeCount > 0 && <span className="text-sky-400">{t('sftp.inProgress', { count: activeCount })}</span>}
                {activeCount > 0 && queuedCount > 0 && ' · '}
                {queuedCount > 0 && <span>{t('sftp.queuedCount', { count: queuedCount })}</span>}
                {activeCount === 0 && queuedCount === 0 && t('sftp.records', { count: finishedCount })}
              </span>
            </div>
            {finishedCount > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  clearFinishedTransfers();
                }}
                title={t('sftp.clearFinished')}
                className="text-[10px] px-1.5 py-0.5 rounded text-slate-400 hover:text-slate-200 hover:bg-white/10 transition-colors"
              >
                {t('sftp.clearFinished')}
              </button>
            )}
          </div>

          {queueOpen && (
            <div className="px-2 pb-2 space-y-1 max-h-44 overflow-y-auto">
              {downloadDir && (
                <div
                  className="flex items-center justify-between px-2 py-1 rounded text-[10px] font-mono text-slate-500 border"
                  style={{ backgroundColor: theme.bgInput, borderColor: theme.borderSubtle }}
                >
                  <span className="truncate" title={downloadDir}>
                    {t('sftp.saveTo')}: {downloadDir}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void pickDownloadDir();
                    }}
                    className="shrink-0 ml-2 text-sky-400 hover:text-sky-300 hover:underline"
                  >
                    {t('sftp.change')}
                  </button>
                </div>
              )}
              {transfers.map((tr) => {
                const pct = tr.size > 0 ? Math.min(100, Math.round((tr.loaded / tr.size) * 100)) : 0;
                const speed = speeds[tr.id];
                const busy = tr.status === 'active' || tr.status === 'queued';
                return (
                  <div
                    key={tr.id}
                    className="flex items-center gap-2 px-2 py-1 rounded-lg border"
                    style={{ backgroundColor: theme.bgInput, borderColor: theme.borderSubtle }}
                  >
                    {tr.direction === 'upload' ? (
                      <Upload className="w-3 h-3 text-sky-400 shrink-0" />
                    ) : (
                      <Download className="w-3 h-3 text-emerald-400 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-slate-300 truncate font-mono">{tr.name}</span>
                        <span className="text-[10px] text-slate-500 shrink-0 font-sans">
                          {tr.status === 'done' && t('sftp.statusDone')}
                          {tr.status === 'cancelled' && t('sftp.statusCancelled')}
                          {tr.status === 'error' && (tr.error ? t('sftp.statusErrorWith', { error: tr.error }) : t('sftp.statusError'))}
                          {tr.status === 'queued' && t('sftp.statusQueued')}
                          {tr.status === 'active' &&
                            (tr.size > 0 ? `${pct}% · ${formatBytes(tr.loaded)}/${formatBytes(tr.size)}` : formatBytes(tr.loaded))}
                          {tr.status === 'active' && speed !== undefined && ` · ${formatBytes(speed)}/s`}
                        </span>
                      </div>
                      <div className="h-1 mt-1 rounded bg-black/40 overflow-hidden">
                        <div
                          className="h-full rounded transition-all"
                          style={{
                            width: `${tr.status === 'done' ? 100 : pct}%`,
                            backgroundColor:
                              tr.status === 'error'
                                ? '#FB7185'
                                : tr.status === 'cancelled'
                                  ? '#64748B'
                                  : tr.status === 'done'
                                    ? theme.accentSuccess
                                    : theme.accentPrimary,
                          }}
                        />
                      </div>
                    </div>
                    {busy ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          cancelTransfer(tr.id);
                        }}
                        title={t('terminal.zmodemCancel')}
                        className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-500/20 transition-colors shrink-0"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    ) : (
                      <span className="w-3 shrink-0">
                        {tr.status === 'done' && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                        {tr.status === 'error' && <AlertCircle className="w-3 h-3 text-rose-400" />}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Drag and Drop Zone Notice (only with a connected remote host) */}
      {connState === 'connected' && (
        <div
          onClick={() => fileInputRef.current?.click()}
          className="mx-3 my-2 h-[55px] px-2 flex flex-col items-center justify-center rounded-xl border border-dashed text-center cursor-pointer transition-all hover:border-sky-400/50 group shrink-0"
          style={{
            backgroundColor: theme.bgBase,
            borderColor: theme.borderSubtle,
          }}
        >
          <Upload className="w-3.5 h-3.5 mx-auto mb-0.5 text-slate-500 group-hover:text-sky-400 transition-colors" />
          <div className="text-[11px] font-medium text-slate-400 group-hover:text-slate-200">
            {t('sftp.uploadHint')}
          </div>
        </div>
      )}

      {/* New File / Folder Modal */}
      {isNewFileModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setIsNewFileModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-xl border p-4 text-slate-200 space-y-3"
            style={{
              backgroundColor: theme.bgSurface,
              borderColor: theme.borderHover,
            }}
          >
            <div className="flex items-center justify-between pb-2 border-b" style={{ borderColor: theme.borderSubtle }}>
              <span className="font-semibold text-xs">{t('sftp.newEntry')}</span>
              <button onClick={() => setIsNewFileModalOpen(false)} className="p-1 text-slate-400 hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setNewFileType('file')}
                className={`flex-1 py-1.5 rounded text-xs font-medium border transition-colors ${
                  newFileType === 'file'
                    ? 'bg-white/15 border-white/25 text-slate-100'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                新建文件
              </button>
              <button
                type="button"
                onClick={() => setNewFileType('dir')}
                className={`flex-1 py-1.5 rounded text-xs font-medium border transition-colors ${
                  newFileType === 'dir'
                    ? 'bg-white/15 border-white/25 text-slate-100'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                新建目录
              </button>
            </div>

            <form onSubmit={handleCreateNewItem} className="space-y-3">
              <input
                type="text"
                autoFocus
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                placeholder={newFileType === 'file' ? t('sftp.nameFileExample') : t('sftp.nameDirExample')}
                className="w-full px-3 py-2 rounded-lg border bg-black/30 text-xs text-slate-100 outline-none font-mono focus:border-sky-400"
                style={{ borderColor: theme.borderSubtle }}
              />

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsNewFileModalOpen(false)}
                  className="px-3 py-1.5 rounded text-xs text-slate-400 hover:text-slate-200"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={!newFileName.trim()}
                  className="px-3 py-1.5 rounded text-xs font-medium text-slate-950 transition-opacity hover:opacity-90 disabled:opacity-40"
                  style={{ backgroundColor: theme.accentPrimary }}
                >
                  {t('sftp.confirmCreate')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* File Preview & Code Editor Modal */}
      {previewFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-2xl border overflow-hidden"
            style={{
              backgroundColor: theme.bgSurface,
              borderColor: theme.borderHover,
            }}
          >
            {/* Modal Header */}
            <div
              className="flex items-center justify-between px-5 py-3 border-b"
              style={{
                backgroundColor: theme.bgBase,
                borderColor: theme.borderSubtle,
              }}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                {getFileIcon(previewFile)}
                <span className="font-semibold text-sm text-slate-200 font-mono truncate">
                  {previewFile.name}
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-white/5 text-slate-400 font-mono border border-white/10 shrink-0">
                  {previewFile.permissions} • {previewFile.size}
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setIsEditing(!isEditing)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors border ${
                    isEditing
                      ? 'bg-sky-500/20 border-sky-400/40 text-sky-300'
                      : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                  }`}
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>{isEditing ? t('sftp.previewMode') : t('sftp.editCode')}</span>
                </button>

                <button
                  onClick={() => handleDownloadFile(previewFile)}
                  className="p-1.5 rounded text-slate-400 hover:text-slate-100 hover:bg-white/10 transition-colors"
                  title={t('sftp.downloadFile')}
                >
                  <Download className="w-4 h-4" />
                </button>

                <button
                  onClick={() => setPreviewFile(null)}
                  className="p-1.5 rounded text-slate-400 hover:text-slate-100 hover:bg-white/10 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Modal Body / Editor */}
            <div className="p-4 overflow-y-auto font-mono text-xs text-slate-300 leading-relaxed bg-[#0b0d11] min-h-[300px] flex-1">
              {previewLoading ? (
                <div className="flex items-center justify-center gap-2 h-full text-slate-500">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{t('sftp.readingRemote')}</span>
                </div>
              ) : isEditing ? (
                <textarea
                  value={editedContent}
                  onChange={(e) => setEditedContent(e.target.value)}
                  className="w-full h-full min-h-[320px] bg-transparent border-none outline-none font-mono text-xs text-slate-100 resize-none leading-relaxed"
                  spellCheck={false}
                />
              ) : (
                <pre className="whitespace-pre-wrap">{editedContent}</pre>
              )}
            </div>

            {/* Modal Footer */}
            <div
              className="flex items-center justify-between px-5 py-2.5 border-t"
              style={{
                backgroundColor: theme.bgBase,
                borderColor: theme.borderSubtle,
              }}
            >
              <span className="text-[11px] text-slate-400 font-mono">
                UTF-8 • {previewFile.modified} • {isEditing ? t('sftp.liveEdit') : t('sftp.readOnly')}
              </span>

              <div className="flex items-center gap-2">
                {isEditing && !previewLoading && (
                  <button
                    onClick={() => void handleSaveFileContent()}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-slate-950 transition-opacity hover:opacity-90"
                    style={{ backgroundColor: theme.accentPrimary }}
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{t('sftp.saveChanges')}</span>
                  </button>
                )}
                {!isEditing && (
                  <button
                    onClick={() => setPreviewFile(null)}
                    className="px-3 py-1.5 rounded text-xs bg-white/10 text-slate-200 hover:bg-white/20 transition-colors"
                  >
                    {t('common.close')}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
