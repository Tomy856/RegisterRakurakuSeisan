FROM golang:1.24-bookworm

# Chrome（chromedp 用）
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      chromium-driver \
      ca-certificates \
      git \
      curl \
      make \
    && rm -rf /var/lib/apt/lists/*

# chromedp が使う Chrome のパスを環境変数で固定
ENV CHROME_BIN=/usr/bin/chromium
ENV CHROMEDP_NO_SANDBOX=1

WORKDIR /workspace
