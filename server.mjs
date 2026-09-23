#!/usr/bin/env node
// qwenwork2api v2 — 直连 gateway.qwenwork.cn 的 OpenAI 兼容服务
// 架构：Windows 客户端文件只读挂载（auth-v2.dat 启动解密+定时轮询跟进，WASM 静态加载）+ business.sub_task 路由
// 参考 PoC：wasm-poc/wbiz.mjs（2026-09-23 实测打通）
import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';

// ---------- 配置 ----------
const PORT = parseInt(process.env.QW2A_PORT || '8787', 10);
const API_KEY = process.env.QW2A_API_KEY || 'sk-qwenwork-20857f643cf5e71d2b2ed8447b01c0f0';
// Windows 客户端（只读挂载）：数据目录 QwenWorkCN → /client；WASM 由 docker-run.sh 确认最新版后单文件挂载 → /wasm
const AUTH_DAT = process.env.QW2A_AUTH_DAT || '/client/auth-v2.dat';
const AES_KEY = (process.env.QW2A_AES_KEY || '').trim();      // DPAPI 提取的 AES-256 密钥（64 位 hex）
const MACHINE_ID = (process.env.QW2A_MACHINE_ID || '').trim();
const WASM_PATH = process.env.QW2A_WASM || '/wasm/qoder_auth_wasm_bg.wasm';
const WATCH_INTERVAL_SEC = Math.max(1, parseInt(process.env.QW2A_WATCH_INTERVAL_SEC || '30', 10));
const ORIGIN = 'https://gateway.qwenwork.cn';
const COSY_VERSION = process.env.QW2A_COSY_VERSION || '1.1.59'; // docker-run.sh 从客户端 runtime-manifest 提取注入
const REQUEST_TIMEOUT = parseInt(process.env.QW2A_TIMEOUT_MS || '180000', 10);

const MODELS = {
  pro: { key: 'pro', display_name: '高级', name: 'QwenWork 高级 (Pro)' },
  flash: { key: 'flash', display_name: '标准', name: 'QwenWork 标准 (Flash)' },
  'qwen3.8-max-preview': { key: 'qwen3.8-max-preview', display_name: 'Qwen3.8-Max', name: 'Qwen3.8-Max' },
};

function mapModel(name) {
  const m = String(name || '').trim();
  switch (m) {
    case '': case 'auto': case 'advanced': case 'pro': return 'pro';
    case 'lite': case 'flash': return 'flash';
    case 'max': case 'qwen3.8-max': case 'qwen3.8-max-preview': return 'qwen3.8-max-preview';
    default: return m;
  }
}

// ---------- WASM 签名层（自包含 wasm-bindgen shim） ----------
let heap = new Array(1028).fill(undefined);
let freeHead = 1028;
const addHeap = (o) => { if (freeHead === heap.length) heap.push(heap.length + 1); const i = freeHead; freeHead = heap[i]; heap[i] = o; return i; };
const getHeap = (i) => heap[i];
const dropHeap = (i) => { if (i < 1028) return; heap[i] = freeHead; freeHead = i; };

let Pn = null, memU8 = null, memDV = null;
const U8 = () => { if (!memU8 || memU8.byteLength === 0 || memU8.buffer !== Pn.memory.buffer) memU8 = new Uint8Array(Pn.memory.buffer); return memU8; };
const DV = () => { if (!memDV || memDV.buffer !== Pn.memory.buffer) memDV = new DataView(Pn.memory.buffer); return memDV; };
const I1e = (ptr, len) => U8().subarray(ptr >>> 0, (ptr >>> 0) + len);
const enc = new TextEncoder(), dec = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
const readStr = (p, l) => dec.decode(U8().subarray(p, p + l));
const jqe = (fn, args) => { try { return fn.apply(null, args); } catch (e) { Pn.__wbindgen_export(addHeap(e)); } };

const cryptoObj = {
  getRandomValues: (arr) => globalThis.crypto.getRandomValues(arr),
  randomFillSync: (arr) => { globalThis.crypto.getRandomValues(arr); return arr; },
};
cryptoObj.msCrypto = cryptoObj;

