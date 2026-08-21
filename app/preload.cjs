/**
 * The only surface the UI gets. Everything here mirrors what the After Effects panel can do
 * through CEP, so `src/ae/cep.ts` can serve both without the React code knowing which it is.
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('wallmaker', {
  desktop: true,
  // --- filesystem, synchronous to match CEP's API shape ---
  readdir: (p) => ipcRenderer.sendSync('fs:readdir', p),
  stat: (p) => ipcRenderer.sendSync('fs:stat', p),
  writeText: (p, t) => ipcRenderer.sendSync('fs:write', p, t),
  mkdirp: (p) => ipcRenderer.sendSync('fs:mkdirp', p),
  systemPath: (k) => ipcRenderer.sendSync('sys:path', k),
  // --- dialogs ---
  pickFolder: (title, initial) => ipcRenderer.sendSync('pick:folder', title, initial),
  pickFiles: (title, initial, exts) => ipcRenderer.sendSync('pick:files', title, initial, exts),
  reveal: (p) => ipcRenderer.send('shell:reveal', p),
  // --- After Effects, over AppleScript ---
  aeAvailable: () => ipcRenderer.invoke('ae:available'),
  evalScript: (code) => ipcRenderer.invoke('ae:eval', code),
  // --- the tile bake ---
  renderTiles: (cfg, outDir, opts) => ipcRenderer.invoke('tiles:render', cfg, outDir, opts),
  cancelTiles: () => ipcRenderer.invoke('tiles:cancel'),
  onTileProgress: (fn) => {
    const h = (_e, p) => fn(p)
    ipcRenderer.on('tiles:progress', h)
    return () => ipcRenderer.removeListener('tiles:progress', h)
  },
  probeTools: () => ipcRenderer.invoke('tools:probe'),
})
