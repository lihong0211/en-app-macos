<template>
  <div class="player">
    <!-- 左侧：词库（歌单）栏 -->
    <aside class="sidebar">
      <div class="drag-strip"></div>
      <div class="user" v-if="user">
        <div class="avatar">
          <img v-if="user.avatar" :src="user.avatar" alt="" />
          <span v-else>{{ (user.nickname || user.username || '?').slice(0, 1).toUpperCase() }}</span>
        </div>
        <div class="user-name">{{ user.nickname || user.username }}</div>
      </div>

      <div class="nav-section">
        <div class="nav-item" :class="{ active: activeLibraryId === 'discover' }" @click="selectLibrary('discover')">
          <span class="nav-icon">✦</span>推荐
        </div>
        <div class="nav-item" :class="{ active: activeLibraryId === 'all' }" @click="selectLibrary('all')">
          <span class="nav-icon">♪</span>全部单词
        </div>
      </div>

      <div class="section-label section-head">
        <span><span class="nav-icon">▤</span>自建词库</span>
        <span class="head-actions">
          <button class="mini-btn head-btn" title="新建词库" @click="startCreate">＋</button>
          <button class="mini-btn head-btn" :title="ownCollapsed ? '展开' : '折叠'"
            @click="ownCollapsed = !ownCollapsed">{{ ownCollapsed ? '›' : '⌄' }}</button>
        </span>
      </div>
      <div class="library-list">
        <template v-if="!ownCollapsed">
          <div class="nav-item new-library" v-if="creatingLibrary">
            <input v-model="newLibraryName" class="inline-input" placeholder="词库名称" @keyup.enter="confirmCreate"
              @keyup.esc="creatingLibrary = false" @blur="confirmCreate" v-focus />
          </div>
          <div v-for="lib in sortedLibraries" :key="lib.id" class="nav-item library-item"
            :class="{ active: activeLibraryId === lib.id }" @click="selectLibrary(lib.id)">
            <template v-if="renamingId === lib.id">
              <input v-model="renameText" class="inline-input" @keyup.enter="confirmRename(lib)"
                @keyup.esc="renamingId = null" @blur="confirmRename(lib)" v-focus />
            </template>
            <template v-else>
              <span class="lib-name">{{ lib.name }}</span>
              <span class="lib-count">{{ lib.word_count }}</span>
              <span class="lib-actions" v-if="!PROTECTED_LIBS.includes(lib.name)">
                <button class="mini-btn" title="重命名" @click.stop="startRename(lib)">✎</button>
                <button class="mini-btn" title="删除" @click.stop="removeLibrary(lib)">✕</button>
              </span>
            </template>
          </div>
        </template>

        <template v-if="favorites.length">
          <div class="section-label section-head public-label">
            <span><span class="nav-icon">☆</span>收藏词库</span>
            <span class="head-actions">
              <button class="mini-btn head-btn" :title="favCollapsed ? '展开' : '折叠'"
                @click="favCollapsed = !favCollapsed">{{ favCollapsed ? '›' : '⌄' }}</button>
            </span>
          </div>
          <template v-if="!favCollapsed">
            <div v-for="lib in favorites" :key="'fav-' + lib.id" class="nav-item library-item"
              :class="{ active: activeLibraryId === lib.id }" @click="selectLibrary(lib.id)">
              <span class="lib-name">{{ lib.name }}</span>
              <span class="lib-count">{{ lib.word_count }}</span>
              <span class="lib-actions">
                <button class="mini-btn" title="取消收藏" @click.stop="toggleFavorite(lib)">✕</button>
              </span>
            </div>
          </template>
        </template>
      </div>
    </aside>

    <!-- 中间：推荐页 / 单词（歌曲）列表 -->
    <section class="content">
      <!-- 推荐页：公共词库卡片墙 -->
      <template v-if="activeLibraryId === 'discover'">
        <header class="content-header">
          <div class="header-titles">
            <h1 class="view-title">推荐</h1>
            <span class="view-sub">{{ publicLibraries.length }} 个词库</span>
          </div>
        </header>
        <div class="table-wrap discover">
          <template v-for="group in groupedPublic" :key="group.name">
            <h2 class="group-title">{{ group.name }}</h2>
            <div class="card-grid">
              <div v-for="lib in group.libs" :key="lib.id" class="lib-card" @click="selectLibrary(lib.id)">
                <div class="card-cover" :style="cardGradient(lib.name)">
                  <span class="card-initial">{{ lib.name.slice(0, 2) }}</span>
                  <div class="card-hover">
                    <button class="card-btn" title="播放" @click.stop="playLibrary(lib)">▶</button>
                    <button class="card-btn" :class="{ faved: lib.favorited }" :title="lib.favorited ? '取消收藏' : '收藏'"
                      @click.stop="toggleFavorite(lib)">
                      {{ lib.favorited ? '★' : '☆' }}
                    </button>
                  </div>
                </div>
                <div class="card-name">{{ lib.name }}</div>
                <div class="card-count">{{ lib.word_count }} 词</div>
              </div>
            </div>
          </template>
        </div>
      </template>

      <template v-else>
        <header class="content-header">
          <div class="header-titles">
            <h1 class="view-title">{{ activeLibraryName }}</h1>
            <span class="view-sub">{{ viewTotal }} 个单词</span>
          </div>
          <div class="header-actions">
            <button v-if="activePublicLib" class="fav-toggle-btn" :class="{ faved: activePublicLib.favorited }"
              @click="toggleFavorite(activePublicLib)">
              {{ activePublicLib.favorited ? '★ 已收藏' : '☆ 收藏' }}
            </button>
            <input v-model="filterText" class="filter-input" placeholder="筛选单词…" />
            <button class="play-all-btn" :disabled="!words.length" @click="playFrom()">▶ 播放</button>
          </div>
        </header>

        <div class="table-wrap" @click="openMenuWordId = null">
          <table class="word-table">
            <thead>
              <tr>
                <th class="col-idx">#</th>
                <th>单词</th>
                <th class="col-phonetic">音标</th>
                <th>释义</th>
                <th class="col-ops"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(w, i) in words" :key="w.id" :class="{ playing: isPlayingRow(w) }"
                @dblclick="playFrom(i)">
                <td class="col-idx">
                  <span v-if="isPlayingRow(w)" class="equalizer" :class="{ paused: !pb.playing }">
                    <i></i><i></i><i></i>
                  </span>
                  <span v-else class="row-num">{{ (viewPage - 1) * PAGE_SIZE + i + 1 }}</span>
                  <button class="row-play" title="从这里播放" @click="playFrom(i)">▶</button>
                </td>
                <td class="col-word">{{ w.word }}</td>
                <td class="col-phonetic">{{ w.us_pronunciation || w.en_pronunciation }}</td>
                <td class="col-meaning">
                  <span v-for="(m, mi) in w.meaning" :key="mi" class="meaning-item">
                    <i class="pos">{{ m.type }}</i>{{ m.content }}
                  </span>
                </td>
                <td class="col-ops">
                  <!-- 未掌握标记：类似"我喜欢"，加入后随时在「未掌握」词库复习 -->
                  <button class="op-btn heart-btn" :class="{ on: reviewWordIds.has(w.id) }"
                    :title="reviewWordIds.has(w.id) ? '已掌握，移出复习' : '标记未掌握'" @click.stop="toggleReview(w)">
                    <img class="like-icon" :src="reviewWordIds.has(w.id) ? likeOnIcon : likeOffIcon" alt="" />
                  </button>
                  <!-- 自己的词库里是"移出"；全部单词和公共推荐词库里是"加入我的词库" -->
                  <template v-if="!isOwnLibraryView">
                    <button class="op-btn" title="加入词库"
                      @click.stop="openMenuWordId = openMenuWordId === w.id ? null : w.id">＋</button>
                    <div v-if="openMenuWordId === w.id" class="lib-menu" @click.stop>
                      <div v-for="lib in libraries" :key="lib.id" class="lib-menu-item" @click="addToLibrary(w, lib)">
                        {{ lib.name }}
                      </div>
                    </div>
                  </template>
                  <button v-else class="op-btn" title="移出词库" @click="removeFromLibrary(w)">✕</button>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-if="!loading && !words.length" class="empty">
            {{ filterText ? '没有匹配的单词' : activeLibraryId === 'all' ? '还没有单词，划词查询后收藏即可入库' : '词库还是空的，去「全部单词」里把单词加进来' }}
          </div>
          <div v-if="totalPages > 1" class="pagination">
            <button class="page-btn" :disabled="viewPage <= 1" @click="fetchWords(viewPage - 1)">‹ 上一页</button>
            <span class="page-info">{{ viewPage }} / {{ totalPages }}</span>
            <button class="page-btn" :disabled="viewPage >= totalPages" @click="fetchWords(viewPage + 1)">下一页 ›</button>
          </div>
        </div>
      </template>

      <!-- 底部：播放条（参考酷狗/QQ音乐：控制钮最左，功能按钮靠右） -->
      <footer class="player-bar">
        <div class="transport">
          <button class="t-btn" title="上一个" :disabled="!pb.total" @click="electronAPI?.playbackPrev()">⏮</button>
          <button class="t-btn t-play" :title="pb.playing ? '暂停' : '播放'" @click="togglePlay">
            {{ pb.playing ? '⏸' : '▶' }}
          </button>
          <button class="t-btn" title="下一个" :disabled="!pb.total" @click="electronAPI?.playbackNext()">⏭</button>
        </div>

        <div class="now-playing">
          <transition name="fade" mode="out-in">
            <div v-if="pb.currentWord" class="now-word" :key="pb.currentWord.id || pb.currentWord.word">
              <div class="now-title">{{ pb.currentWord.word }}</div>
              <div class="now-sub">
                {{ firstMeaning(pb.currentWord) }}
              </div>
            </div>
            <div v-else class="now-word">
              <div class="now-sub">选一个词库，像放歌一样背单词</div>
            </div>
          </transition>
          <span class="playing-from" v-if="pb.total">{{ pb.libraryName }} · {{ pb.position }}/{{ pb.total }}</span>
        </div>

        <div class="bar-right">
          <button class="t-btn heart-btn" v-if="pb.currentWord" :class="{ on: reviewWordIds.has(pb.currentWord.id) }"
            :title="reviewWordIds.has(pb.currentWord.id) ? '已掌握' : '标记未掌握'" @click="toggleReview(pb.currentWord)">
            <img class="like-icon like-icon-lg" :src="reviewWordIds.has(pb.currentWord.id) ? likeOnIcon : likeOffIcon"
              alt="" />
          </button>
          <button class="mode-icon-btn" :title="modeMeta.title" @click="cycleMode">
            <img :src="modeMeta.icon" :alt="modeMeta.title" />
          </button>
          <button class="mode-btn" :class="{ on: pb.audioEnabled }" title="切换单词时播放发音"
            @click="electronAPI?.setAudio(!pb.audioEnabled)">
            发音
          </button>
          <button class="mode-btn" :class="{ on: pb.barVisible }" title="桌面词幕" @click="electronAPI?.toggleBar()">
            词幕
          </button>
        </div>
      </footer>
    </section>

    <transition name="fade">
      <div v-if="toast" class="toast">{{ toast }}</div>
    </transition>
  </div>
