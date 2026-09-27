"""Run the API with the configured bind address: `python -m app`."""

import uvicorn

from app.core.config import get_settings


def main() -> None:
    settings = get_settings()
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        proxy_headers=False,
        server_header=False,
        log_level="info",
    )


if __name__ == "__main__":
    main()