function buildImports() {
  return {
    './qoder_auth_wasm_bg.js': {
      __wbindgen_object_drop_ref: (i) => dropHeap(i),
      __wbindgen_object_clone_ref: (i) => addHeap(getHeap(i)),
      __wbg_set_08463b1df38a7e29: (a, b, c) => addHeap(getHeap(a).set(getHeap(b), getHeap(c))),
      __wbg_getRandomValues_d49329ff89a07af1: function () { return jqe((A, e) => globalThis.crypto.getRandomValues(I1e(A, e)), arguments); },
      __wbg_crypto_38df2bab126b63dc: (i) => addHeap(getHeap(i).crypto ?? cryptoObj),
      __wbg_process_44c7a14e11e9f69e: (i) => addHeap(process),
      __wbg_versions_276b2795b1c6a219: (i) => addHeap(process.versions),
      __wbg_node_84ea875411254db1: (i) => addHeap(process.versions.node),
      __wbg_require_b4edbdcf3e2a1ef0: () => { throw new Error('require unsupported'); },
      __wbg_msCrypto_bd5a034af96bcba6: (i) => addHeap(cryptoObj),
      __wbg_getRandomValues_c44a50d8cfdaebeb: function () { return jqe((A, e) => getHeap(A).getRandomValues(getHeap(e)), arguments); },
      __wbg_randomFillSync_6c25eac9869eb53c: function () { return jqe((A, e) => getHeap(A).randomFillSync(getHeap(e)), arguments); },
      __wbg_call_d578befcc3145dee: function () { return jqe(function (A, e, t) { return addHeap(getHeap(A).call(getHeap(e), getHeap(t))); }, arguments); },
      __wbg_new_with_length_9cedd08484b73942: (n) => addHeap(new Uint8Array(n >>> 0)),
      __wbg_length_0c32cb8543c8e4c8: (i) => getHeap(i).length,
      __wbg_prototypesetcall_3e05eb9545565046: (a, b, c) => { Uint8Array.prototype.set.call(I1e(a, b), getHeap(c)); },
      __wbg_subarray_0f98d3fb634508ad: (a, b, c) => addHeap(getHeap(a).subarray(b >>> 0, c >>> 0)),
      __wbg_new_99cabae501c0a8a0: () => addHeap(new Map()),
      __wbg_now_88621c9c9a4f3ffc: () => Date.now(),
      __wbg_static_accessor_GLOBAL_THIS_a1248013d790bf5f: () => addHeap(globalThis),
      __wbg_static_accessor_SELF_24f78b6d23f286ea: () => addHeap(globalThis),
      __wbg_static_accessor_GLOBAL_f2e0f995a21329ff: () => addHeap(globalThis),
      __wbg_static_accessor_WINDOW_59fd959c540fe405: () => addHeap(undefined),
      __wbg___wbindgen_throw_81fc77679af83bc6: (p, l) => { throw new Error(readStr(p, l)); },
      __wbg_Error_2e59b1b37a9a34c3: (p, l) => addHeap(new Error(readStr(p, l))),
      __wbg___wbindgen_is_object_40c5a80572e8f9d3: (i) => (typeof getHeap(i) === 'object' && getHeap(i) !== null),
      __wbg___wbindgen_is_string_b29b5c5a8065ba1a: (i) => (typeof getHeap(i) === 'string'),
      __wbg___wbindgen_is_function_49868bde5eb1e745: (i) => (typeof getHeap(i) === 'function'),
      __wbg___wbindgen_is_undefined_c0cca72b82b86f4d: (i) => (getHeap(i) === undefined),
      __wbindgen_cast_0000000000000001: (a, b) => addHeap(I1e(a, b)),
      __wbindgen_cast_0000000000000002: (a, b) => addHeap(readStr(a, b)),
    },
  };
}

function passStr(s, malloc, realloc) {
  const str = s ?? '';
  if (realloc === undefined) {
    const t = enc.encode(str);
    const p = malloc(t.length, 1) >>> 0;
    U8().subarray(p, p + t.length).set(t);
    return { ptr: p, len: t.length };
  }
  let i = str.length, p = malloc(i, 1) >>> 0, u = U8(), o = 0, src = str;
  for (; o < i; o++) { const c = src.charCodeAt(o); if (c > 127) break; u[p + o] = c; }
  if (o !== i) {
    if (o !== 0) src = src.slice(o);
    p = realloc(p, i, i = o + 3 * src.length, 1) >>> 0;
    o += enc.encodeInto(src, U8().subarray(p + o, p + i)).written;
    p = realloc(p, i, o, 1) >>> 0;
  }
  return { ptr: p, len: o };
}