</template>

<script setup>
import { ref, computed, reactive, watch, onMounted, onBeforeUnmount } from 'vue'
import http from '../api/http'
import { playWordAudio } from '../utils/audio'
import modeOrderIcon from '../assets/mode-order.png'
import modeSingleIcon from '../assets/mode-single.png'
import modeShuffleIcon from '../assets/mode-shuffle.png'
import likeOnIcon from '../assets/like-on.png'
import likeOffIcon from '../assets/like-off.png'

const electronAPI = window.electronAPI

const user = ref(null)
const libraries = ref([])
const publicLibraries = ref([])
const favorites = ref([])
const words = ref([])
const loading = ref(false)
const activeLibraryId = ref('discover')
const filterText = ref('')
const openMenuWordId = ref(null)

// 单词列表分页：视图与播放都按页取（每页 100）
const PAGE_SIZE = 100
const viewPage = ref(1)
const viewTotal = ref(0)

const creatingLibrary = ref(false)
const newLibraryName = ref('')
const renamingId = ref(null)
const renameText = ref('')
const ownCollapsed = ref(false)
const favCollapsed = ref(false)

// 系统默认词库：不可改名/删除；未掌握=复习清单（对标"我喜欢"歌单）
const PROTECTED_LIBS = ['默认收藏', '未掌握']
const reviewWordIds = ref(new Set())

