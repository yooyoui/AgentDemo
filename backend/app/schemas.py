from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator

from .models import ArtifactType


class CustomerCreate(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    industry: str = "待补充"
    nature: str = "待补充"
    region: str = "待补充"
    notes: str = ""


class CustomerRead(CustomerCreate):
    id: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class AnalyzeRequest(BaseModel):
    communication: str = Field(default="", max_length=100_000)
    visit_type: str = "首次拜访"
    customer_role: str = "业务负责人"
    style: str = "专业务实"


class ArtifactRead(BaseModel):
    id: str
    customer_id: str
    type: ArtifactType
    title: str
    content: dict[str, Any]
    citations: list[dict[str, Any]]
    version: int
    confirmed: bool
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


class ArtifactUpdate(BaseModel):
    content: dict[str, Any]


class PromptUpdate(BaseModel):
    name: str
    content: str = Field(min_length=10)
    version: str = "1.0"
    enabled: bool = True


class PromptRead(PromptUpdate):
    id: str
    task_type: str
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


class KnowledgeRead(BaseModel):
    id: str
    filename: str
    category: str
    version: str
    status: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class TaskRead(BaseModel):
    id: str
    customer_id: str
    task_type: str
    status: str
    progress: int
    model: str
    output: dict[str, Any]
    error: str
    model_config = ConfigDict(from_attributes=True)


class ModelTestRead(BaseModel):
    status: str
    provider: str
    model: str
    latency_ms: int | None = None
    error: str = ""


class WebSearchRequest(BaseModel):
    query: str = Field(min_length=2, max_length=500)
    max_results: int = Field(default=5, ge=1, le=10)

    @field_validator("query")
    @classmethod
    def validate_query(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 2:
            raise ValueError("搜索关键词至少需要 2 个字符")
        return value


class WebSearchItem(BaseModel):
    title: str
    url: HttpUrl
    content: str
    published_date: str | None = None


class WebSearchRead(BaseModel):
    provider: Literal["deepseek"] = "deepseek"
    query: str
    results: list[WebSearchItem]
    searched_at: datetime
