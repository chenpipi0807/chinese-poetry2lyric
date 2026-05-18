import datetime
import json
import os
import re
import uuid
import requests
from flask import Flask, render_template, request, Response, jsonify

app = Flask(__name__)
app.secret_key = os.urandom(24)

CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")
TASKS_DIR   = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tasks")
DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions"

os.makedirs(TASKS_DIR, exist_ok=True)

# In-memory task store: task_id -> {history, context, created_at, updated_at}
tasks = {}


def _task_path(task_id):
    return os.path.join(TASKS_DIR, f"{task_id}.json")


def _save_task(task_id):
    task = tasks.get(task_id)
    if not task:
        return
    task["updated_at"] = datetime.datetime.now().isoformat()
    with open(_task_path(task_id), "w", encoding="utf-8") as f:
        json.dump(task, f, ensure_ascii=False, indent=2)


def _load_tasks_from_disk():
    for fname in sorted(os.listdir(TASKS_DIR)):
        if not fname.endswith(".json"):
            continue
        try:
            with open(os.path.join(TASKS_DIR, fname), encoding="utf-8") as f:
                data = json.load(f)
            tid = data.get("task_id", fname[:-5])
            data["task_id"] = tid
            tasks[tid] = data
        except Exception:
            pass


_load_tasks_from_disk()

SONGWRITING_RULES = """
创作法则（全局遵守）:

【歌词优先】用户的任何输入都应被视为歌词创作请求。即使用户只发了一个词、一句话，
也必须将其理解为创作意图，输出完整的歌词。不要反问、不要解释——直接写歌。

【结构完整】
每首歌必须具备完整的专业结构层次：
前奏段 → 主歌A → 主歌B → 副歌(高潮) → 间奏 → 主歌B'(变体) → 副歌(重复) → 尾声
主歌与副歌之间应有明显的情感与节奏递进。

【副歌传唱】
副歌至少包含 2-4 句核心重复句式，朗朗上口、节奏鲜明、易于记忆。
重复时可有微小变化，但主旋律句式保持一致。

【段落对仗】
相邻主歌段落应句数相近、句长对称，形成结构上的对仗美感。

【标点必加】
每句歌词末尾必须添加标点符号（。，！？），
标点是演唱的换气点和节奏断句，绝不可连续多句无标点。

【尾韵优先】
相邻句尾字尽量押韵（脚韵），但优先级为：
自然流畅的表达 > 押韵
不可为凑韵脚而扭曲句意或填入生僻词。

【文辞质量】
歌词用词优美、有文学感和画面感，避免口语大白话。
重复出现的关键词或句式应有递进、转折或深化意义。"""


# ─── Config ────────────────────────────────────────────────────────

def load_config():
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"api_key": "", "model": "deepseek-v4-flash"}


def save_config(data):
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# ─── Routes ────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/settings", methods=["GET"])
def get_settings():
    cfg = load_config()
    key = cfg.get("api_key", "")
    return jsonify({
        "api_key_set": bool(key),
        "api_key_preview": ("*" * 8 + key[-4:]) if len(key) >= 4 else "",
        "model": cfg.get("model", "deepseek-v4-flash"),
    })


@app.route("/api/settings", methods=["POST"])
def save_settings():
    data = request.json or {}
    cfg = load_config()
    if "api_key" in data:
        cfg["api_key"] = data["api_key"].strip()
    if "model" in data:
        cfg["model"] = data["model"]
    save_config(cfg)
    return jsonify({"ok": True})


@app.route("/api/test-key", methods=["POST"])
def test_key():
    data = request.json or {}
    api_key = data.get("api_key", "").strip() or load_config().get("api_key", "")
    if not api_key:
        return jsonify({"ok": False, "error": "未配置 API Key"})
    try:
        resp = requests.post(
            DEEPSEEK_API_URL,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={"model": "deepseek-v4-flash", "messages": [{"role": "user", "content": "Hi"}], "max_tokens": 1},
            timeout=10,
        )
        if resp.ok:
            return jsonify({"ok": True})
        err = resp.json().get("error", {}).get("message", resp.text[:200])
        return jsonify({"ok": False, "error": err})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})


@app.route("/api/task/new", methods=["POST"])
def new_task():
    task_id = uuid.uuid4().hex[:8]
    now = datetime.datetime.now().isoformat()
    tasks[task_id] = {
        "task_id": task_id,
        "history": [],
        "context": {"title": "", "style": "", "lyrics": ""},
        "created_at": now,
        "updated_at": now,
    }
    _save_task(task_id)
    return jsonify({"task_id": task_id})


@app.route("/api/rag/search", methods=["POST"])
def rag_search():
    from rag import search_poems
    keyword = (request.json or {}).get("keyword", "").strip()
    if not keyword:
        return jsonify({"results": [], "keyword": keyword, "count": 0})
    results = search_poems(keyword, max_results=8)
    return jsonify({"results": results, "keyword": keyword, "count": len(results)})


