# -*- coding: utf-8 -*-
"""知识库全库关键词检索。
用法: python search_cases.py 关键词1 [关键词2 ...] [--limit N] [--or] [--context N] [--notes]
默认对原文库做 AND 检索；--or 改任一命中；--notes 改检索主题判据笔记。

注意：多个关键词请用空格分开写成独立参数，或整体加引号亦可 —— 脚本会自动按空白拆分，
所以 `search_cases.py 验工计价 收量` 与 `search_cases.py "验工计价 收量"` 等价。
"""
import argparse, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REFS = os.path.normpath(os.path.join(HERE, "..", "references"))
CORPUS = os.path.join(REFS, "原文库")


def load(target):
    d = CORPUS if target == "corpus" else REFS
    if not os.path.isdir(d):
        sys.exit("目录不存在: %s" % d)
    ext = ".txt" if target == "corpus" else ".md"
    out = []
    for fn in sorted(os.listdir(d)):
        if fn.endswith(ext):
            try:
                out.append((fn, open(os.path.join(d, fn), encoding="utf-8").read()))
            except Exception:
                pass
    return out


def snippet(text, kws, width):
    pos = [text.find(k) for k in kws if text.find(k) >= 0]
    if not pos:
        return ""
    s = max(0, min(pos) - width // 3)
    return re.sub(r"\s+", " ", text[s:s + width])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("keywords", nargs="+")
    ap.add_argument("--limit", type=int, default=20)
    ap.add_argument("--or", dest="any_mode", action="store_true")
    ap.add_argument("--context", type=int, default=60)
    ap.add_argument("--notes", action="store_true")
    a = ap.parse_args()
    # 容错：允许把多个关键词写在同一个引号参数里（"甲 乙"），自动拆分
    kws = []
    for k in a.keywords:
        kws.extend(k.split())
    kws = [k for k in kws if k]
    if not kws:
        sys.exit("请至少给一个关键词")
    target = "notes" if a.notes else "corpus"
    rows = []
    for fn, t in load(target):
        hits = {k: t.count(k) for k in kws}
        ok = any(hits.values()) if a.any_mode else all(v > 0 for v in hits.values())
        if ok:
            rows.append((sum(hits.values()), fn, t, hits))
    rows.sort(key=lambda r: -r[0])
    total = len(rows)
    print("目标:%s 关键词:%s 模式:%s 命中 %d 篇（显示 %d）\n"
          % ("主题笔记" if a.notes else "原文库", " ".join(kws),
             "OR" if a.any_mode else "AND", total, min(total, a.limit)))
    for score, fn, t, hits in rows[: a.limit]:
        print("-" * 70)
        print("%-46s 命中 %d 次  %s" % (fn, score,
              " ".join("%s:%d" % (k, v) for k, v in hits.items() if v)))
        print("   ", snippet(t, kws, a.context))
    if total == 0:
        print("（无命中。减到 1–2 个关键词再试 / 加 --or 改并集 / 换同义词"
              "（验收→验工计价→计量；扣分→处罚→考核；归档→存档→档案））")
    print("-" * 70)
    print("\n拿到编号后读 references/原文库/<三位编号>-*.txt 看全文。")


if __name__ == "__main__":
    main()
