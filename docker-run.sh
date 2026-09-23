#!/usr/bin/env bash
# qwenwork2api v2 一键启动：解密 token → 同步 WASM → 构建镜像 → 启动容器
#
# 用法:
#   ./docker-run.sh          构建 + 启动（会自动从 Windows 客户端解密最新 token）
#   ./docker-run.sh stop     停止并移除容器
#   ./docker-run.sh logs     跟踪日志
#
# 数据流:
#   Windows 客户端 auth-v2.dat --(DPAPI+AES-GCM 解密)--> state/token.json
#   Windows 客户端 qoder-auth-wasm 目录 --(复制)--> vendor/*.wasm
#   容器挂载 state/ → /data，server.mjs 用 token + WASM 签名直连 gateway.qwenwork.cn
#
# token 有效期约 7 天，过期后重新运行本脚本即可（自动取客户端最新 token）。
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="$BASE_DIR/state"
VENDOR_DIR="$BASE_DIR/vendor"
IMAGE_NAME="qwenwork2api"
CONTAINER_NAME="qwenwork2api"
PORT="${QW2A_PORT:-8787}"
API_KEY="${QW2A_API_KEY:-sk-qwenwork-20857f643cf5e71d2b2ed8447b01c0f0}"

# Windows 客户端路径（可环境变量覆盖）
WIN_USER_DIR="${WIN_USER_DIR:-/mnt/c/Users/64264}"
AUTH_DAT="$WIN_USER_DIR/AppData/Roaming/QwenWorkCN/auth-v2.dat"
LOCAL_STATE="$WIN_USER_DIR/AppData/Roaming/QwenWorkCN/Local State"
MACHINE_ID_FILE="$WIN_USER_DIR/.qwenworkcn/machine-id"
CLIENT_ROOT="$WIN_USER_DIR/AppData/Local/Programs/QwenWorkCN"

export WRANGLER_SEND_METRICS=false

msg()  { printf '\033[1;32m[qwenwork2api]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[警告]\033[0m %s\n' "$*" >&2; }

case "${1:-start}" in
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

# ---------- 2. 解密最新 token ----------
if [ ! -f "$AUTH_DAT" ]; then
  warn "找不到 $AUTH_DAT"
  warn "请确认 Windows 客户端已安装并登录；或用 WIN_USER_DIR 环境变量指定 Windows 用户目录"
  exit 1
fi
msg "解密客户端最新 token..."
node "$BASE_DIR/decrypt-token.mjs" "$AUTH_DAT" "$(cat "$STATE_DIR/aeskey.txt")" "$STATE_DIR/token.json"

# ---------- 3. machine-id ----------
if [ -f "$MACHINE_ID_FILE" ] && [ -s "$MACHINE_ID_FILE" ]; then
  cp -f "$MACHINE_ID_FILE" "$STATE_DIR/machine-id"
elif [ ! -s "$STATE_DIR/machine-id" ]; then
  cat /proc/sys/kernel/random/uuid > "$STATE_DIR/machine-id"
  msg "未找到客户端 machine-id，已生成随机值"
fi

# ---------- 4. 同步 WASM（跟随客户端版本） ----------
WASM_SRC="$(ls -d "$CLIENT_ROOT"/*/resources/qoder-auth-wasm/qoder_auth_wasm_bg.wasm 2>/dev/null | sort -V | tail -1 || true)"
if [ -n "$WASM_SRC" ] && [ -f "$WASM_SRC" ]; then
  cp -f "$WASM_SRC" "$VENDOR_DIR/qoder_auth_wasm_bg.wasm"
  msg "已同步 WASM（客户端版本 $(basename "$(dirname "$(dirname "$WASM_SRC")")")）"
elif [ ! -f "$VENDOR_DIR/qoder_auth_wasm_bg.wasm" ]; then
  warn "找不到客户端 WASM（$CLIENT_ROOT/*/resources/qoder-auth-wasm/）"
  warn "请安装 Windows QwenWorkCN 客户端后再运行"
  exit 1
else
  warn "未找到新客户端 WASM，沿用 vendor/ 中现有版本"
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
  -v "${STATE_DIR}:/data:ro" \
  -e "QW2A_API_KEY=${API_KEY}" \
  "$IMAGE_NAME" >/dev/null

msg "容器已启动，等待就绪..."
for i in $(seq 1 20); do
  if curl -sf -o /dev/null "http://127.0.0.1:${PORT}/v1/models" -H "Authorization: Bearer ${API_KEY}"; then
    echo
    msg "就绪: http://127.0.0.1:${PORT}/v1  (key=${API_KEY})"
    msg "测试: curl http://127.0.0.1:${PORT}/v1/chat/completions -H 'Authorization: Bearer ${API_KEY}' -H 'Content-Type: application/json' -d '{\"model\":\"flash\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}],\"max_tokens\":32}'"
    exit 0
  fi
  sleep 1
done

warn "服务 20 秒内未就绪，查看日志: docker logs $CONTAINER_NAME"
exit 1
