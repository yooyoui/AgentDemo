from copy import deepcopy
from datetime import datetime, timezone
from typing import Any

from .agent import preserve_solution_boundaries


class ArtifactEditError(ValueError):
    pass


SCRIPT_STAGES = ["开场破冰", "背景确认", "需求深挖", "方案讲解", "异议处理", "收尾跟进"]
REQUIREMENT_FIELDS = ["显性需求", "隐性痛点", "建设期望", "关注事项", "待确认问题", "原文依据"]
SOLUTION_LIST_FIELDS = ["建设目标", "方案组合", "建设思路", "预期价值", "风险边界"]


def _text(value: Any, field: str, *, allow_empty: bool = False) -> str:
    if not isinstance(value, str):
        raise ArtifactEditError(f"{field}必须是文本")
    value = value.strip()
    if not value and not allow_empty:
        raise ArtifactEditError(f"{field}不能为空")
    return value


def _text_list(value: Any, field: str) -> list[str]:
    if not isinstance(value, list):
        raise ArtifactEditError(f"{field}必须是列表")
    result: list[str] = []
    for item in value:
        text = _text(item, field, allow_empty=True)
        if text and text not in result:
            result.append(text)
    return result


def _research(current: dict, incoming: dict) -> dict:
    if incoming.get("客户") != current.get("客户"):
        raise ArtifactEditError("客户名称不可修改")
    old_facts = current.get("结构化档案")
    new_facts = incoming.get("结构化档案")
    if not isinstance(old_facts, list) or not isinstance(new_facts, list) or len(old_facts) != len(new_facts):
        raise ArtifactEditError("结构化档案字段不可增加或删除")
    normalized = deepcopy(current)
    result = []
    for old, new in zip(old_facts, new_facts):
        if not isinstance(old, dict) or not isinstance(new, dict):
            raise ArtifactEditError("结构化档案格式不正确")
        if old.get("label") != new.get("label") or old.get("key") != new.get("key"):
            raise ArtifactEditError("结构化档案字段名称不可修改")
        value = _text(new.get("value", ""), str(old.get("label", "信息项")), allow_empty=True) or "待补充"
        fact = deepcopy(old)
        previous = str(old.get("value", "待补充")).strip()
        if value != previous:
            history = list(old.get("edit_history") or [])
            history.append({
                "value": previous,
                "status": old.get("status") or old.get("confidence") or "待确认",
                "confidence": old.get("confidence"),
                "source_url": old.get("source_url"),
                "sources": deepcopy(old.get("sources") or []),
                "edited_at": datetime.now(timezone.utc).isoformat(),
            })
            fact["edit_history"] = history
            fact["value"] = value
            fact["source_url"] = None
            fact["sources"] = []
            if value == "待补充":
                fact["status"], fact["confidence"] = "待补充", "待补充"
            elif old.get("status") in {"待补充", "待确认"} or previous == "待补充":
                fact["status"], fact["confidence"] = "已补充", "人工补充"
            elif old.get("status") == "用户提供" or old.get("confidence") == "用户提供":
                fact["status"], fact["confidence"] = "用户修改", "人工修改"
            else:
                fact["status"], fact["confidence"] = "核实后修改", "人工修改"
        result.append(fact)
    normalized["结构化档案"] = result
    normalized["潜在信息化方向"] = _text_list(incoming.get("潜在信息化方向", []), "潜在信息化方向")
    incoming_missing = _text_list(incoming.get("待补充", []), "待补充")
    fixed_labels = {str(fact.get("label", "")) for fact in result}
    still_missing = {str(fact.get("label", "")) for fact in result if fact.get("value") == "待补充" or fact.get("status") in {"待补充", "待确认"}}
    freeform = [item for item in incoming_missing if item not in fixed_labels]
    normalized["待补充"] = [str(fact.get("label")) for fact in result if str(fact.get("label")) in still_missing] + freeform
    return normalized


def _requirements(incoming: dict) -> dict:
    return {field: _text_list(incoming.get(field, []), field) for field in REQUIREMENT_FIELDS}


