from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./familyhub.db"
    secret_key: str = "change-me"
    access_token_expire_minutes: int = 60 * 24 * 30

    admin_username: str = "admin"
    admin_password: str = "change-me"
    admin_display_name: str = "Admin"
    admin_color: str = "#4A90D9"


settings = Settings()
