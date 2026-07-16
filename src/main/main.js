import { spawn, execFile } from 'child_process'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { app, BrowserWindow, clipboard, screen, globalShortcut, ipcMain } from 'electron'

const __dirname = dirname(fileURLToPath(import.meta.url))

// 微信开放平台"网站应用"配置：AppID 不是密钥，可以放在客户端；
// 打包前把 WECHAT_APP_ID 和 WECHAT_REDIRECT_URI 换成真实值
// （WECHAT_REDIRECT_URI 要跟微信开放平台后台配置的"授权回调域"匹配的一个具体路径）
const WECHAT_APP_ID = 'REPLACE_WITH_YOUR_WECHAT_APP_ID'
const WECHAT_REDIRECT_URI = 'https://REPLACE_WITH_YOUR_DOMAIN/auth/wechat/callback'

const API_BASE_URL =
  process.env.NODE_ENV === 'development'
    ? 'http://127.0.0.1:8000'
    : 'https://REPLACE_WITH_YOUR_DOMAIN'

let pythonProcess = null
let mainWindow = null
let vueDevServer = null
let popupWindow = null
let popupCloseTimer = null
let isCapturing = false
let loginWindow = null

function getAuthFilePath() {
  return join(app.getPath('userData'), 'auth.json')
}

function getStoredToken() {
  const filePath = getAuthFilePath()
  if (!existsSync(filePath)) return null
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8'))
    return data.token || null
  } catch {
    return null
  }
}

function setStoredToken(token) {
  writeFileSync(getAuthFilePath(), JSON.stringify({ token }), 'utf-8')
}

function clearStoredToken() {
  setStoredToken(null)
}

async function checkStoredAuth() {
  const token = getStoredToken()
  if (!token) return false

  try {
    const res = await fetch(`${API_BASE_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    const data = await res.json()
    return data.code === 200
  } catch {
    return false
  }
}

function createLoginWindow() {
  loginWindow = new BrowserWindow({
    width: 420,
    height: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, '../preload/preload.cjs')
    }
  })

  loginWindow.on('closed', () => {
    loginWindow = null
  })

  const isDev = process.env.NODE_ENV === 'development'
  if (isDev) {
    loginWindow.loadURL('http://localhost:8081?view=login')
  } else {
    loginWindow.loadFile(join(__dirname, '../renderer/index.html'), { query: { view: 'login' } })
  }
}

// 微信扫码登录：弹一个子窗口加载微信官方授权页，用户扫码后微信会把这个
// 窗口导航到 WECHAT_REDIRECT_URI，主进程拦截这个导航拿到 code，不等页面
// 真正加载完就关窗口（用户体验上是扫完码窗口应声消失）
function loginWithWechat() {
  return new Promise((resolve, reject) => {
    const state = Math.random().toString(36).slice(2)
    const authUrl =
      `https://open.weixin.qq.com/connect/qrconnect?appid=${WECHAT_APP_ID}` +
      `&redirect_uri=${encodeURIComponent(WECHAT_REDIRECT_URI)}` +
      `&response_type=code&scope=snsapi_login&state=${state}#wechat_redirect`

    const wechatWindow = new BrowserWindow({
      width: 400,
      height: 550,
      webPreferences: { contextIsolation: true }
    })

    let settled = false

    const handleUrl = (url) => {
      if (settled || !url.startsWith(WECHAT_REDIRECT_URI)) return
      settled = true

      const parsedUrl = new URL(url)
      const code = parsedUrl.searchParams.get('code')
      const returnedState = parsedUrl.searchParams.get('state')

      if (!wechatWindow.isDestroyed()) wechatWindow.destroy()

      if (code && returnedState === state) {
        resolve(code)
      } else {
        reject(new Error('微信登录失败或已取消'))
      }
    }

    wechatWindow.webContents.on('will-redirect', (event, url) => handleUrl(url))
    wechatWindow.webContents.on('will-navigate', (event, url) => handleUrl(url))
    wechatWindow.on('closed', () => {
      if (!settled) {
        settled = true
        reject(new Error('用户取消了登录'))
      }
    })

    wechatWindow.loadURL(authUrl)
  })
}

