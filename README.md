# Script Flow

本地优先的剧本时间线工具：横轴节点、剧情编辑、一键 AI 出图（OpenAI / Nano Banana）。支持 Vercel 部署，每位用户数据保存在浏览器本地，互不干扰。

## 快速开始（本地开发）

```bash
cp .env.example .env
# 填入 OPENAI_API_KEY、GEMINI_API_KEY、TEAM_ACCESS_CODE、AUTH_COOKIE_SECRET

npm install
npm run dev
```

浏览器打开 **http://localhost:3000**（Vercel Dev）

> 旧版单机 Express 服务仍可用：`npm run dev:legacy` → http://localhost:3847

## Vercel 部署

1. 将仓库导入 Vercel
2. 在 Environment Variables 中配置：
   - `OPENAI_API_KEY` / `GEMINI_API_KEY` — 团队共享 Key
   - `TEAM_ACCESS_CODE` — 团队访问码（公开访问时用于解锁共享 Key）
   - `AUTH_COOKIE_SECRET` — Cookie 签名密钥（随机字符串）
   - `BLOB_READ_WRITE_TOKEN` — 可选，临时生成结果存储
   - `TRIGGER_SECRET_KEY` / `TRIGGER_PROJECT_ID` — 可选，后台长任务
3. 部署后访问 Production URL

## 多用户与数据隔离

| 数据 | 存储位置 |
|------|----------|
| 时间线、设定集、提词库、素材 | 浏览器 IndexedDB（按项目隔离） |
| 图片/参考图 | IndexedDB Blob + 可选 Chrome/Edge 本地文件夹镜像 |
| 个人 API Key | 页面内存；可选口令加密保存在本机 |
| 团队 API Key | Vercel 环境变量，需输入团队访问码解锁（7 天 Cookie） |

- **新建/切换项目**：顶部项目菜单
- **导出/导入**：ZIP（含 manifest + 图片，不含 API Key）
- **本地文件夹**（Chrome/Edge）：选择目录后自动镜像项目

## API Key 模式

- **个人 Key（BYOK）**：公开访客默认模式，在 ⚙ 设置中填写 OpenAI/Gemini Key
- **团队 Key**：输入团队访问码后切换为团队模式，使用服务器配置的 Key

## 功能

- 水平时间线，节点上下交替
- 点击节点编辑：标题、时间标记、剧情正文
- 顶部保存/删除，支持 `Ctrl+S` 和自动保存
- 右上角「预览」：animatic 播放
- 上传分镜图，或 AI 出图 / 翻页动画 / 32 帧锚点接力
- **设定集**：参考图库，出图时复用
- 拖拽节点排序

## 配置

| 变量 | 说明 |
|------|------|
| `TEAM_ACCESS_CODE` | 团队访问码（明文，开发用） |
| `AUTH_COOKIE_SECRET` | HttpOnly Cookie 签名 |
| `OPENAI_API_KEY` | OpenAI Images |
| `GEMINI_API_KEY` | Google Gemini 出图 |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob 临时结果 |
| `TRIGGER_SECRET_KEY` | Trigger.dev 后台任务 |

## 种子素材

```bash
npm run seed:build   # 从 data/library.json + data/prompts.json 生成 seed/library-seed.json
```

新项目创建时会复制种子中的提词库和设定集元数据。

## 添加新的出图 Provider

见 [`.cursor/skills/add-image-provider/SKILL.md`](.cursor/skills/add-image-provider/SKILL.md)。

## 开发

```bash
npm run dev          # Vercel Dev（推荐）
npm run dev:legacy   # Express 单机模式
npm run trigger:dev  # Trigger.dev 本地 Worker
```
