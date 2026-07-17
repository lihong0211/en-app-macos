import { spawn, execFile } from 'child_process'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { app, BrowserWindow, clipboard, screen, globalShortcut, ipcMain } from 'electron'

const __dirname = dirname(fileURLToPath(import.meta.url))

// 开发环境应用名默认是 "Electron"，统一显示为产品名
app.name = '记单词'

// 微信开放平台"网站应用"配置：AppID 不是密钥，可以放在客户端；
// 打包前把 WECHAT_APP_ID 和 WECHAT_REDIRECT_URI 换成真实值
// （WECHAT_REDIRECT_URI 要跟微信开放平台后台配置的"授权回调域"匹配的一个具体路径）
const WECHAT_APP_ID = 'REPLACE_WITH_YOUR_WECHAT_APP_ID'
const WECHAT_REDIRECT_URI = 'https://REPLACE_WITH_YOUR_DOMAIN/auth/wechat/callback'

// 后端统一走 service-ali 的 en-desktop 模块（开发环境本地起 service-ali，端口 3000）
const API_BASE_URL =
  process.env.NODE_ENV === 'development'
    ? 'http://127.0.0.1:3000/en-desktop'
    : 'https://REPLACE_WITH_YOUR_DOMAIN/en-desktop'

let mainWindow = null
let barWindow = null
let vueDevServer = null
let popupWindow = null
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
    title: '记单词',
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
    loadDevServerWithRetry(loginWindow, 'http://localhost:8081?view=login')
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

// 酷狗式主界面窗口
function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus()
    return
  }
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 680,
    title: '记单词',
    minWidth: 860,
    minHeight: 560,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, '../preload/preload.cjs')
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  const isDev = process.env.NODE_ENV === 'development'
  if (isDev) {
    loadDevServerWithRetry(mainWindow, 'http://localhost:8081')
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// 悬浮词幕条（像酷狗桌面歌词），由主界面播放条上的开关控制显隐
function createBarWindow() {
  if (barWindow && !barWindow.isDestroyed()) return
  barWindow = new BrowserWindow({
    width: 400,
    height: 100,
    title: '记单词',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, '../preload/preload.cjs')
    },
    transparent: true,
    frame: false
  })
  // 悬浮于所有虚拟桌面和全屏应用之上
  barWindow.setAlwaysOnTop(true, 'screen-saver')
  barWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  barWindow.on('closed', () => {
    barWindow = null
    playback.barVisible = false
    broadcastPlayback()
  })

  const isDev = process.env.NODE_ENV === 'development'
  if (isDev) {
    loadDevServerWithRetry(barWindow, 'http://localhost:8081?view=bar')
  } else {
    barWindow.loadFile(join(__dirname, '../renderer/index.html'), { query: { view: 'bar' } })
  }
}

// ---------- 播放状态（主进程持有，主界面/悬浮条都是它的显示器） ----------
// 大词库分页播放：一次只持有一页（100 词），播完当前页自动拉下一页，
// 播完最后一页回到第一页；拉取失败继续循环当前页，不卡轮播。
const playback = {
  libraryId: null, // 数字词库ID 或 'all'（全部单词）
  libraryName: '',
  words: [], // 当前页的单词
  index: -1,
  page: 1,
  pageSize: 100,
  total: 0, // 词库总词数（不可分页的临时列表 = 列表长度）
  pageable: false, // 播完当前页后是否自动翻页（筛选出的临时列表不翻）
  playedInPage: 0,
  loadingPage: false,
  playing: false,
  mode: 'shuffle', // order=列表循环 single=单词循环（同一个词重复播） shuffle=随机
  audioEnabled: true, // 切词时播有道发音（美音）
  timer: null,
  barVisible: false
}

function playbackState() {
  return {
    libraryId: playback.libraryId,
    libraryName: playback.libraryName,
    index: playback.index,
    page: playback.page,
    pageSize: playback.pageSize,
    total: playback.total,
    // 全局序号（跨页），底部播放条显示 position/total
    position:
      playback.index >= 0 ? (playback.page - 1) * playback.pageSize + playback.index + 1 : 0,
    playing: playback.playing,
    mode: playback.mode,
    audioEnabled: playback.audioEnabled,
    barVisible: playback.barVisible,
    currentWord: playback.words[playback.index] || null
  }
}

