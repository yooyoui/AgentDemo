from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    app_name: str = "政企拜访助手"
    database_url: str = "sqlite:///./data/visit_assistant.db"
    redis_url: str = "redis://localhost:6379/0"
    storage_dir: Path = Path("./uploads")
    export_dir: Path = Path("./exports")
    max_upload_mb: int = 15
    llm_api_key: str = ""
    llm_base_url: str = "https://api.deepseek.com"
    llm_model: str = "deepseek-v4-flash"
    llm_timeout_seconds: int = 90
    llm_max_tokens: int = 4096
    llm_max_retries: int = 2
    embedding_model: str = "text-embedding-3-small"
    tavily_api_key: str = ""
    cors_origins: str = "http://localhost:3000,http://localhost:3001"
    model_config = SettingsConfigDict(env_file=PROJECT_ROOT / ".env", extra="ignore")

    @property
    def origins(self) -> list[str]:
        return [x.strip() for x in self.cors_origins.split(",") if x.strip()]


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.storage_dir.mkdir(parents=True, exist_ok=True)
    settings.export_dir.mkdir(parents=True, exist_ok=True)
    Path("./data").mkdir(parents=True, exist_ok=True)
    return settings
