# qwenwork2api v2 — 直连上游的 OpenAI 兼容服务（纯 Node，零 npm 依赖）
# token 来自运行时只读挂载的客户端数据目录；WASM 由 docker-run.sh 同步到 vendor/ 后打包进镜像
FROM node:22-alpine

WORKDIR /app

COPY server.mjs .
COPY vendor/qoder_auth_wasm_bg.wasm .

EXPOSE 8787

ENV QW2A_PORT=8787
ENV QW2A_AUTH_DAT=/client/auth-v2.dat
ENV QW2A_WASM=/app/qoder_auth_wasm_bg.wasm

CMD ["node", "server.mjs"]
