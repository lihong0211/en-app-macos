// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
// 用 CommonJS 写：preload 脚本跑在独立沙箱里，不走项目 "type": "module" 的 ESM 解析

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  moveWindowBy: (dx, dy) => ipcRenderer.send('window-move-by', dx, dy)
})