function createWindow() {
  // 创建浏览器窗口的代码
  mainWindow = new BrowserWindow({
    width: 400,
    height: 100,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, '../preload/preload.cjs')
    },
    transparent: true,
    frame: false
  })
  // 悬浮于所有虚拟桌面和全屏应用之上
  mainWindow.setAlwaysOnTop(true, 'screen-saver')
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // 加载应用的其余部分
  const isDev = process.env.NODE_ENV === 'development'
  if (isDev) {
    // 开发环境 - 尝试连接Vue开发服务器，失败时显示提示
    loadDevServerWithRetry()
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// 尝试加载开发服务器，支持重试机制
function loadDevServerWithRetry(retryCount = 0) {
  const maxRetries = 15; // 增加重试次数
  const retryDelay = 1000; // 1秒重试间隔
  
  mainWindow.loadURL('http://localhost:8081').catch((error) => {
    if (retryCount < maxRetries) {
      setTimeout(() => loadDevServerWithRetry(retryCount + 1), retryDelay);
    } else {
      showDevServerError();
    }
  });
}

// 显示开发服务器错误页面
function showDevServerError() {
  const errorHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Development Server Not Running</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          padding: 40px;
          text-align: center;
          background-color: #f5f5f5;
        }
        .container {
          max-width: 600px;
          margin: 0 auto;
          background: white;
          padding: 30px;
          border-radius: 8px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h2 {
          color: #e74c3c;
        }
        pre {
          background: #f8f8f8;
          padding: 15px;
          border-radius: 4px;
          overflow-x: auto;
          text-align: left;
        }
        .tip {
          margin-top: 20px;
          padding: 15px;
          background: #e7f4ff;
          border-left: 4px solid #2196F3;
          text-align: left;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h2>🚧 Vue Development Server Not Running</h2>
        <p>Please start the Vue development server manually in a separate terminal:</p>
        <pre>cd render && npm run dev</pre>
        <p>Then restart the Electron application or wait for automatic reconnection.</p>
        
        <div class="tip">
          <strong>💡 Tip:</strong> Make sure you're in the project root directory and 
          the Vue project is located in the 'render' folder.
        </div>
        
        <button onclick="window.location.reload()" 
                style="margin-top: 20px; padding: 10px 20px; background: #2196F3; color: white; border: none; border-radius: 4px; cursor: pointer;">
          🔄 Retry Connection
        </button>
      </div>
    </body>
    </html>
  `;
  
  mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(errorHtml));
}

// 启动Vue开发服务器（可选功能）
function startVueDevServer() {
  const isDev = process.env.NODE_ENV === 'development';
  
  if (!isDev) return; // 只在开发环境尝试启动
  
  try {
    const vueProjectPath = join(process.cwd(), 'src', 'render');
    console.log('Attempting to start Vue dev server...');
    
    vueDevServer = spawn('pnpm', ['run', 'serve'], {
      cwd: vueProjectPath,
      shell: true,
      stdio: 'pipe'
    });
    
    vueDevServer.stdout.on('data', (data) => {
      console.log(`Vue dev: ${data}`);
    });
    
    vueDevServer.stderr.on('data', (data) => {
      console.error(`Vue dev error: ${data}`);
    });
    
    vueDevServer.on('close', (code) => {
      console.log(`Vue dev server exited with code ${code}`);
    });
    
  } catch (error) {
    console.error('Failed to start Vue dev server:', error);
  }
}

// 解析 .env 文件为环境变量对象：打包后的 python-backend 可执行文件里，
// python-dotenv 按源文件路径向上查找 .env 的逻辑找不到真实文件（路径指向 PyInstaller 的临时解压目录），
// 所以改成由 Electron 主进程自己读取 .env 并显式注入子进程环境变量
function parseEnvFile(content) {
  const env = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return env
}

async function startPythonBackend() {
  const isDev = process.env.NODE_ENV === 'development'
  const cwd = process.cwd()

  if (isDev) {
    // 开发环境
    const { devConfig } = await import('../../config/dev.js')
    const { pythonPath, backendPath, workingDir } = devConfig
    const venvBin = join(cwd, 'backend', '.venv', 'bin')
    pythonProcess = spawn(pythonPath, [backendPath], {
      cwd: workingDir,
      env: {
        ...process.env,
        VIRTUAL_ENV: join(cwd, 'backend', '.venv'),
        PATH: `${venvBin}:${process.env.PATH}`
      }
    })
  } else {
    // 生产环境：直接跑 pyinstaller 打包出来的独立可执行文件，不依赖 venv/python 解释器
    const resourcesPath = process.resourcesPath
    const backendExecutable = join(resourcesPath, 'backend', 'python-backend')
    const envFileContent = readFileSync(join(resourcesPath, 'backend', '.env'), 'utf-8')

    pythonProcess = spawn(backendExecutable, [], {
      env: { ...process.env, ...parseEnvFile(envFileContent) }
    })
  }

  pythonProcess.stdout.on('data', (data) => {
    console.log(`Python stdout: ${data}`)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('python-stdout', data.toString())
    }
  })

  pythonProcess.stderr.on('data', (data) => {
    console.error(`Python stderr: ${data}`)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('python-stderr', data.toString())
    }
  })

  pythonProcess.on('close', (code) => {
    console.log(`Python process exited with code ${code}`)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('python-exited', code)
    }
  })

  pythonProcess.on('error', (err) => {
    console.error('Failed to start Python process:', err)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('python-error', err.message)
    }
  })
}

// 模拟按下 Cmd+C，把当前选中内容拷进剪贴板（需要辅助功能权限）
function simulateCopy() {
  return new Promise((resolve, reject) => {
    execFile(
      'osascript',
      ['-e', 'tell application "System Events" to keystroke "c" using command down'],
      (err) => (err ? reject(err) : resolve())
    )
  })
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function closePopup() {
  clearTimeout(popupCloseTimer)
  if (popupWindow) {
    popupWindow.close()
    popupWindow = null
  }
}

const POPUP_WIDTH = 320
const POPUP_MAX_HEIGHT = 240
const POPUP_MIN_HEIGHT = 70

// 在鼠标附近打开（或复用）悬浮卡片窗口
function ensurePopupWindow() {
  if (popupWindow) return popupWindow

  const cursor = screen.getCursorScreenPoint()
  popupWindow = new BrowserWindow({
    x: cursor.x + 12,
    y: cursor.y + 12,
    width: POPUP_WIDTH,
    height: POPUP_MAX_HEIGHT,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: { contextIsolation: true }
  })
  popupWindow.setAlwaysOnTop(true, 'screen-saver')
  popupWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  // 点击卡片以外的任何地方（窗口失焦）就关掉
  popupWindow.on('blur', closePopup)
  popupWindow.on('closed', () => {
    popupWindow = null
  })

  return popupWindow
}

// 渲染悬浮卡片内容：loading / 查词结果 / 报错，三种状态复用同一个窗口
function renderPopup({ loading, word, en_pronunciation, us_pronunciation, meaning, saved, errorMsg }) {
  const win = ensurePopupWindow()
  clearTimeout(popupCloseTimer)

  let bodyHtml
  if (loading) {
    bodyHtml = `<div class="word">${escapeHtml(word)}</div><div class="loading">查询中...</div>`
  } else if (errorMsg) {
    bodyHtml = `<div class="word">${escapeHtml(word || '')}</div><div class="error">${escapeHtml(errorMsg)}</div>`
  } else {
    const wordDataJson = JSON.stringify({ word, en_pronunciation, us_pronunciation, meaning }).replace(/</g, '\\u003c')
    bodyHtml = `
      <div class="header">
        <div class="word">${escapeHtml(word)}</div>
        <button id="favBtn" class="fav-btn${saved ? ' saved' : ''}">${saved ? '★' : '☆'}</button>
      </div>
      <div class="phonetic">英 ${escapeHtml(en_pronunciation)}　美 ${escapeHtml(us_pronunciation)}</div>
      <ul class="meanings">
        ${meaning.map((m) => `<li><span class="type">${escapeHtml(m.type)}</span>${escapeHtml(m.content)}</li>`).join('')}
      </ul>
      <script>
        (function () {
          const wordData = ${wordDataJson}
          const btn = document.getElementById('favBtn')
          btn.addEventListener('click', async () => {
            if (btn.classList.contains('saved')) return
            btn.disabled = true
            try {
              const res = await fetch('http://127.0.0.1:8000/words/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(wordData)
              })
              const data = await res.json()
              if (data.code === 200 || data.msg === '单词已存在') {
                btn.textContent = '★'
                btn.classList.add('saved')
              }
            } catch (e) {
              // 静默失败，按钮恢复可点击
            } finally {
              btn.disabled = false
            }
          })
        })()
      </script>
    `
  }

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif;
          background: #ffffff;
          color: #1a1a1a;
          padding: 16px 18px;
          border-radius: 14px;
          overflow: hidden;
          box-shadow: 0 8px 30px rgba(0,0,0,0.15);
        }
        .header { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
        .word { font-size: 22px; font-weight: 700; margin-bottom: 8px; }
        .fav-btn {
          border: none; background: none; cursor: pointer; font-size: 20px;
          color: #c9ccd1; padding: 0; line-height: 1; margin-top: 2px;
        }
        .fav-btn.saved { color: #f5a623; cursor: default; }
        .phonetic { font-size: 13px; color: #6b7280; margin-bottom: 10px; }
        .meanings { list-style: none; margin: 0; padding: 0; font-size: 14px; line-height: 1.7; max-height: 140px; overflow-y: auto; }
        .type { color: #2563eb; margin-right: 6px; font-weight: 600; }
        .loading, .error { font-size: 13px; color: #6b7280; }
      </style>
    </head>
    <body>${bodyHtml}</body>
    </html>
  `

  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)).then(async () => {
    if (win.isDestroyed()) return
    const contentHeight = await win.webContents.executeJavaScript('document.body.scrollHeight')
    if (win.isDestroyed()) return
    const height = Math.min(Math.max(contentHeight, POPUP_MIN_HEIGHT), POPUP_MAX_HEIGHT)
    win.setContentSize(POPUP_WIDTH, height)
    win.show()
  }).catch((err) => {
    console.error('弹窗渲染失败:', err)
    closePopup()
  })

  // 兜底：就算没触发失焦，也不会一直挂在屏幕上
  popupCloseTimer = setTimeout(closePopup, 8000)
}

