from __future__ import annotations

import json
import os
import socket
from threading import Lock
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import uuid4


TASKS = {
    "risk_summary": "风险摘要与优先补证清单",
    "evidence_review": "证据链缺口核验",
    "liability_draft": "责任区间分析草稿",
    "solution_options": "处理路径比较",
    "report_draft": "七段式报告草稿",
}

SYSTEM_PROMPT = """你是工程纠纷案件分析助手，不是律师，不直接出具正式法律意见。
依据顺序固定为：项目合同及补充协议；现行法律法规与司法解释；公司制度及版本状态；行业案例经验。
严格区分已知事实、用户主张、资料缺口和模型推断。禁止补造事实、金额、日期、法条、案例内容和授权门槛。
金额只能输出区间、口径和假设。制度必须带编号和版本状态。案例必须标明“行业经验素材，不是法律法规或裁判文书”。
法律现行状态无法由当前资料确认时，必须提示人工或律师核验。输出必须包含：结论摘要、事实依据、资料缺口、风险等级与理由、责任分析、金额区间和测算假设、可选处理路径、待人工核验事项、使用的依据编号。
只使用用户提供的案件上下文和已选依据，不要声称读取了其他本地文件。"""

_runtime_lock = Lock()
_runtime_api_key = ""
_runtime_model = ""
_connection_status = "untested"
_connection_message = "尚未测试连接。"
_last_tested_at = ""


class AIServiceError(RuntimeError):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class AIConfig:
    api_key: str
    model: str
    base_url: str
    reasoning_effort: str
    timeout: float
    max_output_tokens: int

    @property
    def enabled(self) -> bool:
        return bool(self.api_key)


def config() -> AIConfig:
    with _runtime_lock:
        runtime_api_key = _runtime_api_key
        runtime_model = _runtime_model
    try:
        timeout = max(5.0, float(os.getenv("DISPUTE_EXPERT_AI_TIMEOUT", "60")))
    except ValueError:
        timeout = 60.0
    try:
        max_output_tokens = max(256, min(12000, int(os.getenv("DISPUTE_EXPERT_AI_MAX_OUTPUT_TOKENS", "2500"))))
    except ValueError:
        max_output_tokens = 2500
    return AIConfig(
        api_key=runtime_api_key or os.getenv("DISPUTE_EXPERT_AI_API_KEY", "").strip(),
        model=runtime_model or os.getenv("DISPUTE_EXPERT_AI_MODEL", "gpt-6-astra").strip() or "gpt-6-astra",
        base_url=os.getenv("DISPUTE_EXPERT_AI_BASE_URL", "https://api.openai.com/v1/responses").strip(),
        reasoning_effort=os.getenv("DISPUTE_EXPERT_AI_REASONING_EFFORT", "low").strip() or "low",
        timeout=timeout,
        max_output_tokens=max_output_tokens,
    )


def public_status() -> dict:
    settings = config()
    with _runtime_lock:
        source = "session" if _runtime_api_key else "environment" if settings.enabled else "none"
        connection_status = _connection_status if settings.enabled else "disabled"
        connection_message = _connection_message if settings.enabled else "AI 未启用。"
        last_tested_at = _last_tested_at
    return {
        "enabled": settings.enabled,
        "model": settings.model if settings.enabled else None,
        "source": source,
        "connection_status": connection_status,
        "connection_message": connection_message,
        "last_tested_at": last_tested_at,
        "tasks": TASKS,
    }


def set_runtime_config(api_key: str, model: str = "") -> dict:
    key = api_key.strip()
    if not key or len(key) > 512:
        raise AIServiceError("请输入有效的 OpenAI API Key。", 422)
    selected_model = model.strip() or "gpt-6-astra"
    if len(selected_model) > 100 or any(char.isspace() for char in selected_model):
        raise AIServiceError("模型名称格式不正确。", 422)
    global _runtime_api_key, _runtime_model, _connection_status, _connection_message, _last_tested_at
    with _runtime_lock:
        _runtime_api_key = key
        _runtime_model = selected_model
        _connection_status = "untested"
        _connection_message = "配置已保存，请测试连接。"
        _last_tested_at = ""
    return public_status()


def clear_runtime_config() -> dict:
    global _runtime_api_key, _runtime_model, _connection_status, _connection_message, _last_tested_at
    with _runtime_lock:
        _runtime_api_key = ""
        _runtime_model = ""
        _connection_status = "untested"
        _connection_message = "尚未测试连接。"
        _last_tested_at = ""
    return public_status()


def _record_connection(status: str, message: str) -> None:
    global _connection_status, _connection_message, _last_tested_at
    with _runtime_lock:
        _connection_status = status
        _connection_message = message
        _last_tested_at = datetime.now(timezone.utc).isoformat(timespec="seconds")


