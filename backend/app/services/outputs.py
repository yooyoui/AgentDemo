from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator


class StrictOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class ResearchFactOutput(StrictOutput):
    label: str = Field(min_length=1, max_length=100)
    value: str = Field(min_length=1, max_length=1200)
    confidence: Literal["公开来源", "用户提供", "待核实", "待补充"]
    source_url: HttpUrl | None = None
    status: Literal["已核实", "用户提供", "待确认", "待补充"] | None = None


class ResearchOutput(StrictOutput):
    customer: str = Field(alias="客户", min_length=1)
    facts: list[ResearchFactOutput] = Field(alias="结构化档案")
    directions: list[str] = Field(alias="潜在信息化方向")
    missing: list[str] = Field(alias="待补充")
    entity_conflict: bool = Field(default=False, alias="主体冲突")
    conflict_notes: list[str] = Field(default_factory=list, alias="冲突说明")


class RequirementsOutput(StrictOutput):
    explicit: list[str] = Field(alias="显性需求")
    pains: list[str] = Field(alias="隐性痛点")
    expectations: list[str] = Field(alias="建设期望")
    concerns: list[str] = Field(alias="关注事项")
    questions: list[str] = Field(alias="待确认问题")
    evidence: list[str] = Field(alias="原文依据")


class CapabilityItemOutput(StrictOutput):
    capability: str = Field(alias="能力", min_length=1)
    category: str = Field(alias="类别", min_length=1)
    reason: str = Field(alias="匹配理由", min_length=1)
    conditions: str = Field(alias="适用条件", min_length=1)
    quote: str = Field(alias="引用", min_length=1)
    document_id: str = Field(min_length=1)


class CapabilitiesOutput(StrictOutput):
    matches: list[CapabilityItemOutput] = Field(alias="匹配结果")
    notice: str | None = Field(default=None, alias="提示")


class SolutionOutput(StrictOutput):
    current_state: str = Field(alias="客户现状", min_length=1)
    goals: list[str] = Field(alias="建设目标")
    combination: list[str] = Field(alias="方案组合")
    approach: list[str] = Field(alias="建设思路")
    value: list[str] = Field(alias="预期价值")
    boundaries: list[str] = Field(alias="风险边界")


class VisitSettingsOutput(StrictOutput):
    visit_type: str = Field(alias="类型", min_length=1)
    customer_role: str = Field(alias="客户角色", min_length=1)
    style: str = Field(alias="表达风格", min_length=1)


class VisitStageOutput(StrictOutput):
    name: str = Field(alias="名称", min_length=1)
    goal: str = Field(alias="目标", min_length=1)
    wording: str = Field(alias="推荐表达", min_length=1)
    questions: list[str] | None = Field(default=None, alias="问题")


class VisitScriptOutput(StrictOutput):
    settings: VisitSettingsOutput = Field(alias="拜访设置")
    stages: list[VisitStageOutput] = Field(alias="阶段")
    forbidden_promises: list[str] = Field(alias="禁止承诺")

    @field_validator("stages")
    @classmethod
    def validate_six_stages(cls, value: list[VisitStageOutput]) -> list[VisitStageOutput]:
        expected = ["开场破冰", "背景确认", "需求深挖", "方案讲解", "异议处理", "收尾跟进"]
        if [stage.name for stage in value] != expected:
            raise ValueError("阶段必须按规定顺序完整覆盖六个拜访阶段")
        return value


class ConnectionTestOutput(StrictOutput):
    status: Literal["ok"]