@app.route("/api/rag/agent-search", methods=["POST"])
def rag_agent_search():
    """When primary search returns nothing, agent generates related keywords and searches again."""
    from rag import search_poems
    data = request.json or {}
    keyword = data.get("keyword", "").strip()
    api_key = load_config().get("api_key", "")

    if not keyword or not api_key:
        return jsonify({"results": [], "keywords": []})

    # Ask AI for related classical poetry search terms
    related_keywords = []
    try:
        resp = requests.post(
            DEEPSEEK_API_URL,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": "deepseek-v4-flash",
                "messages": [{
                    "role": "user",
                    "content": (
                        f"在古典诗词数据库中搜索关键词「{keyword}」未找到结果。"
                        "请给出3个与之相关的古典诗词搜索词（词牌名、意象词、情感词等），"
                        "每行一个词，只输出词，不要解释。"
                    ),
                }],
                "max_tokens": 50,
                "temperature": 0.3,
            },
            timeout=15,
        )
        text = resp.json()["choices"][0]["message"]["content"].strip()
        related_keywords = [k.strip().strip("·—-1234567890.。、") for k in text.split("\n") if k.strip()][:3]
    except Exception:
        pass

    all_results = []
    for kw in related_keywords:
        for r in search_poems(kw, max_results=4):
            r["matched_keyword"] = kw
            all_results.append(r)
        if len(all_results) >= 8:
            break

    return jsonify({"results": all_results[:8], "keywords": related_keywords})


@app.route("/api/tasks", methods=["GET"])
def list_tasks():
    result = []
    for task_id, task in tasks.items():
        ctx = task.get("context", {})
        history = task.get("history", [])
        first_user = next((h["content"] for h in history if h["role"] == "user"), "")
        result.append({
            "task_id": task_id,
            "created_at": task.get("created_at", ""),
            "updated_at": task.get("updated_at", ""),
            "title": ctx.get("title", ""),
            "preview": first_user[:60] if first_user else "",
            "message_count": sum(1 for h in history if h["role"] == "user"),
        })
    result.sort(key=lambda x: x.get("updated_at", ""), reverse=True)
    return jsonify({"tasks": result})


@app.route("/api/tasks/<task_id>", methods=["GET"])
def get_task(task_id):
    task = tasks.get(task_id)
    if not task:
        return jsonify({"error": "任务不存在"}), 404
    return jsonify({
        "task_id": task_id,
        "context": task.get("context", {}),
        "history": task.get("history", []),
        "created_at": task.get("created_at", ""),
        "updated_at": task.get("updated_at", ""),
    })


@app.route("/api/tasks/<task_id>", methods=["DELETE"])
def delete_task(task_id):
    tasks.pop(task_id, None)
    fpath = _task_path(task_id)
    if os.path.exists(fpath):
        os.remove(fpath)
    return jsonify({"ok": True})


@app.route("/api/tasks/<task_id>/context", methods=["POST"])
def update_task_context(task_id):
    if task_id not in tasks:
        return jsonify({"error": "任务不存在"}), 404
    ctx = (request.json or {}).get("context", {})
    tasks[task_id]["context"] = ctx
    _save_task(task_id)
    return jsonify({"ok": True})