// 划词查词：模拟复制 -> 读剪贴板 -> 调后端查词接口 -> 还原剪贴板
async function captureSelectionAndLookup() {
  if (isCapturing) return
  isCapturing = true

  const originalClipboard = clipboard.readText()

  try {
    await simulateCopy()
    // 等待系统完成复制动作
    await new Promise((r) => setTimeout(r, 150))

    const selected = clipboard.readText().trim()

    // 还原剪贴板，不影响用户原本复制的内容
    clipboard.writeText(originalClipboard)

    // 过滤掉空选中、多行/长句（只处理单词/短语查询）
    if (!selected || selected === originalClipboard || selected.length > 30 || /\n/.test(selected)) {
      return
    }

    // 立即弹出卡片显示 loading 状态，不等接口返回
    renderPopup({ loading: true, word: selected })

    const res = await fetch('http://127.0.0.1:8000/words/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word: selected })
    })
    const data = await res.json()
    console.log('划词查词结果:', data)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('word-lookup-result', data)
    }

    if (data.code === 200 && data.data) {
      renderPopup(data.data)
    } else {
      renderPopup({ word: selected, errorMsg: data.msg || '查词失败' })
    }
  } catch (err) {
    console.error('划词查词失败:', err)
    clipboard.writeText(originalClipboard)
    renderPopup({ errorMsg: '查词失败' })
  } finally {
    isCapturing = false
  }
}