const toast = ref('')
let toastTimer = null
let unsubscribe = null
let unsubscribeAudio = null
let unsubscribeCollected = null

// 主进程播放状态镜像
const pb = reactive({
  libraryId: null,
  libraryName: '',
  index: -1,
  total: 0,
  position: 0,
  playing: false,
  mode: 'shuffle',
  audioEnabled: true,
  barVisible: false,
  currentWord: null
})

// 播放模式：点击循环切换，只显示图标（列表循环 → 单词循环 → 随机）
const MODES = ['order', 'single', 'shuffle']
const MODE_META = {
  order: { icon: modeOrderIcon, title: '列表循环' },
  single: { icon: modeSingleIcon, title: '单词循环（重复读当前词）' },
  shuffle: { icon: modeShuffleIcon, title: '随机播放' }
}
const modeMeta = computed(() => MODE_META[pb.mode] || MODE_META.shuffle)

function cycleMode() {
  const next = MODES[(MODES.indexOf(pb.mode) + 1) % MODES.length]
  electronAPI?.setMode(next)
}

const vFocus = { mounted: (el) => el.focus() }

const activeLibraryName = computed(() => {
  if (activeLibraryId.value === 'all') return '全部单词'
  return (
    libraries.value.find((l) => l.id === activeLibraryId.value)?.name ||
    publicLibraries.value.find((l) => l.id === activeLibraryId.value)?.name ||
    ''
  )
})