// WASM 调用串行化（wasm 内存共享，避免并发竞争）
let wasmQueue = Promise.resolve();
const withWasm = (fn) => { const p = wasmQueue.then(fn); wasmQueue = p.catch(() => {}); return p; };

// WASM 热加载：优先从挂载的客户端程序目录动态发现最新版本的 WASM 与 cosy 版本号，
// 客户端升级（新增版本目录）或 WASM 文件变化时自动重新实例化并作废签名上下文。
let ex = null;
function loadWasm() {
  Pn = new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(WASM_PATH)), buildImports()).exports;
  ex = Pn;
}

function genAuthFields(userInfoJson) {
  const sp = ex.__wbindgen_add_to_stack_pointer(-16);
  try {
    const s = passStr(userInfoJson, ex.__wbindgen_export2, ex.__wbindgen_export3);
    ex.generate_runtime_auth_fields(sp, s.ptr, s.len);
    const dv = DV();
    const flag = dv.getInt32(sp + 8, true);
    if (flag) throw new Error('generate_runtime_auth_fields failed');
    return JSON.parse(readStr(dv.getInt32(sp, true), dv.getInt32(sp + 4, true)));
  } finally { ex.__wbindgen_add_to_stack_pointer(16); }
}

function newCtx(machineId, cosyVersion, userInfoJson, clientMeta) {
  const sp = ex.__wbindgen_add_to_stack_pointer(-16);
  try {
    const ps = [machineId, cosyVersion, userInfoJson, clientMeta].map((a) => passStr(a, ex.__wbindgen_export2, ex.__wbindgen_export3));
    ex.qodercontext_new(sp, ps[0].ptr, ps[0].len, ps[1].ptr, ps[1].len, ps[2].ptr, ps[2].len, ps[3].ptr, ps[3].len);
    const dv = DV();
    const flag = dv.getInt32(sp + 8, true);
    if (flag) {
      const e = getHeap(dv.getInt32(sp + 4, true));
      throw new Error(e && e.message ? e.message : String(e));
    }
    return dv.getInt32(sp, true) >>> 0;
  } finally { ex.__wbindgen_add_to_stack_pointer(16); }
}

function prepareInfer(ctxPtr, origin, bodyStr, modelKey, modelSource) {
  const sp = ex.__wbindgen_add_to_stack_pointer(-16);
  try {
    const ps = [origin, bodyStr, modelKey, modelSource].map((x) => passStr(x, ex.__wbindgen_export2, ex.__wbindgen_export3));
    ex.qodercontext_prepareInferRequest(sp, ctxPtr, ps[0].ptr, ps[0].len, ps[1].ptr, ps[1].len, ps[2].ptr, ps[2].len, ps[3].ptr, ps[3].len);
    const dv = DV();
    const flag = dv.getInt32(sp + 8, true);
    if (flag) {
      const e = getHeap(dv.getInt32(sp + 4, true));
      throw new Error(e && e.message ? e.message : String(e));
    }
    return dv.getInt32(sp, true) >>> 0;
  } finally { ex.__wbindgen_add_to_stack_pointer(16); }
}

const retStr = (p, fn) => {
  const sp = ex.__wbindgen_add_to_stack_pointer(-16);
  try {
    ex[fn](sp, p);
    const dv = DV();
    return readStr(dv.getInt32(sp, true), dv.getInt32(sp + 4, true));
  } finally { ex.__wbindgen_add_to_stack_pointer(16); }
};

function readRequestResult(rp) {
  const url = retStr(rp, 'requestresult_url');
  const body = retStr(rp, 'requestresult_body');
  const hh = ex.requestresult_headers(rp);
  const hdrs = {};
  const m = getHeap(hh);
  if (m && typeof m.forEach === 'function') m.forEach((v, k) => { hdrs[String(k)] = String(v); });
  return { url, body, headers: hdrs };
}

