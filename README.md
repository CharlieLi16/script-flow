# Script Flow

本地剧本时间线工具：横轴节点、剧情编辑、一键 AI 出图（OpenAI / Nano Banana）。

## 快速开始

```bash
cp .env.example .env
# 编辑 .env，填入 OPENAI_API_KEY 和/或 GEMINI_API_KEY

npm install
npm start
```

浏览器打开 **http://localhost:3847**

## 功能

- 水平时间线，节点上下交替（对齐草图布局）
- 点击节点编辑：标题、时间标记、剧情正文
- 顶部保存/删除操作，支持 `Ctrl+S`（macOS 为 `⌘S`）和可记忆的自动保存开关
- 右上角「预览」：按节点时长播放 animatic，支持字幕、运镜预设、暂停、跳转
- 上传分镜图，或选模型 → 选参考图 → 写 prompt → 生成
- **翻页动画**：选 4/8/16 帧 → 从提词库套用模板 → 生成分镜表 → 后端裁切 → 按 FPS 播放（见 [docs/flipbook-prompt.md](docs/flipbook-prompt.md)）
- **设定集**：保存角色/场景参考图，出图时重复使用；支持参考图 input（Gemini 多图 / OpenAI 图生图）
- 拖拽节点排序
- 数据保存在 `data/timeline.json` 和 `data/images/`

## 配置

| 变量 | 说明 |
|------|------|
| `PORT` | 服务端口，默认 3847 |
| `OPENAI_API_KEY` | OpenAI Images（gpt-image-2 / dall-e-3） |
| `GEMINI_API_KEY` | Google Gemini Nano Banana 出图 |

至少配置一个 API key 才能使用 AI 出图。

## 添加新的出图 Provider

见 [`.cursor/skills/add-image-provider/SKILL.md`](.cursor/skills/add-image-provider/SKILL.md)。

## 开发

```bash
npm run dev   # 带 --watch 热重载
```
