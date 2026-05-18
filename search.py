import json
import os
import sys
import io

# Fix Windows console encoding for Chinese output
if sys.stdout.encoding and sys.stdout.encoding.lower() not in ('utf-8', 'utf8'):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
if sys.stderr.encoding and sys.stderr.encoding.lower() not in ('utf-8', 'utf8'):
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

DATAS_CONFIG = "./loader/datas.json"
OUTPUT_DIR = "./output"


def load_all_poems():
    with open(DATAS_CONFIG, "r", encoding="utf-8") as f:
        config = json.load(f)

    top_path = config["cp_path"]
    datasets = config["datasets"]
    all_poems = []

    for ds_key, ds in datasets.items():
        tag = ds["tag"]
        full_path = os.path.join(top_path, ds["path"])
        excludes = ds.get("excludes", [])

        files = []
        if os.path.isfile(full_path):
            files = [full_path]
        elif os.path.isdir(full_path):
            for fname in os.listdir(full_path):
                if fname not in excludes:
                    files.append(os.path.join(full_path, fname))

        for fpath in files:
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for poem in data:
                    poem["_tag"] = tag
                    poem["_source"] = ds["name"]
                    all_poems.append(poem)
            except Exception as e:
                print(f"警告：无法加载 {fpath}: {e}", file=sys.stderr)

    return all_poems


def get_lines(poem):
    tag = poem.get("_tag", "paragraphs")
    raw = poem.get(tag) or poem.get("paragraphs") or poem.get("content") or poem.get("para") or []
    # youmengying content is a plain string, not a list
    if isinstance(raw, str):
        return [raw]
    return raw


def poem_matches(poem, keyword):
    title = poem.get("title") or poem.get("rhythmic") or ""
    if keyword in title:
        return True
    return any(keyword in line for line in get_lines(poem))


def format_poem(poem):
    author = poem.get("author") or "佚名"
    title = poem.get("title") or poem.get("rhythmic") or ""
    source = poem.get("_source") or ""
    lines = get_lines(poem)

    parts = []
    header = f"【{title}】" if title else "【无题】"
    parts.append(header)
    parts.append(f"作者：{author}　来源：{source}")
    parts.append("")
    parts.extend(lines)
    parts.append("")
    parts.append("─" * 36)
    parts.append("")
    return "\n".join(parts)


def main():
    # Accept keyword from command-line arg or interactive input
    if len(sys.argv) > 1:
        keyword = " ".join(sys.argv[1:]).strip()
    else:
        keyword = input("请输入要查询的关键词：").strip()
    if not keyword:
        print("关键词不能为空")
        sys.exit(1)

    print("正在加载数据，请稍候...")
    poems = load_all_poems()
    print(f"共加载 {len(poems)} 条记录，开始检索「{keyword}」...")

    results = [p for p in poems if poem_matches(p, keyword)]
    print(f"找到 {len(results)} 首含有「{keyword}」的诗词")

    if not results:
        print("没有找到匹配的结果")
        return

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    out_path = os.path.join(OUTPUT_DIR, f"{keyword}.txt")

    with open(out_path, "w", encoding="utf-8") as f:
        f.write(f"关键词「{keyword}」检索结果 — 共 {len(results)} 首\n")
        f.write("=" * 50 + "\n\n")
        for poem in results:
            f.write(format_poem(poem))

    print(f"结果已保存至：{out_path}")


if __name__ == "__main__":
    main()