// 当前视图是否是"自己的词库"（决定行操作是移出还是加入）
const isOwnLibraryView = computed(() =>
  libraries.value.some((l) => l.id === activeLibraryId.value)
)

// 默认词库（默认收藏、未掌握）置顶
const sortedLibraries = computed(() =>
  [...libraries.value].sort((a, b) => {
    const ia = PROTECTED_LIBS.indexOf(a.name)
    const ib = PROTECTED_LIBS.indexOf(b.name)
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  })
)

const reviewLib = computed(() => libraries.value.find((l) => l.name === '未掌握') || null)

// 当前视图对应的公共词库（头部显示收藏按钮）
const activePublicLib = computed(() =>
  publicLibraries.value.find((l) => l.id === activeLibraryId.value) || null
)

// 推荐页分组：按 description（考试词库/主题词库）
const groupedPublic = computed(() => {
  const order = ['考试词库', '主题词库']
  const groups = {}
  for (const lib of publicLibraries.value) {
    const key = lib.description || '其他'
      ; (groups[key] = groups[key] || []).push(lib)
  }
  return Object.keys(groups)
    .sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b)
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
    })
    .map((name) => ({ name, libs: groups[name] }))
})

// 卡片封面：按词库名生成稳定的渐变色
function cardGradient(name) {
  let h = 0
  for (const c of name) h = (h * 31 + c.codePointAt(0)) % 360
  return { background: `linear-gradient(135deg, hsl(${h}, 45%, 38%), hsl(${(h + 45) % 360}, 55%, 24%))` }
}

// 筛选走服务端搜索（分页后客户端只能筛当前页），输入防抖 300ms
let filterTimer = null
watch(filterText, () => {
  clearTimeout(filterTimer)
  filterTimer = setTimeout(() => fetchWords(1), 300)
})

const totalPages = computed(() => Math.max(1, Math.ceil(viewTotal.value / PAGE_SIZE)))

function showToast(msg) {
  toast.value = msg
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 2000)
}

function firstMeaning(word) {
  const m = (word.meaning || [])[0]
  return m ? `${m.type} ${m.content}` : ''
}

function isPlayingRow(w) {
  return (
    pb.currentWord &&
    pb.currentWord.id === w.id &&
    String(pb.libraryId) === String(activeLibraryId.value)
  )
}

async function fetchUser() {
  const res = await http.get('/auth/me')
  if (res.data.code === 200) user.value = res.data.data
}

async function fetchLibraries() {
  const res = await http.get('/libraries/list')
  if (res.data.code === 200) libraries.value = res.data.data
}

async function fetchPublicLibraries() {
  const res = await http.get('/libraries/public')
  if (res.data.code === 200) publicLibraries.value = res.data.data
}

async function fetchFavorites() {
  const res = await http.get('/libraries/favorites')
  if (res.data.code === 200) favorites.value = res.data.data
}

async function toggleFavorite(lib) {
  const url = lib.favorited ? '/libraries/unfavorite' : '/libraries/favorite'
  const res = await http.post(url, { library_id: lib.id })
  if (res.data.code === 200) {
    showToast(lib.favorited ? `已取消收藏「${lib.name}」` : `已收藏「${lib.name}」`)
    await Promise.all([fetchPublicLibraries(), fetchFavorites()])
  } else {
    showToast(res.data.msg)
  }
}

// 推荐页卡片上的 ▶：拉第一页开播（主进程播完当页会自动翻页），不切视图
async function playLibrary(lib) {
  const res = await http.get(`/libraries/${lib.id}/words`, {
    params: { page: 1, page_size: PAGE_SIZE }
  })
  const data = res.data.code === 200 ? res.data.data : null
  if (!data || !data.list.length) {
    showToast(res.data.msg || '词库是空的')
    return
  }
  electronAPI?.startPlayback({
    libraryId: lib.id,
    libraryName: lib.name,
    words: data.list,
    page: 1,
    pageSize: PAGE_SIZE,
    total: data.total,
    pageable: true
  })
}

