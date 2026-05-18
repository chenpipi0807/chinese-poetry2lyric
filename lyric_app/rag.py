import json
import os
import re
import sys

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_POETRY_ROOT = os.path.dirname(_SCRIPT_DIR)
_DATAS_CONFIG = os.path.join(_POETRY_ROOT, "loader", "datas.json")

_poems_cache = None

_SKIP_DIRS = {"strains", "rank", "error", ".git", ".idea", "__pycache__", "output"}
_SKIP_FILE_RE = re.compile(
    r"^(authors\.|intro\.json$|README|main\.py$|UpdateCi\.py$|表面结构字\.json$)",
    re.IGNORECASE,
)


def _iter_json_files(path, excludes):
    excludes = set(excludes or [])
    if os.path.isfile(path):
        if path.endswith(".json") and os.path.basename(path) not in excludes:
            yield path
        return
    if not os.path.isdir(path):
        return
    for dirpath, dirnames, filenames in os.walk(path):
        # Prune directories in-place so os.walk doesn't descend into them
        dirnames[:] = sorted(
            d for d in dirnames
            if d not in _SKIP_DIRS and d not in excludes
        )
        for fname in sorted(filenames):
            if not fname.endswith(".json"):
                continue
            if fname in excludes or _SKIP_FILE_RE.match(fname):
                continue
            yield os.path.join(dirpath, fname)


def _load_all_poems():
    global _poems_cache
    if _poems_cache is not None:
        return _poems_cache

    if not os.path.exists(_DATAS_CONFIG):
        print(f"[RAG] datas.json not found at {_DATAS_CONFIG}", file=sys.stderr)
        _poems_cache = []
        return _poems_cache

    with open(_DATAS_CONFIG, "r", encoding="utf-8") as f:
        config = json.load(f)

    datasets = config["datasets"]
    all_poems = []

    for ds_key, ds in datasets.items():
        tag = ds["tag"]
        rel_path = ds["path"]
        full_path = os.path.normpath(os.path.join(_POETRY_ROOT, rel_path))
        excludes = ds.get("excludes", [])

        for fpath in _iter_json_files(full_path, excludes):
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data, dict):
                    data = [data]
                if not isinstance(data, list):
                    continue
                for poem in data:
                    if not isinstance(poem, dict):
                        continue
                    poem["_tag"] = tag
                    poem["_source"] = ds["name"]
                    all_poems.append(poem)
            except Exception:
                pass

    # 蒙学 directory is not in datas.json, handle it separately
    mengxue = os.path.join(_POETRY_ROOT, "蒙学")
    if os.path.isdir(mengxue):
        for fpath in _iter_json_files(mengxue, []):
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data, dict):
                    data = [data]
                if not isinstance(data, list):
                    continue
                for poem in data:
                    if not isinstance(poem, dict):
                        continue
                    poem["_tag"] = "paragraphs"
                    poem["_source"] = "蒙学"
                    all_poems.append(poem)
            except Exception:
                pass

    _poems_cache = all_poems
    print(f"[RAG] Loaded {len(all_poems)} poems", file=sys.stderr)
    return all_poems


def _get_lines(poem):
    tag = poem.get("_tag", "paragraphs")
    raw = (
        poem.get(tag)
        or poem.get("paragraphs")
        or poem.get("content")
        or poem.get("para")
        or []
    )
    if isinstance(raw, str):
        return [raw]
    return raw


def _poem_to_dict(poem, matched_keyword=None):
    d = {
        "author": poem.get("author") or "佚名",
        "title": poem.get("title") or poem.get("rhythmic") or "",
        "source": poem.get("_source") or "",
        "lines": _get_lines(poem)[:12],
    }
    if matched_keyword:
        d["matched_keyword"] = matched_keyword
    return d


def search_poems(keyword, max_results=20):
    """Search poems where keyword appears in title, rhythmic, author, or content lines."""
    if not keyword or not keyword.strip():
        return []

    keyword = keyword.strip()
    poems = _load_all_poems()
    results = []

    for poem in poems:
        title = poem.get("title") or poem.get("rhythmic") or ""
        author = poem.get("author") or ""
        lines = _get_lines(poem)

        if (
            keyword in title
            or keyword in author
            or any(keyword in line for line in lines)
        ):
            results.append(_poem_to_dict(poem))
            if len(results) >= max_results:
                break

    return results


def get_poem_count():
    return len(_load_all_poems())
