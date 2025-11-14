from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import List

from pydantic import AnyUrl
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent
STORAGE_ROOT = BASE_DIR.parent / 'storage'


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', env_file_encoding='utf-8', extra='ignore')

    app_name: str = 'Underwater Image Restoration API'
    api_prefix: str = '/api'
    environment: str = 'local'

    allowed_origins: List[AnyUrl | str] = ['http://localhost:5173', 'http://127.0.0.1:5173']

    storage_root: Path = STORAGE_ROOT
    upload_dir: Path = STORAGE_ROOT / 'uploads'
    processed_dir: Path = STORAGE_ROOT / 'processed'
    report_dir: Path = STORAGE_ROOT / 'reports'

    redis_url: str = 'redis://localhost:6379/0'

    def ensure_directories(self) -> None:
        for directory in (self.storage_root, self.upload_dir, self.processed_dir, self.report_dir):
            directory.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.ensure_directories()
    return settings

