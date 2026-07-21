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