async function fetchWords(page = 1) {
  if (activeLibraryId.value === 'discover') return
  loading.value = true
  try {
    const url =
      activeLibraryId.value === 'all'
        ? '/words/list'
        : `/libraries/${activeLibraryId.value}/words`
    const search = filterText.value.trim()
    const res = await http.get(url, {
      params: { page, page_size: PAGE_SIZE, ...(search ? { search } : {}) }
    })
    if (res.data.code === 200 && res.data.data) {
      words.value = res.data.data.list || []
      viewTotal.value = res.data.data.total || 0
      viewPage.value = res.data.data.page || page
    } else {
      words.value = []
      viewTotal.value = 0
    }
  } finally {
    loading.value = false
  }
}

function selectLibrary(id) {
  if (activeLibraryId.value === id) return
  activeLibraryId.value = id
  filterText.value = ''
  openMenuWordId.value = null
  fetchWords(1)
}

// ---------- 播放 ----------
// 传当前页给主进程；无筛选时可翻页（播完 100 条自动拉下一页）
function playFrom(index) {
  const list = words.value
  if (!list.length) return
  electronAPI?.startPlayback({
    libraryId: activeLibraryId.value,
    libraryName: activeLibraryName.value,
    words: JSON.parse(JSON.stringify(list)),
    startIndex: Number.isInteger(index) ? index : undefined,
    page: viewPage.value,
    pageSize: PAGE_SIZE,
    total: filterText.value.trim() ? list.length : viewTotal.value,
    pageable: !filterText.value.trim()
  })
}

function togglePlay() {
  if (!pb.total) {
    playFrom()
    return
  }
  electronAPI?.setPlaying(!pb.playing)
}

// ---------- 未掌握（复习）标记 ----------
async function fetchReviewWordIds() {
  if (!reviewLib.value) return
  const res = await http.get(`/libraries/${reviewLib.value.id}/words`, {
    params: { page: 1, page_size: 10000 }
  })
  if (res.data.code === 200 && res.data.data) {
    reviewWordIds.value = new Set((res.data.data.list || []).map((w) => w.id))
  }
}

async function toggleReview(word) {
  if (!reviewLib.value) return
  const marked = reviewWordIds.value.has(word.id)
  const url = marked ? '/libraries/remove-word' : '/libraries/add-word'
  const res = await http.post(url, { library_id: reviewLib.value.id, word_id: word.id })
  if (res.data.code === 200) {
    const next = new Set(reviewWordIds.value)
    marked ? next.delete(word.id) : next.add(word.id)
    reviewWordIds.value = next
    showToast(marked ? `已掌握「${word.word}」` : `「${word.word}」已加入未掌握`)
    // 正在看未掌握词库时，标记已掌握直接从列表移除
    if (marked && activeLibraryId.value === reviewLib.value.id) {
      words.value = words.value.filter((w) => w.id !== word.id)
      viewTotal.value = Math.max(0, viewTotal.value - 1)
    }
    fetchLibraries()
  } else {
    showToast(res.data.msg)
  }
}

// ---------- 词库管理 ----------
function startCreate() {
  ownCollapsed.value = false
  creatingLibrary.value = true
}

async function confirmCreate() {
  const name = newLibraryName.value.trim()
  creatingLibrary.value = false
  if (!name) return
  const res = await http.post('/libraries/add', { name })
  if (res.data.code === 200) {
    newLibraryName.value = ''
    await fetchLibraries()
  } else {
    showToast(res.data.msg)
  }
}

function startRename(lib) {
  renamingId.value = lib.id
  renameText.value = lib.name
}

async function confirmRename(lib) {
  const name = renameText.value.trim()
  renamingId.value = null
  if (!name || name === lib.name) return
  const res = await http.post(`/libraries/update?library_id=${lib.id}`, { name })
  if (res.data.code === 200) {
    await fetchLibraries()
  } else {
    showToast(res.data.msg)
  }
}

async function removeLibrary(lib) {
  if (!window.confirm(`删除词库「${lib.name}」？（单词本身会保留）`)) return
  const res = await http.post(`/libraries/delete?library_id=${lib.id}`)
  if (res.data.code === 200) {
    if (activeLibraryId.value === lib.id) {
      activeLibraryId.value = 'all'
      fetchWords()
    }
    await fetchLibraries()
  } else {
    showToast(res.data.msg)
  }
}

async function addToLibrary(word, lib) {
  openMenuWordId.value = null
  const res = await http.post('/libraries/add-word', { library_id: lib.id, word_id: word.id })
  showToast(res.data.code === 200 ? `已加入「${lib.name}」` : res.data.msg)
  if (res.data.code === 200) fetchLibraries()
}

async function removeFromLibrary(word) {
  const res = await http.post('/libraries/remove-word', {
    library_id: activeLibraryId.value,
    word_id: word.id
  })
  if (res.data.code === 200) {
    words.value = words.value.filter((w) => w.id !== word.id)
    fetchLibraries()
  } else {
    showToast(res.data.msg)
  }
}

