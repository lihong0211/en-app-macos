# 拼读拆分设计(自然拼读教学)

## 背景 & 目标

单词、音标、整词发音都已具备(有道词典接口,`type=2` 美音),但都是"整体"呈现的。目标是补一层拼读教学:把单词拆成"字母段-音素"对应关系,朗读时先逐段读音素,再整体读一遍单词,帮助用户建立拼写和发音的对应关系(类似 phonics)。

英语拼写不规则(如 `school` 的 `ch` 对应 `/k/`,`oo` 对应 `/uː/`),不能按字母位置机械切分,需要 AI 辅助对齐。

## 涉及仓库

功能跨两个仓库:

- **service-ali**(后端,FastAPI + SQLAlchemy,`english_new` 库):负责生成并存储"字母段-音素"拆分数据
- **en-elctron**(本仓库,Electron 客户端):负责消费数据、播放音素音频、做拼读交互

**实施顺序**:先在 service-ali 落地拆分脚本、小样本验证通过后,再做 API 扩展和 en-elctron 前端部分。

## 一、后端数据模型(service-ali)

新增表,与 `roots`/`affixes` 平级(参考 `model/en_desktop/affixes.py` 的写法):

```python
# model/en_desktop/word_phonics.py
class EnDesktopWordPhonics(BaseEnDesktop, EnDesktopModel):
    __tablename__ = "word_phonics"

    word_id = Column(Integer, ForeignKey("words.id", ondelete="CASCADE"), nullable=False, unique=True)
    segments = Column(JSON, nullable=False)
    # [{ "letters": "sch", "ipa": "k" }, { "letters": "oo", "ipa": "uː" }, { "letters": "l", "ipa": "l" }]
```

`segments` 里 `ipa` 字段依次拼接需要等于(去掉重音符号 `ˈˌ` 后的)`us_pronunciation`;`letters` 依次拼接需要等于原词(忽略大小写)。这两条是生成脚本的硬校验规则。

## 二、生成脚本(service-ali)

`scripts/generate_phonics.py`,参照 `scripts/rebuild_roots_affixes.py` 的 `--dry-run`/`--apply` 模式:

1. 维护一份英语音素清单常量(约 44 个 IPA 符号,含双元音 `eɪ/aɪ/ɔɪ/...`、塞擦音 `tʃ/dʒ`,清单需要按最长匹配切分 IPA 字符串)
2. 遍历 `words` 表中还没有对应 `word_phonics` 记录的行(按 `id` 增量,支持后续新词跑增量批处理)
3. 对每个词,把 `word` + `us_pronunciation` 传给 LLM,要求返回字母段-音素对齐的 JSON
4. 用上面两条硬校验规则验证 LLM 返回结果;校验不通过的词跳过、记日志(词本身、LLM 返回、失败原因),不写入脏数据,不重试
5. `--dry-run` 只打印统计(成功/跳过数量、失败样例);`--apply` 真正写库
6. 先跑一个几十词的小样本(比如某个词库的高频 Top50),人工检查校验通过率和拆分质量,再考虑全量跑

失败/跳过的词,`word_phonics` 里没有记录,前端表现为该词没有拼读入口(见下文"降级")。

## 三、后端 API 扩展(service-ali)

不新开端点,在现有 `EnDesktopWord.to_dict()` 序列化里加一个 `phonics` 字段:

- 有对应 `word_phonics` 记录:`phonics: [{ "letters": "c", "ipa": "k" }, ...]`
- 没有记录:`phonics: null`

`/words/list`、`/words/{id}`、`/libraries/{id}/words` 这几个已有接口自然带上这个字段,前端按需读取。

## 四、音素音频资源(en-elctron)

- 约 44 个 IPA 符号对应固定音频文件,作为静态资源打进客户端(如 `src/render/src/assets/phonics/`),不经后端存储/分发
- 文件名用音素符号的安全编码(比如 `tʃ` → `tS.mp3` 或建一个 IPA→文件名映射表,避免特殊字符做文件名)
- 素材来源:优先找现成的开源/教学用 IPA 音标发音素材;缺的音素单独补录或替换,不需要一次性合成全部 44 个

## 五、前端交互(en-elctron)

- **入口**:词表每行 + 轮播面板,加"拼读"按钮;`phonics` 为 `null` 时不显示(不显示比置灰更干净,避免用户点了没反应)
- **视觉方案**:卡拉OK扫光——单词原位不放大不重排,IPA 音标行显示在单词上方,背景色按 `segments` 顺序依次扫过对应字母区间,音标行同步高亮当前音素
- **播放时序**:逐段扫光时播放对应本地音素音频 → 扫完一轮后调用现有 `playWordAudio(word)` 整词播一遍(有道接口逻辑不变)
- **降级**:`phonics` 为 `null` 时该词退化成现在的"整词发音"体验,不报错、不特殊提示

## 不做的事(明确排除)

- 不支持除英语外的其他语言拼读
- 不做用户自定义拆分/编辑功能
- 不做拼读跟读打分(用户读、AI 评分)
- 音素音频不做后端存储,不支持运行时动态换音色
