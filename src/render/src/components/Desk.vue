<template>
  <div class="app" :class="{ hover: isHovering }" @mouseenter="onMouseEnter" @mouseleave="onMouseLeave"
    @mousedown="startDrag">
    <div class="overlay"></div>

    <div class="controls">
      <button class="ctrl-btn" title="最小化" @click="minimize"><span
          class="ctrl-btn-icon ctrl-btn-icon--minimize"></span></button>
      <button class="ctrl-btn" title="关闭" @click="closeWindow"><span
          class="ctrl-btn-icon ctrl-btn-icon--close"></span></button>
    </div>

    <transition name="fade" mode="out-in">
      <div v-if="currentWord" class="word-block" :key="currentWord.id || currentIndex">
        <div class="word-text">{{ currentWord.word }}</div>
        <div v-for="(m, i) in currentWord.meaning.slice(0, 2)" :key="i" class="word-meaning">
          <span>{{ m.type }}</span>{{ m.content }}
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup>
import axios from 'axios'
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

const words = ref([])
const currentIndex = ref(0)
const isLoading = ref(false)
const isHovering = ref(false)
let autoplayTimer = null
let hoverLeaveTimer = null

const startAutoplay = () => {
  clearInterval(autoplayTimer)
  autoplayTimer = setInterval(next, 7000)
}

const stopAutoplay = () => {
  clearInterval(autoplayTimer)
}

const onMouseEnter = () => {
  clearTimeout(hoverLeaveTimer)
  isHovering.value = true
  stopAutoplay()
}

const onMouseLeave = () => {
  // 短暂延迟再隐藏，鼠标移向按钮途中稍微划出窗口边界不会立刻收起控制条
  hoverLeaveTimer = setTimeout(() => {
    isHovering.value = false
    next() // 恢复轮播时立刻切一次，不用再等一整个间隔周期
    startAutoplay()
  }, 300)
}

const currentWord = computed(() => words.value[currentIndex.value] || null)

// 一次性把所有单词拉回来，后面直接在全量里随机，不用分页
const getAllWords = async (retryCount = 0) => {
  if (isLoading.value) return

  isLoading.value = true
  try {
    const response = await axios.get('http://127.0.0.1:8000/words/list', {
      params: { page: 1, page_size: 10000 }
    })
    words.value = response.data.data || []
  } catch (error) {
    console.error('获取单词失败:', error)
    // 生产环境下 python 后端启动比页面挂载慢，第一次请求大概率会失败，隔几秒重试
    const maxRetries = 15
    if (retryCount < maxRetries) {
      setTimeout(() => getAllWords(retryCount + 1), 2000)
    }
  } finally {
    isLoading.value = false
  }
}

const next = () => {
  if (words.value.length <= 1) return

  let randomIndex
  do {
    randomIndex = Math.floor(Math.random() * words.value.length)
  } while (randomIndex === currentIndex.value)
  currentIndex.value = randomIndex
}

const minimize = () => window.electronAPI?.minimizeWindow()
const closeWindow = () => window.electronAPI?.closeWindow()

// 自定义拖拽：不用 -webkit-app-region: drag，避免和 hover 事件冲突
let dragStart = null

const onDrag = (e) => {
  if (!dragStart) return
  const dx = e.screenX - dragStart.x
  const dy = e.screenY - dragStart.y
  dragStart = { x: e.screenX, y: e.screenY }
  window.electronAPI?.moveWindowBy(dx, dy)
}

const stopDrag = () => {
  dragStart = null
  window.removeEventListener('mousemove', onDrag)
  window.removeEventListener('mouseup', stopDrag)
}

const startDrag = (e) => {
  if (e.target.closest('.ctrl-btn')) return
  e.preventDefault()
  dragStart = { x: e.screenX, y: e.screenY }
  window.addEventListener('mousemove', onDrag)
  window.addEventListener('mouseup', stopDrag)
}

onMounted(async () => {
  await getAllWords()
  if (words.value.length > 0) {
    currentIndex.value = Math.floor(Math.random() * words.value.length)
  }
  startAutoplay()
})

onBeforeUnmount(() => {
  clearInterval(autoplayTimer)
  clearTimeout(hoverLeaveTimer)
  stopDrag()
})
</script>

<style scoped>
.app {
  position: relative;
  width: 100%;
  height: 100vh;
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  background: transparent;
  overflow: hidden;
  padding: 12px;
  user-select: none;
  cursor: default;
}

.overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  opacity: 0;
  transition: opacity 0.2s ease;
  pointer-events: none;
}

.app.hover .overlay {
  opacity: 1;
}

.controls {
  position: absolute;
  top: 5px;
  right: 30px;
  display: flex;
  gap: 5px;
  opacity: 0;
  transition: opacity 0.2s ease;
  -webkit-app-region: no-drag;
  z-index: 2;
}

.app.hover .controls {
  opacity: 1;
}

.ctrl-btn {
  width: 20px;
  height: 20px;
  padding: 0;
  margin: 0;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.65);
  font-size: 16px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease;
}

.ctrl-btn:hover {
  color: rgb(236, 68, 68);
  background: rgba(255, 255, 255, 0.12);
}

.ctrl-btn-icon {
  display: block;
  position: relative;
  width: 10px;
  height: 10px;
}

.ctrl-btn-icon--minimize {
  height: 1.4px;
  align-self: center;
  background: currentColor;
}

.ctrl-btn-icon--close::before,
.ctrl-btn-icon--close::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 10px;
  height: 1.4px;
  background: currentColor;
}

.ctrl-btn-icon--close::before {
  transform: translate(-50%, -50%) rotate(45deg);
}

.ctrl-btn-icon--close::after {
  transform: translate(-50%, -50%) rotate(-45deg);
}

.word-block {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  max-height: 100%;
  overflow: hidden;
  text-align: left;
  color: rgb(70, 185, 234);
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.95), 0 0 2px rgba(0, 0, 0, 0.9);
  word-break: break-word;
}

.word-text {
  font-size: 26px;
  font-weight: 700;
  margin-bottom: 6px;
}

.word-meaning {
  color: rgb(70, 185, 234);
  font-size: 14px;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  width: 370px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.word-type {
  /* color: #cbd5ff; */
  margin-right: 4px;
  font-weight: 600;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.6s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