// 只在"单词切换"时触发发音（开关/模式变化不补播）；
// 定向发给一个存活窗口，双窗口同开也只出一次声。
// 音频成功/失败与轮播节奏完全解耦：失败由渲染端静默跳过，这里不等回执。
function triggerAudio() {
  if (!playback.audioEnabled) return
  const word = playback.words[playback.index]
  if (!word) return
  const target = [mainWindow, barWindow].find((w) => w && !w.isDestroyed())
  if (target) target.webContents.send('playback:play-audio', word.word)
}

function broadcastPlayback() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('playback:state', playbackState())
    }
  }
}

function stepWithinPage(step) {
  const n = playback.words.length
  if (!n) return
  if (playback.mode === 'shuffle' && n > 1) {
    let r
    do {
      r = Math.floor(Math.random() * n)
    } while (r === playback.index)
    playback.index = r
  } else {
    playback.index = (playback.index + step + n) % n
  }
  playback.playedInPage += 1
  broadcastPlayback()
  triggerAudio()
}

function playbackStep(step) {
  const n = playback.words.length
  if (!n) return
  const multiPage = playback.pageable && Math.ceil(playback.total / playback.pageSize) > 1
  // 顺序：播到页尾翻页；随机：本页播够 n 个后翻页
  const pageExhausted = playback.mode === 'shuffle'
    ? playback.playedInPage >= n
    : playback.index >= n - 1
  if (step > 0 && multiPage && pageExhausted) {
    loadNextPage()
    return
  }
  stepWithinPage(step)
}