onMounted(async () => {
  const state = await electronAPI?.getPlaybackState()
  if (state) Object.assign(pb, state)
  unsubscribe = electronAPI?.onPlaybackState((state) => Object.assign(pb, state))
  unsubscribeAudio = electronAPI?.onPlayAudio(playWordAudio)
  // 划词弹窗收藏成功 → 刷新列表和词库计数
  unsubscribeCollected = electronAPI?.onWordCollected((word) => {
    fetchWords(viewPage.value)
    fetchLibraries()
    if (word && word.word) showToast(`已收藏「${word.word}」`)
  })

  fetchUser()
  fetchPublicLibraries()
  fetchFavorites()
  await fetchLibraries()
  fetchReviewWordIds()
  await fetchWords()
})

onBeforeUnmount(() => {
  if (unsubscribe) unsubscribe()
  if (unsubscribeAudio) unsubscribeAudio()
  if (unsubscribeCollected) unsubscribeCollected()
  clearTimeout(toastTimer)
})
</script>

<style scoped>
.player {
  --bg-deep: #12141d;
  --bg-side: #0d0f16;
  --bg-raised: #1a1e2a;
  --line: rgba(255, 255, 255, 0.06);
  --text: #e8ebf2;
  --dim: #8a90a3;
  --accent: #35a5ff;
  --accent-soft: rgba(53, 165, 255, 0.12);

  display: grid;
  grid-template-columns: 210px 1fr;
  width: 100%;
  height: 100vh;
  background: var(--bg-deep);
  color: var(--text);
  text-align: left;
  overflow: hidden;
  user-select: none;
}

/* ---------- 滚动条：深色细条，不显示默认白色轨道 ---------- */
.table-wrap::-webkit-scrollbar,
.library-list::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.table-wrap::-webkit-scrollbar-track,
.library-list::-webkit-scrollbar-track {
  background: transparent;
}

.table-wrap::-webkit-scrollbar-thumb,
.library-list::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.14);
  border-radius: 4px;
}

.table-wrap::-webkit-scrollbar-thumb:hover,
.library-list::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.28);
}

.table-wrap::-webkit-scrollbar-corner,
.library-list::-webkit-scrollbar-corner {
  background: transparent;
}

/* ---------- 侧栏 ---------- */
.sidebar {
  background: var(--bg-side);
  border-right: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* 顶部留白给 macOS 红绿灯，兼作窗口拖拽区 */
.drag-strip {
  height: 40px;
  flex-shrink: 0;
  -webkit-app-region: drag;
}

.user {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 16px 16px;
}

.avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  overflow: hidden;
  background: var(--accent-soft);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  flex-shrink: 0;
}

.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.user-name {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav-section {
  padding: 0 8px;
}

.section-label {
  padding: 18px 16px 6px;
  font-size: 11px;
  letter-spacing: 0.12em;
  color: var(--dim);
}

.public-label {
  padding-left: 8px;
}

/* 分区头：标题 + 右侧操作（新建/折叠），对标"自建歌单 ⊕ ⌄"；
   字号/图标与「推荐」导航一致，子项更小更暗以示层级 */
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 14px 6px 18px;
  font-size: 13px;
  letter-spacing: normal;
  color: #c9cedb;
}

.section-head .nav-icon {
  width: 16px;
  display: inline-block;
  text-align: center;
  margin-right: 6px;
  color: var(--dim);
}

.nav-item.library-item {
  font-size: 12px;
  color: var(--dim);
  padding-left: 32px;
}

.head-actions {
  display: flex;
  gap: 4px;
}

.head-btn {
  font-size: 13px;
  line-height: 1;
}

/* 未掌握标记：已标记的红心常显，未标记 hover 才出现 */
.heart-btn.on {
  visibility: visible;
}

.like-icon {
  width: 15px;
  height: 15px;
  display: block;
  /* 黑色未标记心反色成灰，红色已标记心原样显示（.on 时去掉滤镜） */
  filter: invert(58%);
  transition: filter 0.15s ease;
}

.heart-btn:hover .like-icon {
  filter: invert(80%);
}

.heart-btn.on .like-icon,
.heart-btn.on:hover .like-icon {
  filter: none;
}

.like-icon-lg {
  width: 17px;
  height: 17px;
}

.library-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px 12px;
  min-height: 0;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  color: var(--dim);
  position: relative;
}

.nav-item:hover {
  background: var(--bg-raised);
  color: var(--text);
}

.nav-item.active {
  background: var(--accent-soft);
  color: var(--accent);
}

