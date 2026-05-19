FROM python:3.12-slim-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/usr/local/bin:/usr/bin:/bin:/root/.local/bin"

RUN apt-get update && apt-get install -y --no-install-recommends \
      bash ca-certificates curl wget git jq tree make \
      build-essential pkg-config \
      ripgrep fd-find \
      sqlite3 zip unzip \
      nodejs npm \
    && ln -sf /usr/bin/fdfind /usr/local/bin/fd \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
      "numpy>=2.0" \
      "pandas>=2.2" \
      "scipy>=1.13" \
      "matplotlib>=3.9" \
      "sympy>=1.13" \
      "pint>=0.24" \
      "requests>=2.32" \
      "beautifulsoup4>=4.12" \
      "lxml>=5.2" \
      "pyyaml>=6.0" \
      "rich>=13.7" \
      "httpx>=0.27" \
      "ipython>=8.27"

RUN mkdir -p /workspace /tmp/harness && chmod 1777 /workspace /tmp/harness
WORKDIR /workspace

CMD ["sleep", "infinity"]