def _request_json(settings: AIConfig, body: dict) -> dict:
    request = Request(
        settings.base_url,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={"Authorization": f"Bearer {settings.api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=settings.timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        if error.code == 401:
            raise AIServiceError("AI 认证失败，请检查 OpenAI API Key。", 502) from error
        if error.code == 429:
            raise AIServiceError("AI 请求受到限流或账户额度不足，请检查账户后重试。", 429) from error
        if error.code in {400, 404}:
            raise AIServiceError(f"模型 {settings.model} 不可用或请求格式不受支持，请改用 gpt-6-astra 后重试。", 502) from error
        raise AIServiceError(f"AI 服务暂时不可用（HTTP {error.code}）。", 502) from error
    except (URLError, TimeoutError, socket.timeout) as error:
        raise AIServiceError("AI 请求超时或网络不可用，本地功能不受影响。", 504) from error
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise AIServiceError("AI 返回格式无法解析，本次结果未写入案件。", 502) from error


def test_connection() -> dict:
    settings = config()
    if not settings.enabled:
        raise AIServiceError("请先保存 OpenAI API Key。", 422)
    try:
        payload = _request_json(settings, {
            "model": settings.model,
            "input": "仅回复 OK。",
            "max_output_tokens": 32,
        })
        if not _extract_text(payload):
            raise AIServiceError("模型未返回测试文本。", 502)
    except AIServiceError as error:
        _record_connection("failed", str(error))
        raise
    _record_connection("verified", "连接测试成功，可以在纠纷分析页使用 AI 功能。")
    return public_status()


def _clip(value, limit: int = 3000) -> str:
    text = str(value or "").strip()
    return text[:limit] + ("…" if len(text) > limit else "")


def _safe_value(value):
    if isinstance(value, dict):
        return {str(key): _safe_value(item) for key, item in value.items() if key not in {"api_key", "password", "token"}}
    if isinstance(value, list):
        return [_safe_value(item) for item in value[:50]]
    if isinstance(value, str):
        return _clip(value)
    return value


def build_context(matter: dict, selected_citations: list[str] | None = None) -> tuple[dict, list[dict], list[str]]:
    requested = set(selected_citations or [])
    citations = []
    for citation in matter.get("citations", []):
        key = f"{('case' if citation.get('library_type') == '案例' else 'institution')}:{citation.get('doc_id')}"
        if not requested or key in requested:
            citations.append({
                "library_type": citation.get("library_type", ""),
                "doc_id": citation.get("doc_id", ""),
                "title": _clip(citation.get("title", ""), 300),
                "source_label": _clip(citation.get("source_label", ""), 500),
            })
    raw_sections = matter.get("sections", {})
    sections = _safe_value({key: value for key, value in raw_sections.items() if key not in {"company", "actions"}})
    context = {
        "matter": {key: _clip(matter.get(key, ""), 500) for key in ("title", "project_name", "stance", "counterparty", "stage", "dispute_type", "amount")},
        "current_step": matter.get("current_step", 1),
        "sections": sections,
        "selected_citations": citations,
    }
    warnings = ["AI 输出仅为草稿，必须由经办人和律师核验。", "法律现行状态需人工核验。"]
    if not sections.get("gaps") or any(not row.get("item") for row in sections.get("gaps", []) if isinstance(row, dict)):
        warnings.append("当前资料缺口可能未完整填写。")
    return context, citations, warnings


def _extract_text(payload: dict) -> str:
    if isinstance(payload.get("output_text"), str) and payload["output_text"].strip():
        return payload["output_text"].strip()
    pieces = []
    for item in payload.get("output", []) or []:
        for content in item.get("content", []) or []:
            text = content.get("text")
            if isinstance(text, str):
                pieces.append(text)
    text = "\n".join(pieces).strip()
    if not text:
        raise AIServiceError("模型返回为空，请稍后重试。", 502)
    return text


def analyze(matter: dict, task: str, selected_citations: list[str] | None = None, user_instruction: str = "") -> dict:
    if task not in TASKS:
        raise AIServiceError("不支持的 AI 分析任务。", 422)
    settings = config()
    if not settings.enabled:
        return {"enabled": False, "message": "AI分析未启用；本地知识库和案件工作台仍可正常使用。"}
    context, citations, warnings = build_context(matter, selected_citations)
    instruction = _clip(user_instruction, 1200) or "请完成本次分析，并明确列出资料缺口和人工核验事项。"
    request_body = {
        "model": settings.model,
        "instructions": SYSTEM_PROMPT,
        "input": f"任务：{TASKS[task]}\n用户补充要求：{instruction}\n案件上下文（仅限以下资料）：\n{json.dumps(context, ensure_ascii=False)}",
        "reasoning": {"effort": settings.reasoning_effort},
        "max_output_tokens": settings.max_output_tokens,
    }
    request_id = uuid4().hex[:12]
    payload = _request_json(settings, request_body)
    return {
        "enabled": True,
        "matter_id": matter.get("id", ""),
        "request_id": request_id,
        "task": task,
        "content": _extract_text(payload),
        "citations": citations,
        "warnings": warnings,
        "model": settings.model,
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
