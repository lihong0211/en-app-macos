# 例句朗读(TTS) · 前端播放 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 词表里展示例句原文/翻译并可点击播放，桌面悬浮轮播在单词发音播完后接着朗读一条例句。

**Architecture:** `utils/audio.js` 新增 `playSentenceAudio(url)`（复用现有 `playWordAudio` 的"静默失败、快速切换打断上一个"风格），并给 `playWordAudio` 加一个可选的 `onEnded` 回调，用来在词发音播完后串联例句发音；`Main.vue` 词表里给每条 meaning 展示对应例句+播放按钮；`Main.vue`/`Desk.vue` 各自订阅的 `onPlayAudio` 事件回调改成"播单词音，播完再挑一条例句播"。不改 `src/main/main.js`——轮播定时器、`onPlayAudio` 事件本身的触发时机完全不变，改动只在渲染进程这边怎么响应这个事件。

**Tech Stack:** Vue 3 (`<script setup>`)，浏览器原生 `Audio` API（跟现有单词发音实现一致，不引入新依赖）

**关联文档:** [功能设计](../specs/2026-07-22-sentence-tts-design.md) — 本计划覆盖设计文档"四、前端交互"一节；后端 API 序列化扩展和生成脚本是 service-ali 仓库的独立计划（[2026-07-22-sentence-tts-backend.md](/Users/lihong/Desktop/personal/code/service-ali/docs/superpowers/plans/2026-07-22-sentence-tts-backend.md)），本计划假定该计划已完成——即 `/words/list`、`/words/{id}`、`/libraries/{id}/words` 返回的每条 `meaning` 已经带上 `sentence: {en_text, zh_text, audio_url} | null` 字段。

## Global Constraints

- 悬浮轮播只播放"当前词第一条有 `audio_url` 的 meaning"对应的例句（按 `word.meaning` 数组顺序找第一条，不做多句轮播/去重）
- `sentence` 为 `null` 或 `sentence.audio_url` 为空：词表不显示播放按钮，悬浮轮播跳过不报错、不特殊提示（降级方式跟本仓库拼读拆分功能设计文档里的约定一致）
- 复用 `utils/audio.js` 现有的"快速切换打断上一个音频"风格（单词音频和例句音频共用同一个 `current` 变量），不引入新的音频管理抽象
- 不改 `src/main/main.js` 和 IPC 契约——`onPlayAudio` 事件依然只传一个 `word` 字符串，播放顺序完全在渲染进程本地编排
- 这个仓库的 Vue 组件目前没有自动化测试（没有 Jest/Vitest），本计划用 `npm run lint` + 手动跑 dev server 验证，不引入新的测试框架

---

### Task 1: `utils/audio.js` — 例句播放 + 单词发音播完回调

**Files:**
- Modify: `src/render/src/utils/audio.js`

**Interfaces:**
- Produces: `playWordAudio(word: string, onEnded?: () => void)`（在原有基础上新增可选第二参数）、`playSentenceAudio(url: string)`、`firstSentenceAudioUrl(word: object) -> string | null`——供 Task 2、Task 3 的 `Main.vue`/`Desk.vue` 使用

- [ ] **Step 1: 改写 `utils/audio.js`**

把整个文件内容替换为：

```js
// 单词发音：有道词典发音接口（type=2 美音），源自 en-mini 的 playAudio。
// 例句发音：service-ali 离线批量生成的 mp3（url 来自 word.meaning[].sentence.audio_url）。
// 约定：音频失败绝不影响轮播——加载失败/被拒/超时全部静默跳过，只留 console 痕迹。
const YOUDAO_VOICE_URL = 'https://dict.youdao.com/dictvoice?type=2&audio='

let current = null

function stopCurrent() {
  // 快速切词/切句时先停掉上一个，不叠音
  if (current) {
    current.pause()
    current.src = ''
  }
}

export function playWordAudio(word, onEnded) {
  if (!word) return
  try {
    stopCurrent()
    current = new Audio(YOUDAO_VOICE_URL + encodeURIComponent(word))
    current.onerror = () => console.warn('发音加载失败:', word)
    if (onEnded) current.addEventListener('ended', onEnded)
    current.play().catch((e) => console.warn('发音播放失败:', word, e && e.message))
  } catch (e) {
    console.warn('发音异常:', word, e.message)
  }
}

export function playSentenceAudio(url) {
  if (!url) return
  try {
    stopCurrent()
    current = new Audio(url)
    current.onerror = () => console.warn('例句发音加载失败:', url)
    current.play().catch((e) => console.warn('例句发音播放失败:', url, e && e.message))
  } catch (e) {
    console.warn('例句发音异常:', url, e.message)
  }
}

// 取当前词第一条有 audio_url 的 meaning 对应的例句地址；没有就返回 null（调用方据此跳过，不报错）
export function firstSentenceAudioUrl(word) {
  const found = (word?.meaning || []).find((m) => m.sentence?.audio_url)
  return found ? found.sentence.audio_url : null
}
```