// ---------- token / 上下文管理 ----------
// 唯一来源：挂载的 Windows 客户端 auth-v2.dat（AES-GCM 密文）。
// 磁盘访问只发生在启动时和后台定时 stat（默认 30s，QW2A_WATCH_INTERVAL_SEC 可调），请求路径纯内存。
let curToken = null, curCtx = 0, ctxToken = null;

function decryptAuthDat(datPath, keyHex) {
  const key = Buffer.from(keyHex, 'hex');
  const data = fs.readFileSync(datPath);
  if (data.subarray(0, 3).toString('ascii') !== 'v10') throw new Error('auth-v2.dat 前缀非 v10');
  const nonce = data.subarray(3, 15), tag = data.subarray(data.length - 16), cipher = data.subarray(15, data.length - 16);
  const d = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  d.setAuthTag(tag);
  const j = JSON.parse(Buffer.concat([d.update(cipher), d.final()]).toString('utf8'));
  if (!j.token || !j.user || !j.user.id) throw new Error('解密成功但缺少 token/user.id');
  return j;
}

// 启动时 / 后台轮询 tick 时调用：解密并更新内存 token（磁盘读取仅此与 watchAuthDat 两处）
function loadTokenFromDisk() {
  if (!/^[0-9a-fA-F]{64}$/.test(AES_KEY)) throw new Error('缺少有效 AES 密钥（QW2A_AES_KEY，64 位 hex）');
  const auth = decryptAuthDat(AUTH_DAT, AES_KEY);
  curToken = auth;
  return auth;
}

// 请求路径调用：纯内存返回，零磁盘交互
function readToken() {
  if (!curToken) throw new Error('token 尚未加载（等待客户端 auth-v2.dat 就绪）');
  return curToken;
}

function tokenExpiryInfo() {
  try {
    const jwt = JSON.parse(Buffer.from(curToken.token.split('.')[1], 'base64url').toString('utf8'));
    if (!jwt.exp) return null;
    const ms = jwt.exp * 1000 - Date.now();
    return { exp: new Date(jwt.exp * 1000).toISOString(), ms_remaining: ms, expired: ms < 0 };
  } catch { return null; }
}

function readMachineId() {
  if (MACHINE_ID) return MACHINE_ID;
  console.warn('[qwenwork2api] 未设置 QW2A_MACHINE_ID，使用随机值（上游可能视为新设备）');
  return crypto.randomUUID();
}

// 后台监听挂载的 auth-v2.dat：每 WATCH_INTERVAL_SEC 秒 stat 一次，mtime 变化即重新解密。
// stat 轮询而非 inotify：bind mount（WSL2 /mnt/c 下为 9p）上事件不可靠，GLM_proxy 同款方案。
function watchAuthDat() {
  try { fs.statSync(AUTH_DAT); } catch {
    console.error(`[qwenwork2api] 未找到 ${AUTH_DAT}，后台监听未启用`);
    return;
  }
  fs.watchFile(AUTH_DAT, { interval: WATCH_INTERVAL_SEC * 1000 }, (curr, prev) => {
    if (curr.mtimeMs === prev.mtimeMs) return;
    try {
      const auth = decryptAuthDat(AUTH_DAT, AES_KEY);
      const changed = !curToken || curToken.token !== auth.token;
      curToken = auth;
      if (changed) console.log(`[qwenwork2api] token 已刷新（用户 ${auth.user.name || auth.user.id}，过期 ${auth.expiresAt || '?'}），签名上下文下一请求重建`);
    } catch (e) {
      console.error(`[qwenwork2api] auth-v2.dat 解密失败（${e.message}，多为客户端写入中），保留当前 token`);
    }
  });
  console.log(`[qwenwork2api] 已监听 ${AUTH_DAT}（每 ${WATCH_INTERVAL_SEC}s 检查一次，客户端刷新/切号自动跟进）`);
}

function ensureCtx() {
  const auth = readToken();
  if (curCtx && ctxToken === auth) return curCtx;
  return withWasm(() => {
    if (curCtx && ctxToken === auth) return curCtx;
    // ★ 身份 blob 只用 2 个字段（多了 info 长度会偏离客户端的 856）
    const uiBase = { uid: auth.user.id, security_oauth_token: auth.token };
    const f = genAuthFields(JSON.stringify(uiBase));
    const userInfo = JSON.stringify({ ...uiBase, ...f });
    curCtx = newCtx(readMachineId(), COSY_VERSION, userInfo,
      JSON.stringify({ client_type: '6', business_product: 'qoder_work', business_type: 'agent', scene: 'qwork' }));
    ctxToken = auth;
    return curCtx;
  });
}