// 拉下一页（最后一页播完回到第一页）；失败时退回本页内循环
async function loadNextPage() {
  if (playback.loadingPage) return
  playback.loadingPage = true
  try {
    const totalPages = Math.max(1, Math.ceil(playback.total / playback.pageSize))
    const nextPage = playback.page >= totalPages ? 1 : playback.page + 1
    const base =
      playback.libraryId === 'all'
        ? `${API_BASE_URL}/words/list`
        : `${API_BASE_URL}/libraries/${playback.libraryId}/words`
    const token = getStoredToken()
    const res = await fetch(`${base}?page=${nextPage}&page_size=${playback.pageSize}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    })
    const data = await res.json()
    const list = data && data.code === 200 && data.data && data.data.list
    if (!list || !list.length) {
      throw new Error((data && data.msg) || '下一页为空')
    }
    playback.words = list
    playback.page = nextPage
    playback.total = data.data.total || playback.total
    playback.index = playback.mode === 'shuffle' ? Math.floor(Math.random() * list.length) : 0
    playback.playedInPage = 1
    broadcastPlayback()
    triggerAudio()
  } catch (err) {
    console.error('拉取下一页失败，继续循环当前页:', err.message)
    stepWithinPage(1)
  } finally {
    playback.loadingPage = false
  }
}

// 定时轮播一拍：单词循环模式重复读当前词，其余模式切下一个
function playbackTick() {
  if (playback.mode === 'single') {
    if (playback.words[playback.index]) triggerAudio()
    return
  }
  playbackStep(1)
}

// 手动切词也走这里重启定时器，保证切完有完整的一个间隔周期
function restartPlaybackTimer() {
  clearInterval(playback.timer)
  playback.timer = null
  if (playback.playing && playback.words.length > 0) {
    playback.timer = setInterval(() => playbackTick(), 7000)
  }
}

// 尝试加载开发服务器，支持重试机制
function loadDevServerWithRetry(win, url, retryCount = 0) {
  const maxRetries = 15; // 增加重试次数
  const retryDelay = 1000; // 1秒重试间隔

  win.loadURL(url).catch((error) => {
    if (win.isDestroyed()) return;
    if (retryCount < maxRetries) {
      setTimeout(() => loadDevServerWithRetry(win, url, retryCount + 1), retryDelay);
    } else {
      showDevServerError(win);
    }
  });
}

// 显示开发服务器错误页面
function showDevServerError(win) {
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
  
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(errorHtml));
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
    webPreferences: {
      contextIsolation: true,
      // 弹窗里的收藏走 IPC 由主进程发请求：data: 页面直连后端会被 CORS 拦
      preload: join(__dirname, '../preload/preload.cjs')
    }
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

  let bodyHtml
  if (loading) {
    bodyHtml = `<div class="word">${escapeHtml(word)}</div><div class="loading">查询中...</div>`
  } else if (errorMsg) {
    bodyHtml = `<div class="word">${escapeHtml(word || '')}</div><div class="error">${escapeHtml(errorMsg)}</div>`
  } else {
    const wordDataJson = JSON.stringify({ word, en_pronunciation, us_pronunciation, meaning })
      .replace(/</g, '\\u003c')
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
              const data = await window.electronAPI.collectWord(wordData)
              if (data && (data.code === 200 || data.msg === '单词已存在')) {
                btn.textContent = '★'
                btn.classList.add('saved')
              } else {
                btn.title = (data && data.msg) || '收藏失败'
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
    <body>${bodyHtml}
    <script>
      // 关闭策略：鼠标在弹窗内不自动关；移出 300ms 后关；
      // 一直没进来过的话 8 秒兜底关，不会一直挂在屏幕上
      (function () {
        let closeTimer = setTimeout(() => window.close(), 8000)
        // 页面重渲染（loading -> 结果）时鼠标可能已经在窗口里，mouseenter 不会再触发
        setTimeout(() => {
          if (document.documentElement.matches(':hover')) clearTimeout(closeTimer)
        }, 100)
        document.addEventListener('mouseenter', () => clearTimeout(closeTimer))
        document.addEventListener('mouseleave', () => {
          clearTimeout(closeTimer)
          closeTimer = setTimeout(() => window.close(), 300)
        })
      })()
    </script>
    </body>
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
    // 接口秒回时，结果渲染会打断还没加载完的 loading 渲染（ERR_ABORTED）——
    // 这不是真失败，关窗会把接管的新渲染一起杀掉
    if (err && err.code === 'ERR_ABORTED') return
    console.error('弹窗渲染失败:', err)
    closePopup()
  })
  // 自动关闭策略在弹窗页面脚本里：悬停不关、移出 300ms 关、8 秒兜底
}

// 划词查词：模拟复制 -> 读剪贴板 -> 调后端查词接口 -> 还原剪贴板
async function captureSelectionAndLookup() {
  if (isCapturing) return
  isCapturing = true

  const originalClipboard = clipboard.readText()

  try {
    // 先清空剪贴板作哨兵：复制没生效读回来就是空。
    // 不能用"新旧内容相同"来判断复制失败——重新查同一个词会被误判成失败而无声退出
    clipboard.writeText('')

    // 等用户松开热键：手指还按着 Shift 时模拟 Cmd+C 会叠加成 Cmd+Shift+C，复制不生效
    await new Promise((r) => setTimeout(r, 300))
    await simulateCopy()
    // 等待系统完成复制动作
    await new Promise((r) => setTimeout(r, 150))

    let selected = clipboard.readText().trim()
    if (!selected) {
      // 兜底重试一次（用户松键慢/目标应用响应慢）
      await new Promise((r) => setTimeout(r, 250))
      await simulateCopy()
      await new Promise((r) => setTimeout(r, 150))
      selected = clipboard.readText().trim()
    }

    // 还原剪贴板，不影响用户原本复制的内容
    clipboard.writeText(originalClipboard)

    if (!selected) {
      // 给出可见反馈而不是无声失败（常见原因：没选中文本、辅助功能权限没开）
      renderPopup({ errorMsg: '没有取到选中内容（检查是否选中了文本 / 辅助功能权限）' })
      return
    }
    // 多行/长句不处理（只处理单词/短语查询），静默跳过
    if (selected.length > 30 || /\n/.test(selected)) {
      console.log('划词跳过：选中内容过长或多行')
      return
    }

    // 立即弹出卡片显示 loading 状态，不等接口返回
    renderPopup({ loading: true, word: selected })

    const res = await fetch(`${API_BASE_URL}/words/lookup`, {
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

// 渲染进程窗口控制按钮（最小化/关闭），按消息来源窗口操作
ipcMain.on('window-minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win && !win.isDestroyed()) win.minimize()
})
ipcMain.on('window-close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win && !win.isDestroyed()) win.close()
})
// 自定义拖拽：不用 -webkit-app-region: drag（会吞掉 hover 事件），改成渲染进程算好鼠标位移量发过来
ipcMain.on('window-move-by', (event, dx, dy) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || win.isDestroyed()) return
  const [x, y] = win.getPosition()
  win.setPosition(x + dx, y + dy)
})

// ---------- 播放控制 ----------
ipcMain.handle('playback:start', (event, payload) => {
  const { libraryId, libraryName, words, startIndex, page, pageSize, total, pageable } =
    payload || {}
  playback.libraryId = libraryId ?? null
  playback.libraryName = libraryName || ''
  playback.words = Array.isArray(words) ? words : []
  playback.page = page || 1
  playback.pageSize = pageSize || 100
  playback.total = total || playback.words.length
  playback.pageable = !!pageable
  playback.index = Number.isInteger(startIndex)
    ? startIndex
    : playback.words.length
      ? Math.floor(Math.random() * playback.words.length)
      : -1
  playback.playedInPage = playback.index >= 0 ? 1 : 0
  playback.playing = playback.words.length > 0
  restartPlaybackTimer()
  broadcastPlayback()
  triggerAudio()
  return playbackState()
})

ipcMain.on('playback:next', () => {
  playbackStep(1)
  restartPlaybackTimer()
})
ipcMain.on('playback:prev', () => {
  playbackStep(-1)
  restartPlaybackTimer()
})
ipcMain.on('playback:set-playing', (event, playing) => {
  playback.playing = !!playing && playback.words.length > 0
  restartPlaybackTimer()
  broadcastPlayback()
})
ipcMain.on('playback:set-mode', (event, mode) => {
  if (['order', 'single', 'shuffle'].includes(mode)) {
    playback.mode = mode
    broadcastPlayback()
  }
})
ipcMain.on('playback:set-audio', (event, enabled) => {
  playback.audioEnabled = !!enabled
  broadcastPlayback()
})
ipcMain.handle('playback:get-state', () => playbackState())

// 划词弹窗收藏：主进程代发（弹窗是 data: 页面，直连后端会被 CORS 拦），
// 带登录 token，收藏进默认词库"默认收藏"
ipcMain.handle('words:collect', async (event, wordData) => {
  try {
    const token = getStoredToken()
    const res = await fetch(`${API_BASE_URL}/words/add`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ ...wordData, library_id: 'default' })
    })
    const data = await res.json()
    // 收藏成功通知各窗口刷新（主界面单词列表/词库计数多了一个词）
    if (data && (data.code === 200 || data.msg === '单词已存在')) {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('words:collected', data.data || null)
      }
    }
    return data
  } catch (err) {
    console.error('收藏单词失败:', err)
    return { code: 500, msg: err.message || '收藏失败' }
  }
})

// 悬浮词幕条开关
ipcMain.handle('bar:toggle', () => {
  if (playback.barVisible) {
    if (barWindow && !barWindow.isDestroyed()) barWindow.close()
    playback.barVisible = false
  } else {
    playback.barVisible = true
    createBarWindow()
  }
  broadcastPlayback()
  return playback.barVisible
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
  createMainWindow()
})
ipcMain.handle('auth:session-expired', () => {
  clearInterval(playback.timer)
  playback.timer = null
  playback.playing = false
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close()
  }
  if (barWindow && !barWindow.isDestroyed()) {
    barWindow.close()
  }
  createLoginWindow()
})

app.whenReady().then(async () => {
  const isDev = process.env.NODE_ENV === 'development'

  // 开发环境 Dock 图标（打包版由 resources/icon.icns 提供）
  const dockIconPath = join(__dirname, '../../resources/icon.png')
  if (process.platform === 'darwin' && app.dock && existsSync(dockIconPath)) {
    try {
      app.dock.setIcon(dockIconPath)
    } catch (err) {
      console.error('设置 Dock 图标失败:', err.message)
    }
  }

  // 开发环境本地起 Vue dev server；后端统一用 service-ali（本地自行启动，端口 3000）
  if (isDev) {
    startVueDevServer()
  }

  const openInitialWindow = () => {
    if (isDev) {
      // 给本地 Vue dev server 一点启动时间
      setTimeout(() => createMainWindow(), 3000)
    } else {
      createMainWindow()
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
      createMainWindow()
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
  if (vueDevServer) {
    vueDevServer.kill('SIGTERM')
  }
})