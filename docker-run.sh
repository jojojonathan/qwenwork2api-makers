#!/usr/bin/env bash
# qwenwork2api v2 一键启动：提取密钥 → 健康校验 → 确认 WASM → 构建镜像 → 启动容器
#
# 用法:
#   ./docker-run.sh [start] [-d 秒]   构建 + 启动；-d 指定 auth-v2.dat 轮询间隔（秒），默认 30
#   ./docker-run.sh stop              停止并移除容器
#   ./docker-run.sh logs              跟踪日志
#
# 数据流（运行时只挂载客户端数据目录；WASM 构建时打包进镜像）:
#   客户端数据目录 QwenWorkCN → /client（只读）：auth-v2.dat 启动时解密 + 每 N 秒 stat 轮询跟进，
#     客户端刷新 token / 切号后最迟 N 秒生效，无需重启
#   客户端 WASM：本脚本确认最新版本目录后拷入 vendor/（gitignored），随镜像构建打包；
#     客户端升级后重跑本脚本即可（脚本每次都会重建镜像）
#   state/（aeskey.txt、machine-id）仅是宿主机侧缓存，内容经环境变量注入容器，不挂载
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="$BASE_DIR/state"
VENDOR_DIR="$BASE_DIR/vendor"   # WASM 构建暂存（gitignored）
IMAGE_NAME="qwenwork2api"
CONTAINER_NAME="qwenwork2api"
PORT="${QW2A_PORT:-8787}"
API_KEY="${QW2A_API_KEY:-sk-qwenwork-20857f643cf5e71d2b2ed8447b01c0f0}"

# Windows 客户端路径（可环境变量覆盖）
WIN_USER_DIR="${WIN_USER_DIR:-/mnt/c/Users/64264}"
AUTH_DAT="$WIN_USER_DIR/AppData/Roaming/QwenWorkCN/auth-v2.dat"
CLIENT_DATA_DIR="$(dirname "$AUTH_DAT")"  # auth-v2.dat 所在目录，整体只读挂载进容器
LOCAL_STATE="$WIN_USER_DIR/AppData/Roaming/QwenWorkCN/Local State"
MACHINE_ID_FILE="$WIN_USER_DIR/.qwenworkcn/machine-id"
CLIENT_ROOT="$WIN_USER_DIR/AppData/Local/Programs/QwenWorkCN"

export WRANGLER_SEND_METRICS=false

msg()  { printf '\033[1;32m[qwenwork2api]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[警告]\033[0m %s\n' "$*" >&2; }

# ---------- 参数解析：[-d 秒] [start|stop|logs] ----------
WATCH_INTERVAL="${QW2A_WATCH_INTERVAL:-30}"
CMD="start"
while [ $# -gt 0 ]; do
  case "$1" in
    -d) WATCH_INTERVAL="${2:?-d 需要参数（秒）}"; shift 2 ;;
    -d*) WATCH_INTERVAL="${1#-d}"; shift ;;
    start|stop|logs) CMD="$1"; shift ;;
    *) echo "未知参数: $1（用法: $0 [start|stop|logs] [-d 轮询秒数]）" >&2; exit 1 ;;
  esac
done
case "$WATCH_INTERVAL" in (*[!0-9]*|'') echo "错误：轮询间隔需为正整数" >&2; exit 1 ;; esac

case "$CMD" in
  stop)
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 && msg "容器已停止" || warn "容器未在运行"
    exit 0
    ;;
  logs)
    exec docker logs -f "$CONTAINER_NAME"
    ;;
esac

command -v docker >/dev/null 2>&1 || { warn "缺少 docker"; exit 1; }
docker info >/dev/null 2>&1 || { warn "docker daemon 未运行"; exit 1; }

mkdir -p "$STATE_DIR" "$VENDOR_DIR"

# PowerShell 完整路径（含回退）
PS_EXE=""
for cand in "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe" "$(command -v powershell.exe 2>/dev/null || true)"; do
  if [ -n "$cand" ] && [ -x "$cand" ]; then PS_EXE="$cand"; break; fi
done

# ---------- 1. AES 密钥（稳定不变，只提取一次） ----------
if [ ! -s "$STATE_DIR/aeskey.txt" ]; then
  if [ -z "$PS_EXE" ]; then
    warn "找不到 powershell.exe（DPAPI 解密需要）。可手动把 64 位十六进制 AES 密钥写入 state/aeskey.txt"
    exit 1
  fi
  msg "提取 AES 密钥（DPAPI，仅需一次）..."
  WIN_LS="$(wslpath -w "$LOCAL_STATE")"
  KEY_HEX="$("$PS_EXE" -NoProfile -Command "
