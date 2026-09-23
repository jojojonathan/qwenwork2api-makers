# qwenwork2api v2 — 直连上游的 OpenAI 兼容服务（纯 Node，零 npm 依赖）
# WASM 与 token 均来自运行时只读挂载的 Windows 客户端目录（见 docker-run.sh），镜像内不打包
FROM node:22-alpine

WORKDIR /app

COPY server.mjs .

EXPOSE 8787

ENV QW2A_PORT=8787
ENV QW2A_AUTH_DAT=/client/auth-v2.dat
ENV QW2A_CLIENT_APP_DIR=/client-app

CMD ["node", "server.mjs"]