.nav-icon {
  width: 16px;
  text-align: center;
}

.lib-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lib-count {
  font-size: 11px;
  color: var(--dim);
}

.lib-actions {
  display: none;
  gap: 2px;
}

.library-item:hover .lib-actions {
  display: flex;
}

.library-item:hover .lib-count {
  display: none;
}

.mini-btn {
  border: none;
  background: none;
  color: var(--dim);
  cursor: pointer;
  font-size: 12px;
  padding: 0 3px;
}

.mini-btn:hover {
  color: var(--accent);
}

.add-library {
  color: var(--dim);
  font-size: 12px;
}

.inline-input {
  width: 100%;
  background: var(--bg-raised);
  border: 1px solid var(--accent);
  border-radius: 4px;
  color: var(--text);
  font-size: 13px;
  padding: 3px 6px;
  outline: none;
}

/* ---------- 内容区 ---------- */
.content {
  display: grid;
  grid-template-rows: auto 1fr auto;
  min-width: 0;
  min-height: 0;
}

.content-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  padding: 40px 24px 14px;
  -webkit-app-region: drag;
}

.header-titles {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.view-title {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
}

.view-sub {
  font-size: 12px;
  color: var(--dim);
}

.header-actions {
  display: flex;
  gap: 10px;
  -webkit-app-region: no-drag;
}

.filter-input {
  width: 160px;
  background: var(--bg-raised);
  border: 1px solid var(--line);
  border-radius: 14px;
  color: var(--text);
  font-size: 12px;
  padding: 6px 12px;
  outline: none;
}

.filter-input:focus {
  border-color: var(--accent);
}

.play-all-btn {
  border: none;
  border-radius: 14px;
  background: var(--accent);
  color: #fff;
  font-size: 13px;
  padding: 6px 16px;
  cursor: pointer;
}

.play-all-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.table-wrap {
  overflow-y: auto;
  min-height: 0;
  padding: 0 12px;
}

.word-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.word-table th {
  position: sticky;
  top: 0;
  background: var(--bg-deep);
  text-align: left;
  font-size: 11px;
  font-weight: 500;
  color: var(--dim);
  padding: 6px 10px;
  border-bottom: 1px solid var(--line);
  z-index: 1;
}

.word-table td {
  padding: 9px 10px;
  border-bottom: 1px solid var(--line);
  vertical-align: middle;
}

.word-table tbody tr:hover {
  background: var(--bg-raised);
}

.word-table tbody tr.playing {
  color: var(--accent);
}

.col-idx {
  width: 44px;
  color: var(--dim);
  position: relative;
}

.row-num {
  font-variant-numeric: tabular-nums;
}

.row-play {
  display: none;
  position: absolute;
  left: 6px;
  top: 50%;
  transform: translateY(-50%);
  border: none;
  background: none;
  color: var(--accent);
  cursor: pointer;
  font-size: 12px;
}

tr:hover .row-num {
  visibility: hidden;
}

tr:hover .row-play {
  display: block;
}

/* 单词像词典词条：衬线体 */
.col-word {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 15px;
  font-weight: 600;
  width: 180px;
}

.col-phonetic {
  width: 150px;
  color: var(--dim);
  font-size: 12px;
}

.col-meaning {
  max-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dim);
}

tr.playing .col-meaning,
tr.playing .col-phonetic {
  color: var(--accent);
  opacity: 0.85;
}

.meaning-item {
  margin-right: 10px;
}

.pos {
  font-style: normal;
  color: var(--accent);
  margin-right: 3px;
  opacity: 0.9;
}

.col-ops {
  width: 84px;
  text-align: right;
  white-space: nowrap;
  position: relative;
}

.col-ops .op-btn+.op-btn,
.col-ops .op-btn+.lib-menu+.op-btn {
  margin-left: 8px;
}

.op-btn {
  visibility: hidden;
  border: none;
  background: none;
  color: var(--dim);
  font-size: 14px;
  cursor: pointer;
}

tr:hover .op-btn {
  visibility: visible;
}

.op-btn:hover {
  color: var(--accent);
}

.lib-menu {
  position: absolute;
  right: 30px;
  top: 50%;
  transform: translateY(-50%);
  background: var(--bg-raised);
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  z-index: 5;
  min-width: 120px;
  overflow: hidden;
}

.lib-menu-item {
  padding: 7px 12px;
  font-size: 12px;
  color: var(--text);
  cursor: pointer;
  white-space: nowrap;
}

.lib-menu-item:hover {
  background: var(--accent-soft);
  color: var(--accent);
}

