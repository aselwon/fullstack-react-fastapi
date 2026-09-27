from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "sqlite:///./relaydesk.db"
    redis_url: str = "redis://localhost:6379/0"
    jwt_secret: str = "local-development-only-change-before-deploying"
    cors_origins: str = "http://localhost:3000"
    upload_dir: str = "./uploads"
    max_upload_bytes: int = 5 * 1024 * 1024
    webhook_allow_private: bool = False
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