// ---------- 上游请求体构造（对齐客户端真实结构） ----------
function contentText(v) {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    let out = '';
    for (const p of v) if (p && typeof p === 'object' && typeof p.text === 'string') out += p.text;
    return out;
  }
  if (v == null) return '';
  return JSON.stringify(v);
}

function buildUpstreamBody(payload, modelKey, modelInfo) {
  const raw = Array.isArray(payload.messages) ? payload.messages : [];
  const sysParts = [];
  const msgs = [];
  let lastUser = '';
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    const text = contentText(m.content);
    if (m.role === 'system') { if (text) sysParts.push(text); continue; }
    msgs.push({ role: m.role, content: text, contents: [{ type: 'text', text }] });
    if (m.role === 'user' && text) lastUser = text;
  }
  if (!lastUser) {
    for (const m of msgs) if (m.role === 'user' && m.content) { lastUser = m.content; break; }
  }
  if (!lastUser) lastUser = 'ping';

  const params = {};
  for (const k of ['temperature', 'top_p', 'max_tokens', 'presence_penalty', 'frequency_penalty']) {
    if (payload[k] !== undefined && payload[k] !== null) params[k] = payload[k];
  }
  if (params.max_tokens === undefined) params.max_tokens = 32000;
  params.context_length = 1000000;

  const rid = crypto.randomUUID();
  const bizId = crypto.randomUUID();
  return {
    bodyObj: {
      request_id: rid,
      request_set_id: bizId,
      chat_record_id: rid,
      session_id: crypto.randomUUID(),
      stream: true, // 上游始终流式，客户端需要非流式时本地聚合
      chat_task: 'FREE_INPUT',
      chat_context: {
        text: lastUser,
        features: [],
        extra: { context: [], modelConfig: { key: modelKey, is_reasoning: true }, originalContent: lastUser },
        chatPrompt: '',
        imageUrls: null,
      },
      is_reply: true,
      is_retry: false,
      source: 1,
      version: '3',
      agent_id: 'agent_common',
      task_id: 'common',
      session_type: 'qoder_work',
      aliyun_user_type: '',
      model_config: {
        key: modelKey,
        display_name: modelInfo.display_name,
        model: '',
        format: 'openai',
        is_vl: true,
        is_reasoning: true,
        api_key: '',
        url: '',
        source: 'system',
        max_input_tokens: 1000000,
      },
      custom_model: null,
      system: sysParts.join('\n\n'),
      messages: msgs,
      tools: Array.isArray(payload.tools) ? payload.tools : [],
      parameters: params,
      // ★★★ 关键字段：服务端靠 business.sub_task 路由模型目录，缺失即 503 Model catalog unavailable
      business: {
        product: 'qoder_work',
        version: COSY_VERSION,
        type: 'agent',
        id: bizId,
        name: 'chat',
        begin_at: Date.now(),
        stage: 'start',
        sub_task: 'ws_builtin_general',
      },
    },
    lastUser,
  };
}

// ---------- SSE 转换 ----------
// 上游帧: data:{"headers":...,"body":"<OpenAI chunk JSON 字符串>","statusCodeValue":200}
// 转成标准 OpenAI SSE: data:<chunk>
function parseOuterFrame(line) {
  if (!line.startsWith('data:')) return null;
  const raw = line.slice(5);
  if (!raw || raw === '[DONE]') return { done: true };
  try {
    const outer = JSON.parse(raw);
    if (typeof outer.statusCodeValue === 'number' && outer.statusCodeValue >= 400) {
      let msg = raw;
      try { const b = JSON.parse(outer.body); msg = b.message || outer.body || raw; } catch {}
      return { error: new Error(msg), status: outer.statusCodeValue };
    }
    return { chunk: typeof outer.body === 'string' ? outer.body : null };
  } catch {
    return null;
  }
}

function rewriteChunkModel(chunkStr, model) {
  try {
    const j = JSON.parse(chunkStr);
    if (j && j.model) j.model = model;
    return JSON.stringify(j);
  } catch { return chunkStr; }
}

