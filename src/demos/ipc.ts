
// ipcRenderer only exists under Electron (preload); guard so plain-browser dev also boots
window.ipcRenderer?.on('main-process-message', (_event, ...args) => {
  console.log('[Receive Main-process message]:', ...args)
})