@app.route("/api/chat/stream", methods=["POST"])
def chat_stream():
    data = request.json or {}
    task_id = data.get("task_id", "")
    message = data.get("message", "").strip()
    context = data.get("context", {"title": "", "style": "", "lyrics": ""})
    rag_results = data.get("rag_results", [])
    target_fields = data.get("target_fields", ["title", "style", "lyrics"])

    if not message:
        return jsonify({"error": "消息不能为空"}), 400

    cfg = load_config()
    api_key = cfg.get("api_key", "")
    if not api_key:
        return jsonify({"error": "请先配置 DeepSeek API Key"}), 400

    if task_id not in tasks:
        tasks[task_id] = {"history": [], "context": {}}
    task = tasks[task_id]

    system_prompt = _build_system_prompt(context, rag_results, target_fields)
    messages = [{"role": "system", "content": system_prompt}]
    messages.extend(task["history"])
    messages.append({"role": "user", "content": message})

    model = cfg.get("model", "deepseek-v4-flash")

    def generate():
        try:
            resp = requests.post(
                DEEPSEEK_API_URL,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "model": model,
                    "messages": messages,
                    "temperature": 1.0,
                    "max_tokens": 4096,
                    "stream": True,
                },
                stream=True,
                timeout=(10, None),
            )

            if not resp.ok:
                err_text = resp.text[:500]
                yield f"data: {json.dumps({'type': 'error', 'error': f'API 错误 {resp.status_code}: {err_text}'})}\n\n"
                return

            full_content = ""
            for line in resp.iter_lines():
                if not line:
                    continue
                if isinstance(line, bytes):
                    line = line.decode("utf-8")
                if not line.startswith("data: "):
                    continue
                chunk_str = line[6:]
                if chunk_str == "[DONE]":
                    break
                try:
                    chunk = json.loads(chunk_str)
                    delta = chunk["choices"][0]["delta"].get("content", "")
                    if delta:
                        full_content += delta
                        yield f"data: {json.dumps({'type': 'chunk', 'content': delta})}\n\n"
                except (json.JSONDecodeError, KeyError, IndexError):
                    pass

            parts = _parse_content(full_content, target_fields)
            task["history"].append({"role": "user", "content": message})
            task["history"].append({"role": "assistant", "content": full_content})
            task["context"] = context
            _save_task(task_id)

            yield f"data: {json.dumps({'type': 'done', 'parts': parts})}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"

    return Response(
        generate(),
        content_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ─── Prompt Builder ─────────────────────────────────────────────────

def _build_system_prompt(context, rag_results, target_fields):
    title = (context.get("title") or "").strip()
    style = (context.get("style") or "").strip()
    lyrics = (context.get("lyrics") or "").strip()

    rag_section = ""
    if rag_results:
        rag_section = "\n【参考古典诗词素材（请从中汲取意境与意象，化用而非直译）】\n"
        for i, r in enumerate(rag_results[:5], 1):
            poem_title = r.get("title") or "无题"
            author = r.get("author") or "佚名"
            lines = r.get("lines") or []
            matched = r.get("matched_keyword", "")
            lines_text = "\n".join(lines[:6])
            kw_note = f"（相关词：{matched}）" if matched else ""
            rag_section += f"\n[{i}] 《{poem_title}》— {author}{kw_note}\n{lines_text}\n"

    ctx_section = ""
    if title or style or lyrics:
        ctx_section = "\n【当前创作内容（请在此基础上修改/优化）】\n"
        if title:
            ctx_section += f"标题: {title}\n"
        if style:
            ctx_section += f"风格描述: {style}\n"
        if lyrics:
            ctx_section += f"歌词:\n{lyrics}\n"

    field_names = {"title": "标题", "style": "风格描述", "lyrics": "歌词"}
    if len(target_fields) < 3:
        target_note = f"\n本次仅需生成/修改: {', '.join(field_names.get(f, f) for f in target_fields)}（不要改动其他字段）\n"
    else:
        target_note = ""

    is_first_creation = not title and not style and not lyrics

    if is_first_creation or len(target_fields) >= 2:
        format_note = """【输出格式（必须严格遵守）】
必须使用以下分节格式，每个分节标记单独占一行：

===标题===
歌曲名称

===风格描述===
详细描述风格（必须覆盖以下所有维度，共约100-150字）：
• 曲风类型：如国风说唱、古风戏腔、流行、渐进式等（可组合）
• 演唱形式：如男声独唱、男女对唱、合唱等
• 节奏特点：如快节奏、缓慢渐进、BPM建议等
• 乐器搭配：如琵琶、古筝、鼓、合成器等
• 情感基调：如哀而不怨、豪迈激昂、柔情婉转等

===歌词===
完整歌词（每句末尾加标点。，！？）

- 三个分节必须全部输出，顺序不限
- 不要加任何额外说明、序号或 markdown 标记"""
    else:
        format_note = """【输出格式】
仅输出该字段的内容，不加任何多余说明或标记。歌词每句末尾必须有标点符号（。，！？）。"""

    return f"""你是一位专业的中文歌词创作助手，擅长结合古典诗词意境创作现代流行歌词。
{rag_section}
{SONGWRITING_RULES}
{ctx_section}{target_note}
{format_note}

重要：有已有内容时在其基础上优化；字段为空时全新创作。"""


def _parse_content(content, target_fields):
    """Parse AI response into title/style/lyrics dict."""
    if not content:
        return {}

    trimmed = content.strip()

    # Format 1: JSON (highest priority)
    json_str = trimmed
    m = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", trimmed, re.IGNORECASE)
    if m:
        json_str = m.group(1).strip()
    try:
        parsed = json.loads(json_str)
        result = {}
        mapping = {
            "title": ["title", "标题", "songName", "name"],
            "style": ["style", "风格描述", "风格", "songIdea", "idea"],
            "lyrics": ["lyrics", "歌词"],
        }
        for field, keys in mapping.items():
            for k in keys:
                if k in parsed and parsed[k]:
                    result[field] = str(parsed[k]).replace("\\n", "\n")
                    break
        if result:
            return result
    except (json.JSONDecodeError, AttributeError, TypeError):
        pass

    # Format 2: === section markers ===
    sections = {}
    key_map = {"标题": "title", "风格描述": "style", "歌词": "lyrics"}
    section_re = re.compile(
        r"===\s*(标题|风格描述|歌词)\s*===\s*([\s\S]*?)(?=\n\s*===\s*(?:标题|风格描述|歌词)\s*===|$)",
        re.IGNORECASE,
    )
    for m in section_re.finditer(trimmed):
        k = key_map.get(m.group(1).strip())
        if k:
            sections[k] = m.group(2).strip()
    if sections:
        return sections

    # Format 3: Single field
    if len(target_fields) == 1:
        return {target_fields[0]: trimmed}

    # Fallback: treat as lyrics
    return {"lyrics": trimmed}


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=4321, debug=True)