- [ ] **Step 2: lint 确认没有语法/风格问题**

Run: `cd src/render && npm run lint`
Expected: 无报错（跟改动前的 lint 状态一致）

- [ ] **Step 3: Commit**

```bash
git add src/render/src/utils/audio.js
git commit -m "feat: audio.js 新增例句播放与发音结束回调"
```

---

### Task 2: `Main.vue` 词表展示例句 + 播放按钮

**Files:**
- Modify: `src/render/src/components/Main.vue`

**Interfaces:**
- Consumes: `playSentenceAudio(url: string)`（Task 1）
- Produces: 无（纯 UI 展示层）

- [ ] **Step 1: import 里加上 `playSentenceAudio`**

把第 249 行：

```js
import { playWordAudio } from '../utils/audio'
```

改成：

```js
import { playWordAudio, playSentenceAudio } from '../utils/audio'
```

- [ ] **Step 2: 词表的释义列加上例句展示**

把第 148-152 行：

```html
                <td class="col-meaning">
                  <span v-for="(m, mi) in w.meaning" :key="mi" class="meaning-item">
                    <i class="pos">{{ m.type }}</i>{{ m.content }}
                  </span>
                </td>
```

改成：

```html
                <td class="col-meaning">
                  <span v-for="(m, mi) in w.meaning" :key="mi" class="meaning-item">
                    <i class="pos">{{ m.type }}</i>{{ m.content }}
                    <span v-if="m.sentence" class="sentence-item">
                      <button v-if="m.sentence.audio_url" class="sentence-play-btn" title="播放例句发音"
                        @click.stop="playSentenceAudio(m.sentence.audio_url)">▶</button>
                      {{ m.sentence.en_text }}<span class="sentence-zh">{{ m.sentence.zh_text }}</span>
                    </span>
                  </span>
                </td>
```

- [ ] **Step 3: 加对应样式**

在 `<style scoped>` 里 `.meaning-item { margin-right: 10px; }` 规则后面追加：

```css
.sentence-item {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  color: var(--dim);
}

.sentence-play-btn {
  border: none;
  background: transparent;
  color: var(--accent);
  cursor: pointer;
  padding: 0 4px 0 0;
  font-size: 11px;
}

.sentence-zh {
  margin-left: 6px;
  opacity: 0.7;
}
```

- [ ] **Step 4: lint 确认**

Run: `cd src/render && npm run lint`
Expected: 无报错

- [ ] **Step 5: 手动验证**

跑 dev server（见 Task 3 Step 5 的统一验证），先确认：词表里有例句数据的单词，释义下面出现例句原文+中文翻译；有 `audio_url` 的例句左边有播放按钮，点击能听到发音；没有例句数据的单词跟改动前显示一样，不受影响。

- [ ] **Step 6: Commit**

```bash
git add src/render/src/components/Main.vue
git commit -m "feat: 词表展示例句并支持点击播放"
```

---

### Task 3: 悬浮轮播 & 词表播放联动例句朗读

**Files:**
- Modify: `src/render/src/components/Desk.vue`
- Modify: `src/render/src/components/Main.vue`

**Interfaces:**
- Consumes: `playWordAudio(word, onEnded)`、`playSentenceAudio(url)`、`firstSentenceAudioUrl(word)`（Task 1）
- Produces: 无

- [ ] **Step 1: `Desk.vue` import 加上新函数**

把第 29 行：

