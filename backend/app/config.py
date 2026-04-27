from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DB_HOST: str = "db"
    DB_PORT: int = 3306
    DB_NAME: str = "iris"
    DB_USER: str
    DB_PASSWORD: str
    SECRET_KEY: str
    NAS_HOST: str = ""
    NAS_USER: str = "admin"
    NAS_SSH_KEY_PATH: str = "/opt/iris/nas_key"

    @property
    def DATABASE_URL(self) -> str:
        return (
            f"mysql+pymysql://{self.DB_USER}:{self.DB_PASSWORD}"
            f"@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"
        )

    model_config = {"env_file": ".env"}


settings = Settings()