def _capabilities(current: dict, incoming: dict) -> dict:
    old_matches, new_matches = current.get("匹配结果", []), incoming.get("匹配结果", [])
    if not isinstance(old_matches, list) or not isinstance(new_matches, list) or len(old_matches) != len(new_matches):
        raise ArtifactEditError("能力匹配项不可增加或删除")
    result = []
    for old, new in zip(old_matches, new_matches):
        if not isinstance(old, dict) or not isinstance(new, dict):
            raise ArtifactEditError("能力匹配格式不正确")
        if any(old.get(key) != new.get(key) for key in ("能力", "类别", "引用", "document_id")):
            raise ArtifactEditError("能力名称、类别和内部引用不可修改")
        item = deepcopy(old)
        item["匹配理由"] = _text(new.get("匹配理由"), "匹配理由")
        item["适用条件"] = _text(new.get("适用条件"), "适用条件")
        result.append(item)
    notice = incoming.get("提示")
    if notice is not None:
        notice = _text(notice, "提示", allow_empty=True) or None
    return {"匹配结果": result, "提示": notice}


def _solution(incoming: dict, capability_names: set[str]) -> dict:
    result: dict[str, Any] = {"客户现状": _text(incoming.get("客户现状"), "客户现状")}
    for field in SOLUTION_LIST_FIELDS:
        result[field] = _text_list(incoming.get(field, []), field)
    invalid = [name for name in result["方案组合"] if name not in capability_names]
    if invalid:
        raise ArtifactEditError(f"方案组合只能选择能力匹配结果：{'、'.join(invalid)}")
    return result


def _script(incoming: dict, solution_boundaries: list[str]) -> dict:
    settings, stages = incoming.get("拜访设置"), incoming.get("阶段")
    if not isinstance(settings, dict) or not isinstance(stages, list):
        raise ArtifactEditError("拜访话术格式不正确")
    normalized_settings = {
        "类型": _text(settings.get("类型"), "拜访类型"),
        "客户角色": _text(settings.get("客户角色"), "客户角色"),
        "表达风格": _text(settings.get("表达风格"), "表达风格"),
    }
    if [stage.get("名称") if isinstance(stage, dict) else None for stage in stages] != SCRIPT_STAGES:
        raise ArtifactEditError("拜访话术必须按规定顺序保留六个阶段")
    normalized_stages = [{
        "名称": stage["名称"],
        "目标": _text(stage.get("目标"), f"{stage['名称']}目标"),
        "推荐表达": _text(stage.get("推荐表达"), f"{stage['名称']}推荐表达"),
        "问题": _text_list(stage.get("问题", []), f"{stage['名称']}问题"),
    } for stage in stages]
    promises = _text_list(incoming.get("禁止承诺", []), "禁止承诺")
    merged_script = preserve_solution_boundaries(
        {"禁止承诺": promises},
        {"风险边界": solution_boundaries},
    )
    merged = merged_script["禁止承诺"]
    if any(boundary not in merged for boundary in solution_boundaries):
        raise ArtifactEditError("禁止承诺未完整保留方案风险边界")
    return {"拜访设置": normalized_settings, "阶段": normalized_stages, "禁止承诺": merged}


def prepare_artifact_update(
    artifact_type: str,
    current: dict,
    incoming: dict,
    *,
    capability_names: set[str] | None = None,
    solution_boundaries: list[str] | None = None,
) -> dict:
    if not isinstance(incoming, dict):
        raise ArtifactEditError("成果内容必须是结构化对象")
    if artifact_type == "research":
        return _research(current, incoming)
    if artifact_type == "requirements":
        return _requirements(incoming)
    if artifact_type == "capabilities":
        return _capabilities(current, incoming)
    if artifact_type == "solution":
        return _solution(incoming, capability_names or set())
    if artifact_type == "script":
        return _script(incoming, solution_boundaries or [])
    raise ArtifactEditError("不支持的成果类型")
