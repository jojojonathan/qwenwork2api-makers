# qwenwork2api v2 — 直连上游的 OpenAI 兼容服务（纯 Node，零 npm 依赖）
FROM node:22-alpine

WORKDIR /app

# wasm 文件由 docker-run.sh 从 Windows 客户端同步到 vendor/ 后一起构建
COPY server.mjs .
COPY vendor/qoder_auth_wasm_bg.wasm .

EXPOSE 8787

ENV QW2A_PORT=8787
ENV QW2A_WASM=/app/qoder_auth_wasm_bg.wasm
ENV QW2A_TOKEN_FILE=/data/token.json
ENV QW2A_MACHINE_ID_FILE=/data/machine-id

CMD ["node", "server.mjs"]
