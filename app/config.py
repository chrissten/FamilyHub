from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./familyhub.db"
    secret_key: str = "change-me"
    access_token_expire_minutes: int = 60 * 24 * 30

    admin_username: str = "christopher"
    admin_password: str = "change-me"
    admin_display_name: str = "Christopher"
    admin_color: str = "#4A90D9"

    default_timezone: str = "America/Chicago"

    # Recipe import (Anthropic API). With no key set, the import UI hides itself and the
    # endpoints return a clear error rather than the app failing to boot — every other
    # field here has a usable default too, and a half-configured deploy shouldn't take
    # the whole site down over a feature nobody is using yet.
    anthropic_api_key: str = ""
    recipe_model: str = "claude-sonnet-5"
    # Cap on how much page text is sent to the model. Recipe pages are mostly navigation
    # and comments; 30k characters is well past the end of any real recipe.
    recipe_max_page_chars: int = 30000

    @property
    def recipe_import_enabled(self) -> bool:
        return bool(self.anthropic_api_key)


settings = Settings()
