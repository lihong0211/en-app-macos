<div align="center">
  <img src="resources/icon.png" width="140" height="140" alt="记单词" />
</div>

<h1 align="center">记单词</h1>

<p align="center">
  像放歌一样背单词的 macOS 桌面应用。
</p>

<p align="center">
  <a href="#功能特性">功能特性</a> ·
  <a href="#预览">预览</a> ·
  <a href="#安装说明">安装说明</a> ·
  <a href="#技术栈">技术栈</a> ·
  <a href="#开发">开发</a>
</p>

---

## 功能特性

- 🔍 **屏幕取词** — 任意应用里选中一个单词，`⌘⇧D` 呼出查词卡片，音标、释义即刻可见，一键收藏进词库
- 📚 **基础词库** — 中考 / 高考 / 四级 / 六级 / 考研 / 高频 Top5000，基于 [ECDICT](https://github.com/skywind3000/ECDICT) 整理的考试核心词汇
- 🎨 **主题词库** — 厨房烹饪、体育运动、旅游度假、职场办公……36 个生活场景主题词库，照顾兴趣式学习
- 📁 **个人词库** — 自建词库自由归类；默认收藏承接屏幕取词的一键收藏；未掌握词库像"我喜欢"歌单一样，把不熟的词随手标记、随时复习；也可以收藏别人的公共词库，出现在侧栏常驻
- 🎵 **悬浮窗播放** — 像桌面歌词一样置顶悬浮，播放到哪个词就显示哪个词，可拖拽、鼠标悬停自动暂停
- 🔊 **语音播放** — 列表循环 / 单词循环（反复精听同一个词）/ 随机播放三种模式，真人发音朗读，也可以随时关掉只看不听

## 预览

<table>
  <tr>
    <td align="center" width="50%"><b>推荐词库</b></td>
    <td align="center" width="50%"><b>词库播放</b></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/discover.png" /></td>
    <td><img src="docs/screenshots/library-playing.png" /></td>
  </tr>
  <tr>
    <td align="center"><b>屏幕取词</b></td>
    <td align="center"><b>悬浮词幕</b></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/lookup-popup.png" /></td>
    <td><img src="docs/screenshots/floating-bar-desktop.png" /></td>
  </tr>
</table>

## 安装说明

在 [Releases](../../releases) 下载对应芯片的 dmg：芯片为 Apple M 系列选带 `-arm64` 后缀的包，Intel 芯片选带 `-x64` 后缀的包（Apple 菜单 →「关于本机」可查看芯片型号）。

安装包尚未经过苹果公证，首次打开时系统可能提示"Apple 无法验证""此软件需要更新"，属于正常现象，按下面任一方法处理即可：

- **右键打开**：不要双击，改为右键（或按住 Control）点击 App 图标 → 选择「打开」→ 弹窗中再次选择「打开」，之后即可正常双击使用。**注意**：第一次右键「打开」有时弹窗里不会出现「打开」按钮（只有「完成」/「移到废纸篓」），此时再右键点击一次「打开」，第二次弹窗通常就会带上「打开」按钮了
- **系统设置放行**：若直接被拦截，进入「系统设置」→「隐私与安全性」，下滑找到"记单词"被阻止打开的提示，点击「仍要打开」
- **终端命令**（适合熟悉终端的用户）：
  ```bash
  xattr -cr /Applications/记单词.app
  ```

## 技术栈

- **客户端**：Electron + Vue 3，`⌘⇧D` 全局快捷键划词、悬浮窗、桌面通知等原生能力走 Electron 主进程，界面走 Vue
- **后端**：FastAPI（[service-ali](https://github.com/lihong0211/service) 的 en-desktop 模块），MySQL 存储用户 / 词库 / 单词数据
- **词典数据**：查词接口用 [Free Dictionary API](https://dictionaryapi.dev/) 取英文释义结构，[有道翻译](https://ai.youdao.com/) 转中文；基础词库数据来自 ECDICT

## 开发

```bash
# 安装依赖
npm install
cd src/render && npm install && cd ../..

# 启动开发环境（自动拉起 Vue 开发服务器）
npm run dev
```

开发环境需要本地起一份 [service-ali](https://github.com/lihong0211/service) 后端服务（默认 `http://127.0.0.1:3000`）。

```bash
# 构建 macOS 应用
npm run build
```