.empty {
  padding: 60px 0;
  text-align: center;
  color: var(--dim);
  font-size: 13px;
}

.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 14px 0 18px;
}

.page-btn {
  border: 1px solid var(--line);
  border-radius: 12px;
  background: none;
  color: var(--dim);
  font-size: 12px;
  padding: 5px 12px;
  cursor: pointer;
}

.page-btn:hover:not(:disabled) {
  color: var(--accent);
  border-color: var(--accent);
}

.page-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.page-info {
  font-size: 12px;
  color: var(--dim);
  font-variant-numeric: tabular-nums;
}

/* ---------- 推荐页卡片墙 ---------- */
.discover {
  padding: 0 24px 24px;
}

.group-title {
  font-size: 15px;
  font-weight: 700;
  margin: 18px 0 12px;
}

.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  gap: 16px;
}

.lib-card {
  cursor: pointer;
}

.card-cover {
  position: relative;
  aspect-ratio: 1;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  transition: transform 0.15s ease;
}

.lib-card:hover .card-cover {
  transform: translateY(-2px);
}

.card-initial {
  font-size: 34px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.9);
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
}

.card-hover {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: rgba(0, 0, 0, 0.42);
  opacity: 0;
  transition: opacity 0.15s ease;
}

.lib-card:hover .card-hover {
  opacity: 1;
}

.card-btn {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
  font-size: 15px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(4px);
}

.card-btn:hover {
  background: var(--accent);
}

.card-btn.faved {
  color: #f5c451;
}

.card-name {
  margin-top: 8px;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-count {
  margin-top: 2px;
  font-size: 11px;
  color: var(--dim);
}

.fav-toggle-btn {
  border: 1px solid var(--line);
  border-radius: 14px;
  background: none;
  color: var(--dim);
  font-size: 12px;
  padding: 6px 12px;
  cursor: pointer;
}

.fav-toggle-btn:hover {
  color: var(--text);
}

.fav-toggle-btn.faved {
  border-color: rgba(245, 196, 81, 0.5);
  color: #f5c451;
}

/* ---------- 播放条（控制钮最左） ---------- */
.player-bar {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 18px;
  padding: 10px 20px;
  background: var(--bg-side);
  border-top: 1px solid var(--line);
}

.now-playing {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 14px;
}

.mode-icon-btn {
  border: none;
  background: none;
  padding: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
}

.mode-icon-btn img {
  width: 18px;
  height: 18px;
  /* 黑色图标反色成浅灰，适配深色播放条 */
  filter: invert(62%);
  transition: filter 0.15s ease;
}

.mode-icon-btn:hover img {
  filter: invert(85%);
}

.now-title {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 17px;
  font-weight: 700;
}

.now-sub {
  font-size: 12px;
  color: var(--dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 320px;
}

.transport {
  display: flex;
  align-items: center;
  gap: 14px;
}

.t-btn {
  border: none;
  background: none;
  color: var(--text);
  font-size: 16px;
  cursor: pointer;
  padding: 4px;
}

.t-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

.t-btn:hover:not(:disabled) {
  color: var(--accent);
}

.t-play {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  font-size: 15px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.t-play:hover:not(:disabled) {
  color: #fff;
  filter: brightness(1.12);
}

.bar-right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}

.playing-from {
  font-size: 11px;
  color: var(--dim);
}

.mode-btn {
  border: 1px solid var(--line);
  border-radius: 12px;
  background: none;
  color: var(--dim);
  font-size: 11px;
  padding: 4px 10px;
  cursor: pointer;
}

.mode-btn:hover {
  color: var(--text);
}

.mode-btn.on {
  border-color: var(--accent);
  color: var(--accent);
}

/* ---------- 正在播放的均衡器动画（签名元素） ---------- */
.equalizer {
  display: inline-flex;
  align-items: flex-end;
  gap: 2px;
  height: 12px;
}

.equalizer i {
  width: 3px;
  background: var(--accent);
  animation: eq-bounce 0.9s ease-in-out infinite;
}

.equalizer i:nth-child(2) {
  animation-delay: 0.25s;
}

.equalizer i:nth-child(3) {
  animation-delay: 0.5s;
}

.equalizer.paused i {
  animation-play-state: paused;
}

@keyframes eq-bounce {

  0%,
  100% {
    height: 4px;
  }

  50% {
    height: 12px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .equalizer i {
    animation: none;
    height: 8px;
  }
}

.toast {
  position: fixed;
  right: 20px;
  bottom: 76px;
  background: var(--bg-raised);
  border: 1px solid var(--line);
  color: var(--text);
  font-size: 12px;
  padding: 8px 14px;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  z-index: 10;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
