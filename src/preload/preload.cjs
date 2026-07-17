// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
// 用 CommonJS 写：preload 脚本跑在独立沙箱里，不走项目 "type": "module" 的 ESM 解析

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  moveWindowBy: (dx, dy) => ipcRenderer.send('window-move-by', dx, dy),

  getToken: () => ipcRenderer.invoke('auth:get-token'),
  setToken: (token) => ipcRenderer.invoke('auth:set-token', token),
  clearToken: () => ipcRenderer.invoke('auth:clear-token'),
  wechatLogin: () => ipcRenderer.invoke('auth:wechat-login'),
  completeLogin: () => ipcRenderer.invoke('auth:login-success'),
  sessionExpired: () => ipcRenderer.invoke('auth:session-expired'),

  // 播放控制（状态在主进程，主界面/悬浮条共用）
  startPlayback: (payload) => ipcRenderer.invoke('playback:start', payload),
  playbackNext: () => ipcRenderer.send('playback:next'),
  playbackPrev: () => ipcRenderer.send('playback:prev'),
  setPlaying: (playing) => ipcRenderer.send('playback:set-playing', playing),
  setMode: (mode) => ipcRenderer.send('playback:set-mode', mode),
  setAudio: (enabled) => ipcRenderer.send('playback:set-audio', enabled),
  onPlayAudio: (callback) => {
    const listener = (event, word) => callback(word)
    ipcRenderer.on('playback:play-audio', listener)
    return () => ipcRenderer.removeListener('playback:play-audio', listener)
  },
  getPlaybackState: () => ipcRenderer.invoke('playback:get-state'),
  onPlaybackState: (callback) => {
    const listener = (event, state) => callback(state)
    ipcRenderer.on('playback:state', listener)
    return () => ipcRenderer.removeListener('playback:state', listener)
  },
  toggleBar: () => ipcRenderer.invoke('bar:toggle'),

  // 划词弹窗收藏：由主进程发请求（data: 页面直连后端会被 CORS 拦）
  collectWord: (wordData) => ipcRenderer.invoke('words:collect', wordData),
  onWordCollected: (callback) => {
    const listener = (event, word) => callback(word)
    ipcRenderer.on('words:collected', listener)
    return () => ipcRenderer.removeListener('words:collected', listener)
  }
})
