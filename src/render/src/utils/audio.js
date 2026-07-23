// 单词发音：有道词典发音接口（type=2 美音），源自 en-mini 的 playAudio。
// 例句发音：service-ali 离线批量生成的 mp3（url 来自 word.meaning[].sentence.audio_url）。
// 约定：音频失败绝不影响轮播——加载失败/被拒/超时全部静默跳过，只留 console 痕迹。
const YOUDAO_VOICE_URL = 'https://dict.youdao.com/dictvoice?type=2&audio='

let current = null

function stopCurrent() {
  // 快速切词/切句时先停掉上一个，不叠音；先摘掉事件回调再 pause/清 src，
  // 否则 src='' 会给旧 Audio 触发一个迟到的 error 事件，把已经不该再用的 onEnded 又调一次
  if (current) {
    current.onended = null
    current.onerror = null
    current.pause()
    current.src = ''
  }
}

export function playWordAudio(word, onEnded) {
  if (!word) {
    if (onEnded) onEnded()
    return
  }
  try {
    stopCurrent()
    const audio = new Audio(YOUDAO_VOICE_URL + encodeURIComponent(word))
    current = audio
    audio.onerror = () => {
      console.warn('发音加载失败:', word)
      if (current === audio && onEnded) onEnded()
    }
    audio.onended = () => {
      if (current === audio && onEnded) onEnded()
    }
    audio.play().catch((e) => {
      console.warn('发音播放失败:', word, e && e.message)
      if (current === audio && onEnded) onEnded()
    })
  } catch (e) {
    console.warn('发音异常:', word, e.message)
    if (onEnded) onEnded()
  }
}

export function playSentenceAudio(url, onEnded) {
  if (!url) {
    if (onEnded) onEnded()
    return
  }
  try {
    stopCurrent()
    const audio = new Audio(url)
    current = audio
    audio.onerror = () => {
      console.warn('例句发音加载失败:', url)
      if (current === audio && onEnded) onEnded()
    }
    audio.onended = () => {
      if (current === audio && onEnded) onEnded()
    }
    audio.play().catch((e) => {
      console.warn('例句发音播放失败:', url, e && e.message)
      if (current === audio && onEnded) onEnded()
    })
  } catch (e) {
    console.warn('例句发音异常:', url, e.message)
    if (onEnded) onEnded()
  }
}

// 取当前词第一条有 audio_url 的 meaning 对应的例句地址；没有就返回 null（调用方据此跳过，不报错）
export function firstSentenceAudioUrl(word) {
  const found = (word?.meaning || []).find((m) => m.sentence?.audio_url)
  return found ? found.sentence.audio_url : null
}

// 多义词：取全部有 audio_url 的例句（按 meaning 顺序），供逐条轮播播放
export function allSentences(word) {
  const meanings = Array.isArray(word?.meaning) ? word.meaning : []
  return meanings.filter((m) => m.sentence?.audio_url).map((m) => m.sentence)
}

// 依次播放一组例句；每条开播前回调 onEach（供 UI 展示当前例句文本），全部播完回调 onDone
export function playSentenceQueue(sentences, onEach, onDone) {
  let i = 0
  function next() {
    if (i >= sentences.length) {
      if (onDone) onDone()
      return
    }
    const sentence = sentences[i++]
    if (onEach) onEach(sentence)
    playSentenceAudio(sentence.audio_url, next)
  }
  next()
}
