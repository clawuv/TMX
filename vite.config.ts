import { rmSync, mkdirSync, copyFileSync, chmodSync } from 'node:fs'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { electronSimple } from 'vite-plugin-electron/multi-env'
import { notBundle } from 'vite-plugin-electron/plugin'
import pkg from './package.json'

const external = Object.keys(
  'dependencies' in pkg ? (pkg.dependencies as Record<string, string>) : {},
)

// The MCP stdio bridge is a zero-dependency plain .mjs — just copy it verbatim
// so external Node runtimes (spawned by AI tools) can execute it directly.
function copyMcpServer(): Plugin {
  return {
    name: 'copy-mcp-server',
    closeBundle() {
      mkdirSync('dist-electron/mcp', { recursive: true })
      copyFileSync('electron/mcp/server.mjs', 'dist-electron/mcp/server.mjs')
      // Executable + shebang so AI tools can also spawn the script directly
      // (command = the script path) without a separate `node` binary in PATH.
      chmodSync('dist-electron/mcp/server.mjs', 0o755)
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
  rmSync('dist-electron', { recursive: true, force: true })

  const isServe = command === 'serve'
  const isBuild = command === 'build'
  const sourcemap = isServe || !!process.env.VSCODE_DEBUG

  return {
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    resolve: {
      alias: {
        '@': path.join(__dirname, 'src'),
      },
    },
    plugins: [
      react(),
      tailwindcss(),
      copyMcpServer(),
      electronSimple({
        main: {
          input: 'electron/main/index.ts',
          plugins: [notBundle()],
          options: {
            build: {
              sourcemap,
              minify: isBuild,
              outDir: 'dist-electron/main',
              rolldownOptions: {
                external,
              },
            },
          },
        },
        preload: {
          input: 'electron/preload/index.ts',
          plugins: [notBundle()],
          options: {
            build: {
              sourcemap: sourcemap ? 'inline' : undefined, // #332
              minify: isBuild,
              outDir: 'dist-electron/preload',
              rolldownOptions: {
                external,
              },
            },
          },
        },
        // Polyfill the Electron and Node.js API for Renderer process.
        // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
        // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
        // renderer: {},
      }),
    ],
    clearScreen: false,
  }
})
