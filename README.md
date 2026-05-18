# 歌词创作助手 · Chinese Poetry to Lyric

基于 **390,904 首** 中华古典诗词数据库构建的 AI 歌词创作工具。通过 RAG（检索增强生成）将本地诗词库与 DeepSeek 大模型结合，帮助创作者用古典意境写现代歌词。

---

## 核心功能

### 🎵 歌词创作助手（`lyric_app/`）
- **三栏编辑器**：标题 / 风格描述 / 歌词独立编辑，AI 逐字段更新
- **Diff 审阅**：AI 每次修改以代码审阅视图呈现（绿=新增 / 红=删除），可逐段接受或拒绝
- **RAG 检索**：输入关键词自动检索本地诗词库，以古典原文作为创作素材
- **Agent 扩展搜索**：直接匹配为空时，由 AI 生成相关词再二次检索
- **持久化任务**：所有任务和对话历史保存到本地磁盘，重启后完整恢复
- **历史抽屉**：左侧滑入面板，随时切换任意历史任务
- **快捷模板**：6 种预设创作框架（国风说唱 / 古韵戏腔 / 诗词故事融合 / 散文情歌 / 氛围民谣 / 小说主题曲 / 角色视角）
- **连续对话**：同一任务下历史保留，新建任务清空重来

### 🔍 关键词检索脚本（`search.py`）
全库搜索含指定关键词的诗词，结果保存到 `output/<关键词>.txt`：
```bash
python search.py 青青
```

---

## 快速开始

### 环境要求
- Python 3.9+
- [DeepSeek API Key](https://platform.deepseek.com/)

### 安装
```bash
cd lyric_app
pip install -r requirements.txt
```

### 启动
```bash
# Windows 双击
start.bat

# 或命令行
python lyric_app/app.py
```

浏览器打开 **http://localhost:4321**

### 首次配置
点击右上角 **⚙ 设置** → 填入 DeepSeek API Key → 保存

---

## 使用方式

| 输入 | 效果 |
|------|------|
| `青青` / `离别` 等关键词 | 自动 RAG 检索古诗 → 以检索结果为素材创作 |
| 选择模板 → 填入主题词 | 按模板风格创作，同样触发 RAG |
| `写一首思乡的古风歌曲` | 直接描述需求创作，跳过 RAG |
| 选中"歌词"字段 → 输入润色要求 | 仅修改歌词，其他字段不动 |
| 工具栏 ✨润色 / 🔄重写 / 💡续写 | 快捷操作当前歌词 |

---

## 项目结构

```
chinese-poetry2lyric/
├── lyric_app/              # 歌词创作 Web 应用
│   ├── app.py              # Flask 后端（API + SSE 流式输出）
│   ├── rag.py              # 本地诗词检索模块
│   ├── tasks/              # 持久化任务存储（JSON）
│   ├── templates/
│   │   └── index.html      # 前端页面
│   └── static/
│       ├── app.js          # 前端主逻辑（Diff 引擎 / 历史抽屉 / RAG）
│       └── styles.css      # VS Code Dark 风格样式
├── search.py               # 命令行关键词检索脚本
├── loader/datas.json       # 数据集配置
├── 全唐诗/                 # 唐诗宋诗数据
├── 宋词/                   # 全宋词数据
├── 诗经/ 楚辞/ 论语/ ...   # 其他古典文集
└── output/                 # search.py 检索结果输出
```

---

## 诗词数据集

本项目诗词数据来源于 [chinese-poetry/chinese-poetry](https://github.com/chinese-poetry/chinese-poetry)，共收录：

| 数据集 | 数量 |
|--------|------|
| 唐诗宋诗 | ~54,000 + ~260,000 首 |
| 全宋词 | ~21,000 首 |
| 五代花间集 / 南唐词 | ~800 首 |
| 元曲 | ~30,000 首 |
| 诗经 / 楚辞 / 论语 | 经典文献 |
| 纳兰性德 / 曹操诗集 | 个人全集 |
| 蒙学 | 三字经等蒙学典籍 |
| **合计** | **~390,904 首** |

---

## 技术栈

- **后端**：Flask + Requests（SSE 流式传输）
- **AI**：DeepSeek API（`deepseek-v4-flash` / `deepseek-v4-pro`）
- **检索**：本地 JSON 全文关键词匹配（模块级缓存）
- **前端**：原生 JS（无框架）+ LCS Diff 引擎
- **存储**：本地 JSON 文件（`lyric_app/tasks/`）

---

## License

诗词数据遵循原仓库 [MIT License](./LICENSE)。`lyric_app` 应用代码同为 MIT。