Add-Type -AssemblyName System.Security
\$ls = Get-Content '$WIN_LS' -Raw | ConvertFrom-Json
\$raw = [Convert]::FromBase64String(\$ls.os_crypt.encrypted_key)
\$enc = \$raw[5..(\$raw.Length-1)]
\$key = [System.Security.Cryptography.ProtectedData]::Unprotect(\$enc, \$null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[BitConverter]::ToString(\$key).Replace('-','').ToLower()
" </dev/null 2>/dev/null | tr -d '\r\n ')"
  if ! [[ "$KEY_HEX" =~ ^[0-9a-fA-F]{64}$ ]]; then
    warn "AES 密钥提取失败（得到: ${KEY_HEX:0-20}）。请确认 Windows 客户端已安装并登录过。"
    exit 1
  fi
  printf '%s' "$KEY_HEX" > "$STATE_DIR/aeskey.txt"
  msg "AES 密钥已保存 → state/aeskey.txt"
fi

# ---------- 2. 校验 auth-v2.dat 可解密（启动前健康检查） ----------
if [ ! -f "$AUTH_DAT" ]; then
  warn "找不到 $AUTH_DAT"
  warn "请确认 Windows 客户端已安装并登录；或用 WIN_USER_DIR 环境变量指定 Windows 用户目录"
  exit 1
fi
msg "校验 auth-v2.dat 可解密（容器内实时解密，这里只确认密钥/文件健康）..."
# 预解密一份 token.json 作兜底；失败多为客户端重装导致密钥变化，自动重提取密钥并重试一次
if ! node "$BASE_DIR/decrypt-token.mjs" "$AUTH_DAT" "$(cat "$STATE_DIR/aeskey.txt")" -; then
  if [ "${QW2A_KEY_RETRY:-}" = "1" ]; then
    warn "重新提取密钥后仍解密失败，请确认 Windows 客户端已登录"
    exit 1
  fi
  warn "解密失败，尝试重新提取 AES 密钥..."
  rm -f "$STATE_DIR/aeskey.txt"
  QW2A_KEY_RETRY=1 exec "$0" "$@"
fi

# ---------- 3. machine-id ----------
if [ -f "$MACHINE_ID_FILE" ] && [ -s "$MACHINE_ID_FILE" ]; then
  cp -f "$MACHINE_ID_FILE" "$STATE_DIR/machine-id"
elif [ ! -s "$STATE_DIR/machine-id" ]; then
  cat /proc/sys/kernel/random/uuid > "$STATE_DIR/machine-id"
  msg "未找到客户端 machine-id，已生成随机值"
fi

# ---------- 4. 确认客户端 WASM（最新版本目录）与 cosy 版本 ----------
WASM_SRC="$(ls "$CLIENT_ROOT"/*/resources/qoder-auth-wasm/qoder_auth_wasm_bg.wasm 2>/dev/null | sort -V | tail -1 || true)"
if [ -z "$WASM_SRC" ] || [ ! -f "$WASM_SRC" ]; then
  warn "找不到客户端 WASM（$CLIENT_ROOT/*/resources/qoder-auth-wasm/）"
  warn "请安装 Windows QwenWorkCN 客户端后再运行"
  exit 1
fi
msg "WASM: $WASM_SRC"
cp -f "$WASM_SRC" "$VENDOR_DIR/qoder_auth_wasm_bg.wasm"
msg "已拷入 $VENDOR_DIR/，将随镜像构建打包"
MANIFEST="$(dirname "$(dirname "$WASM_SRC")")/app.asar.unpacked/node_modules/@qoder-ai/qoder-agent-sdk/dist/runtime-manifest.json"
COSY_VERSION="$(node -e 'try{console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).qoderCliVersion||"")}catch{}' "$MANIFEST" 2>/dev/null || true)"
if [ -n "$COSY_VERSION" ]; then
  msg "cosy 版本: $COSY_VERSION（来自客户端 runtime-manifest）"
else
  COSY_VERSION=""; warn "未能读取 cosy 版本，服务端使用内置默认"
fi

# ---------- 5. 构建镜像 ----------
msg "构建镜像 $IMAGE_NAME（秒级，零依赖）..."
docker build -q -t "$IMAGE_NAME" "$BASE_DIR" >/dev/null

# ---------- 6. 启动容器 ----------
docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  -p "${PORT}:8787" \
  -v "${CLIENT_DATA_DIR}:/client:ro" \
  -e "QW2A_AES_KEY=$(cat "$STATE_DIR/aeskey.txt")" \
  -e "QW2A_MACHINE_ID=$(cat "$STATE_DIR/machine-id")" \
  -e "QW2A_WATCH_INTERVAL_SEC=${WATCH_INTERVAL}" \
  -e "QW2A_COSY_VERSION=${COSY_VERSION}" \
  -e "QW2A_API_KEY=${API_KEY}" \
  "$IMAGE_NAME" >/dev/null

msg "容器已启动，等待就绪..."
for i in $(seq 1 20); do
  if curl -sf -o /dev/null "http://127.0.0.1:${PORT}/v1/models" -H "Authorization: Bearer ${API_KEY}"; then
    echo
    msg "就绪: http://127.0.0.1:${PORT}/v1  (key=${API_KEY})"
    msg "token 刷新/切号最迟 ${WATCH_INTERVAL}s 自动跟进；客户端升级后重跑本脚本同步 WASM"
    msg "测试: curl http://127.0.0.1:${PORT}/v1/chat/completions -H 'Authorization: Bearer ${API_KEY}' -H 'Content-Type: application/json' -d '{\"model\":\"flash\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}],\"max_tokens\":32}'"
    exit 0
  fi
  sleep 1
done

warn "服务 20 秒内未就绪，查看日志: docker logs $CONTAINER_NAME"
exit 1