// 渲染进程窗口控制按钮（最小化/关闭）
ipcMain.on('window-minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize()
})
ipcMain.on('window-close', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close()
})
// 自定义拖拽：不用 -webkit-app-region: drag（会吞掉 hover 事件），改成渲染进程算好鼠标位移量发过来
ipcMain.on('window-move-by', (event, dx, dy) => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const [x, y] = mainWindow.getPosition()
  mainWindow.setPosition(x + dx, y + dy)
})

ipcMain.handle('auth:get-token', () => getStoredToken())
ipcMain.handle('auth:set-token', (event, token) => {
  setStoredToken(token)
  return true
})
ipcMain.handle('auth:clear-token', () => {
  clearStoredToken()
  return true
})
ipcMain.handle('auth:wechat-login', () => loginWithWechat())
ipcMain.handle('auth:login-success', () => {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.close()
  }
  createWindow()
})
ipcMain.handle('auth:session-expired', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close()
  }
  createLoginWindow()
})

app.whenReady().then(async () => {
  const isDev = process.env.NODE_ENV === 'development'

  // 开发环境继续本地起 Vue dev server + 本地 Python 后端；
  // 生产环境后端已经常驻在云端，不用再在本机 spawn 一份
  if (isDev) {
    startVueDevServer()
    startPythonBackend()
  }

  const openInitialWindow = () => {
    if (isDev) {
      // 给本地 Vue dev server 一点启动时间
      setTimeout(() => createWindow(), 3000)
    } else {
      createWindow()
    }
  }

  const authed = await checkStoredAuth()
  if (authed) {
    openInitialWindow()
  } else if (isDev) {
    setTimeout(() => createLoginWindow(), 3000)
  } else {
    createLoginWindow()
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })

  // 全局热键：划词后按这个快捷键查词存库
  const shortcutOk = globalShortcut.register('CommandOrControl+Shift+D', () => {
    console.log('热键触发')
    captureSelectionAndLookup()
  })
  console.log('热键注册' + (shortcutOk ? '成功' : '失败：可能被其他程序占用'))
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  if (pythonProcess) {
    pythonProcess.kill('SIGTERM')
  }
  if (vueDevServer) {
    vueDevServer.kill('SIGTERM')
  }
})