// ---------- HTTP 服务 ----------
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 64 * 1024 * 1024) { reject(new Error('body too large')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function readBearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}

function sendJson(res, status, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(s), 'Access-Control-Allow-Origin': '*' });
  res.end(s);
}

const stats = { requests: 0, failures: 0, startedAt: Date.now() };

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    });
    return res.end();
  }
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  try {
    if (url.pathname === '/' && req.method === 'GET') {
      let tok = null;
      try { readToken(); tok = { source: 'auth-v2.dat', watch_interval_sec: WATCH_INTERVAL_SEC, ...(tokenExpiryInfo() || {}) }; } catch (e) { tok = { error: e.message }; }
      return sendJson(res, 200, {
        service: 'qwenwork2api', status: 'ok',
        models: Object.keys(MODELS),
        token: tok,
        stats: { ...stats, uptime_sec: Math.floor((Date.now() - stats.startedAt) / 1000) },
        endpoints: ['/v1/models', '/v1/chat/completions'],
      });
    }

    if (url.pathname === '/v1/models' && req.method === 'GET') {
      if (readBearer(req) !== API_KEY) return sendJson(res, 401, { error: { message: 'invalid api key', type: 'invalid_api_key' } });
      const created = 1700000000;
      return sendJson(res, 200, {
        object: 'list',
        data: Object.entries(MODELS).map(([id, m]) => ({
          id, object: 'model', created, owned_by: 'qwenwork',
          context_length: 1000000, max_completion_tokens: 32768, display_name: m.display_name,
          supported_generation_methods: ['chat'],
        })),
      });
    }

    if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
      if (readBearer(req) !== API_KEY) return sendJson(res, 401, { error: { message: 'invalid api key', type: 'invalid_api_key' } });

      const payload = JSON.parse(await readBody(req));
      stats.requests++;
      if (!Array.isArray(payload.messages)) return sendJson(res, 400, { error: { message: 'messages is required', type: 'invalid_request_error' } });

      const model = mapModel(payload.model || 'pro');
      const modelInfo = MODELS[model] || { key: model, display_name: model };
      const wantStream = payload.stream === true;

      // token 未就绪/已过期统一 503 + server_error：zcode 对 5xx 自动重试（401 认证类不重试），
      // 客户端刷新 token 后（最迟 WATCH_INTERVAL_SEC 秒跟进）重试即成功
      const awaitRefresh = (why) => sendJson(res, 503, { error: {
        message: `${why}，等待客户端刷新 token（容器每 ${WATCH_INTERVAL_SEC}s 自动跟进，请重试）`,
        type: 'server_error', code: 'token_await_refresh' } });
      let auth;
      try { auth = readToken(); } catch (e) { return awaitRefresh(`token 不可用（${e.message}）`); }
      // JWT 过期预检
      try {
        const jwt = JSON.parse(Buffer.from(auth.token.split('.')[1], 'base64url').toString('utf8'));
        if (jwt.exp && jwt.exp * 1000 < Date.now()) return awaitRefresh('token 已过期');
      } catch {}

      const ctx = await ensureCtx(); // 先于构造请求体：WASM/cosy 版本热重载后 business.version 才能同步
      const { bodyObj } = buildUpstreamBody(payload, model, modelInfo);
      const bodyStr = JSON.stringify(bodyObj);

      const { url: upUrl, headers: upHeaders, body: upBody } = await withWasm(() =>
        readRequestResult(prepareInfer(ctx, ORIGIN, bodyStr, model, 'system')));

      const upRes = await fetch(upUrl, { method: 'POST', headers: upHeaders, body: upBody, signal: AbortSignal.timeout(REQUEST_TIMEOUT) });

      if (!upRes.ok) {
        const t = await upRes.text().catch(() => '');
        if (upRes.status === 401 || upRes.status === 403) return awaitRefresh(`上游 ${upRes.status}（token 已失效）`);
        return sendJson(res, 502, { error: { message: `upstream ${upRes.status}: ${t.slice(0, 300)}`, type: 'upstream_error' } });
      }

      const reader = upRes.body.getReader();
      const decoder = new TextDecoder();

      if (wantStream) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        });
        let buf = '';
        const pump = async () => {
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              buf += decoder.decode(value, { stream: true });
              let idx;
              while ((idx = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, idx).replace(/\r$/, '');
                buf = buf.slice(idx + 1);
                if (!line) continue;
                const f = parseOuterFrame(line);
                if (!f) continue;
                if (f.error) { res.write(`data: ${JSON.stringify({ error: { message: f.error.message, type: 'upstream_error' } })}\n\n`); break; }
                if (f.done) continue;
                if (f.chunk) res.write(`data: ${rewriteChunkModel(f.chunk, payload.model || model)}\n\n`);
              }
            }
            res.write('data: [DONE]\n\n');
          } catch (e) {
            try { res.write(`data: ${JSON.stringify({ error: { message: String(e.message || e), type: 'upstream_error' } })}\n\n`); } catch {}
          } finally { try { res.end(); } catch {} try { reader.cancel(); } catch {} }
        };
        req.on('close', () => { try { reader.cancel(); } catch {} });
        return pump();
      }

      // 非流式：聚合
      let content = '', reasoning = '', finishReason = null, usage = null, respId = '', created = 0;
      const toolCalls = [];
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).replace(/\r$/, '');
          buf = buf.slice(idx + 1);
          if (!line) continue;
          const f = parseOuterFrame(line);
          if (!f || f.done) continue;
          if (f.error) return sendJson(res, 502, { error: { message: f.error.message, type: 'upstream_error' } });
          if (!f.chunk) continue;
          try {
            const c = JSON.parse(f.chunk);
            respId = c.id || respId; created = c.created || created;
            if (c.usage) usage = c.usage;
            for (const ch of c.choices || []) {
              const d = ch.delta || {};
              if (typeof d.content === 'string') content += d.content;
              if (typeof d.reasoning_content === 'string') reasoning += d.reasoning_content;
              if (ch.finish_reason) finishReason = ch.finish_reason;
              if (Array.isArray(d.tool_calls)) {
                for (const tc of d.tool_calls) {
                  const i = tc.index ?? 0;
                  if (!toolCalls[i]) toolCalls[i] = { id: tc.id || '', type: 'function', function: { name: '', arguments: '' } };
                  if (tc.id) toolCalls[i].id = tc.id;
                  if (tc.function) {
                    if (tc.function.name) toolCalls[i].function.name += tc.function.name;
                    if (tc.function.arguments) toolCalls[i].function.arguments += tc.function.arguments;
                  }
                }
              }
            }
          } catch {}
        }
      }
      const message = { role: 'assistant', content };
      if (reasoning) message.reasoning_content = reasoning;
      const tcs = toolCalls.filter(Boolean);
      if (tcs.length) message.tool_calls = tcs;
      return sendJson(res, 200, {
        id: respId || `chatcmpl-${crypto.randomUUID()}`,
        object: 'chat.completion',
        created: created || Math.floor(Date.now() / 1000),
        model: payload.model || model,
        choices: [{ index: 0, message, finish_reason: finishReason || 'stop' }],
        usage: usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      });
    }

    return sendJson(res, 404, { error: { message: `not found: ${req.method} ${url.pathname}`, type: 'invalid_request_error' } });
  } catch (e) {
    return sendJson(res, 500, { error: { message: String(e && e.message ? e.message : e), type: 'server_error' } });
  }
});

// ---------- 启动 ----------
try {
  loadWasm();
} catch (e) {
  console.error(`[qwenwork2api] WASM 加载失败（${WASM_PATH}）: ${e.message}`);
  console.error('[qwenwork2api] 客户端升级后请重跑 docker-run.sh 重新确认 WASM 并重建容器');
  process.exit(1);
}
try {
  const auth = loadTokenFromDisk();
  console.log(`[qwenwork2api] token 已加载（用户 ${auth.user.name || auth.user.id}，过期 ${auth.expiresAt || '?'}）`);
} catch (e) {
  console.error(`[qwenwork2api] token 加载失败（${AUTH_DAT}）: ${e.message}`);
  console.error('[qwenwork2api] 服务不退出，后台监听将在客户端登录后自动加载');
}
watchAuthDat();
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[qwenwork2api] listening on :${PORT} (key=${API_KEY.slice(0, 12)}...)`);
});