```js
import { playWordAudio } from '../utils/audio'
```

改成：

```js
import { playWordAudio, playSentenceAudio, firstSentenceAudioUrl } from '../utils/audio'
```

- [ ] **Step 2: `Desk.vue` 的 `onPlayAudio` 订阅改成"播完单词接着播例句"**

把第 89 行：

```js
  unsubscribeAudio = window.electronAPI?.onPlayAudio(playWordAudio)
```

改成：

```js
  unsubscribeAudio = window.electronAPI?.onPlayAudio((word) => {
    playWordAudio(word, () => {
      const url = firstSentenceAudioUrl(currentWord.value)
      if (url) playSentenceAudio(url)
    })
  })
```

`currentWord` 是文件里已有的 `computed(() => playback.value?.currentWord || null)`（第 38 行），不用新增。

- [ ] **Step 3: `Main.vue` import 加上 `firstSentenceAudioUrl`**

把 Task 2 Step 1 已经改过的这一行：

```js
import { playWordAudio, playSentenceAudio } from '../utils/audio'
```

改成：

```js
import { playWordAudio, playSentenceAudio, firstSentenceAudioUrl } from '../utils/audio'
```

- [ ] **Step 4: `Main.vue` 的 `onPlayAudio` 订阅同样改造**

把第 646 行：

```js
  unsubscribeAudio = electronAPI?.onPlayAudio(playWordAudio)
```

改成：

```js
  unsubscribeAudio = electronAPI?.onPlayAudio((word) => {
    playWordAudio(word, () => {
      const url = firstSentenceAudioUrl(pb.currentWord)
      if (url) playSentenceAudio(url)
    })
  })
```

`pb.currentWord` 是文件里已有的 reactive 状态（第 291-303 行的 `pb` 对象），不用新增。

- [ ] **Step 5: lint 确认**

Run: `cd src/render && npm run lint`
Expected: 无报错

- [ ] **Step 6: 手动端到端验证**

```bash
npm run dev
```

在跑起来的 app 里：
1. 打开一个词库，勾几个"发音"轮播开着的单词，确认单词发音播完之后（如果这个词有带 `audio_url` 的例句）接着播了一句例句朗读，两段发音不重叠
2. 找一个没有例句/例句还没生成 `audio_url` 的单词，确认只播单词发音、没有报错、没有卡顿
3. 快速手动切词（点"下一个"或双击词表另一行），确认例句播放到一半会被打断，不会跟新单词的发音叠在一起
4. 打开桌面悬浮词幕条，重复上面 1-3，确认悬浮条这边的表现和主界面一致
5. 打开系统关掉"发音"开关（`pb.audioEnabled` 对应的"发音"按钮），确认单词音和例句音都不再播放

- [ ] **Step 7: Commit**

```bash
git add src/render/src/components/Desk.vue src/render/src/components/Main.vue
git commit -m "feat: 悬浮轮播与词表播放单词发音后接播例句朗读"
```

## Self-Review

- **Spec 覆盖**：本计划覆盖了设计文档"四、前端交互"的全部内容——词表例句展示+播放按钮、`audio_url` 为空时的降级（不显示按钮/跳过不报错）、悬浮轮播播完单词接播例句、复用 `new Audio(url).play()` 的静默失败风格。
- **占位符检查**：所有代码块都是完整实现，没有 TBD/TODO。
- **类型一致性**：`playWordAudio(word, onEnded)`、`playSentenceAudio(url)`、`firstSentenceAudioUrl(word)` 三个函数名和参数在 Task 1 定义、Task 2/3 消费的地方完全一致；`firstSentenceAudioUrl` 消费的 `word.meaning[].sentence.audio_url` 结构跟后端计划（`2026-07-22-sentence-tts-backend.md` Task 4）产出的字段结构一致。
- **风险点**：`onPlayAudio` 回调里读的 `currentWord.value`/`pb.currentWord` 依赖它和主进程当前正在播放的 `word` 字符串是同一个词——这是现有代码本来就有的隐含假设（`Main.vue`/`Desk.vue` 展示释义时同样依赖 `pb.currentWord`/`currentWord` 跟正在播的词同步），本计划沿用这个假设，不额外加校验。
