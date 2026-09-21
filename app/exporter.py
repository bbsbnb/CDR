from __future__ import annotations

from datetime import date


def _text(value, fallback="资料缺口：尚未填写") -> str:
    value = str(value or "").strip()
    return value or fallback


def _table(headers: list[str], rows: list[dict], keys: list[str]) -> str:
    if not rows:
        return "资料缺口：尚未填写。"
    lines = ["| " + " | ".join(headers) + " |", "|" + "|".join(["---"] * len(headers)) + "|"]
    for row in rows:
        values = [str(row.get(key, "")).replace("\n", " ").replace("|", "｜") or "—" for key in keys]
        lines.append("| " + " | ".join(values) + " |")
    return "\n".join(lines)


def build_markdown(matter: dict, audience: str = "internal") -> str:
    sections = matter.get("sections", {})
    intake = sections.get("intake", {})
    causes = sections.get("causes", {})
    evidence = sections.get("evidence", [])
    liability = sections.get("liability", {})
    solution = sections.get("solution", {})
    company = sections.get("company", {})
    actions = sections.get("actions", [])
    manual_citations = sections.get("manual_citations", [])
    gaps = sections.get("gaps", [])
    deadlines = sections.get("deadlines", [])
    lines = [
        f"# {_text(matter.get('title'), '工程纠纷分析报告')}",
        "",
        f"> 生成日期：{date.today().isoformat()}｜版本：{'内部完整报告' if audience == 'internal' else '对外沟通稿'}",
        "> 本报告用于工作参考，不构成正式法律意见；法律依据须以现行有效版本为准。",
        "",
        "## 一、纠纷起因与争议焦点",
        "",
        f"- 直接原因（作业层）：{_text(causes.get('direct'))}",
        f"- 管理原因（制度执行层）：{_text(causes.get('management'))}",
        f"- 制度原因（制度本身层）：{_text(causes.get('system'))}",
        f"- 争议焦点：{_text(causes.get('issues'))}",
        "",
        "### 资料缺口",
        _table(["级别", "缺口", "补充动作"], gaps, ["priority", "item", "action"]),
        "",
        "## 二、事实与证据核验",
        "",
        _table(["主张", "合同依据", "事实发生", "数量金额", "签认手续", "缺口", "补救方案"], evidence, ["claim", "contract", "facts", "amount", "signature", "gap", "remedy"]),
        "",
        "## 三、责任划分",
        "",
        _table(["责任主体", "责任内容", "责任比例/区间", "依据类型", "备注"], liability.get("rows", []), ["party", "content", "ratio", "basis", "note"]),
        "",
        "## 四、金额测算",
        "",
        f"- 可主张区间：{_text(liability.get('claim_range'))}",
        f"- 抗辩后大概率落点：{_text(liability.get('likely_range'))}",
        f"- 测算口径：{_text(liability.get('method'))}",
        f"- 假设条件：{_text(liability.get('assumptions'))}",
        "",
        "## 五、解决方案",
        "",
        f"- 建议路径：{_text(solution.get('path'))}",
        f"- 选择理由：{_text(solution.get('reason'))}",
        f"- 谈判筹码：{_text(solution.get('leverage'))}",
        "",
        "### 期限倒排",
        _table(["事项", "起算点", "依据", "到期日", "动作", "状态"], deadlines, ["item", "start", "basis", "due", "action", "status"]),
        "",
    ]
    if audience == "internal":
        lines.extend([
            "## 六、公司处理意见（仅限内部）",
            "",
            f"- 我方立场：{_text(company.get('position'))}",
            f"- 对外统一口径：{_text(company.get('message'))}",
            f"- 唯一对外发言人：{_text(company.get('spokesperson'))}",
            f"- 让步底线与授权层级：{_text(company.get('concession'), '待公司配置，不得自行推定')}",
            f"- 须报批事项：{_text(company.get('approvals'))}",
            f"- 内部整改与责任提示：{_text(company.get('internal_action'))}",
            "",
        ])
    lines.extend([
        "## 七、下一步动作清单",
        "",
        _table(["责任人", "动作", "时限", "所需文件"], actions, ["owner", "action", "due", "documents"]),
        "",
        "## 附、依据清单",
        "",
        "依据顺序：项目合同及补充协议 → 现行法律法规 → 公司制度（带版本状态）→ 行业案例（仅供经验参考）。",
        "",
        _table(
            ["来源", "编号", "具体依据"],
            manual_citations + matter.get("citations", []),
            ["library_type", "doc_id", "source_label"],
        ),
        "",
        f"案件概况：项目={_text(matter.get('project_name'), '未填写')}；我方身份={_text(matter.get('stance'), '未填写')}；对方={_text(matter.get('counterparty'), '未填写')}；阶段={_text(matter.get('stage'), '未填写')}；争议金额={_text(matter.get('amount'), '未填写')}。",
    ])
    return "\n".join(lines)
