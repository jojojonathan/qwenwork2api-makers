# WASM 签名 PoC（方案1 验证）

## 背景
qwenwork2api 依赖的旧 JS cosy 签名已被官方 1.x 废弃，服务端对旧签名只返回
`503 Model catalog unavailable`（身份解析失败）。官方客户端 1.2.1 改用
`resources/qoder-auth-wasm/qoder_auth_wasm_bg.wasm`（Rust）生成签名。

## 已验证的结论（2026-09-23）
1. WASM 可在纯 Node（无需 Electron/Windows）中实例化并调用 —— `wasmcore.mjs` 是自包含
   wasm-bindgen shim。
2. 调用链与参数顺序（实测确认）：
   - `generate_runtime_auth_fields(userInfoJson)` → `{encrypt_user_info, key}`
     userInfoJson = `{uid, security_oauth_token, organization_id, organization_tags, data_policy_agreed}`
   - `new QoderContext("", "", userInfoJson, "")` —— 第 3 个参数才是 user info
   - `prepareInferRequest(ctx, origin, bodyStr, modelKey, modelSource)`
     - 第 2 参数传 origin（如 `https://gateway.qwenwork.cn`），传路径会重复拼接
     - 第 4 参数是模型 key 字符串，第 5 是 `"system"`
   - 读取：`requestresult_url` / `requestresult_body`（retptr 约定），
     `requestresult_headers`（返回 Map，需 getHeap 后 forEach）
3. WASM 生成的 URL 带 `&Encode=1`，body 被加密成 ~1228 字符；头 20 个，含
   `Authorization: Bearer COSY.<b64>.<sig>`、`Cosy-Key`、`Cosy-ClientType: 5` 等。
4. **认证已被服务端接受**：用 WASM 签名请求，错误从 `503 Model catalog unavailable`
   变为 `400 request_id is required` / `403 Duplicate request`（业务层幂等保护），
   证明签名与身份校验通过。
5. 仍未跑通一次成功的 chat 生成：加密 body + Encode=1 时仍返回 503，
   怀疑传给 WASM 的 body 结构/字段与客户端真实 `QoderInferRequest` 有差异，
   或缺少客户端先行的 catalog 预热步骤。

## 文件
- `wasmcore.mjs` —— WASM 加载 + wasm-bindgen shim（可复用）
- `wasmorder.mjs` —— 参数顺序探测（确认了 prepareInferRequest 签名）
- `wasmclean.mjs` —— 完整请求示例（明文/加密 body 两种模式）
- `wasmreal3.mjs` —— 驱动示例

## 运行
```bash
# AES 密钥（从 Windows Local State 的 DPAPI 解出，见记忆 qwenwork2api-1x-auth-migration）
node wasmclean.mjs <AES_KEY_HEX> enc
```

## 2026-09-23 晚 补充结论

6. **QoderContext 必须传 4 个参数**（从 SDK `dxe` 函数确认）：
   ```js
   new QoderContext(machineId, cosyVersion, userInfoJson, JSON.stringify(vg()))
   ```
   - 第 1 参数 machineId（客户端 `~/.qwenworkcn/machine-id`，即 auth-v2.dat 的 loginDeviceId）
   - 第 2 参数 cosyVersion（如 `1.1.59`）
   - 第 3 参数 userInfoJson（**必须**是 `{uid,security_oauth_token,organization_id,organization_tags,data_policy_agreed}`
     经 `generate_runtime_auth_fields` 补上 `encrypt_user_info`/`key`）
   - 第 4 参数客户端元数据 `vg()`：QwenWorkCN 用
     `{client_type:"6", business_product:"qoder_work", business_type:"agent", scene:"assistant"}`
     （CLI 版是 `client_type:"5", business_product:"cli"`）
7. 即使 4 参数正确、头全部补全（Cosy-Version/MachineId/MachineToken），**仍返回 503**；
   且从 Windows 宿主机（与成功客户端同一网络）发送**完全相同的请求**也是 503
   → 排除网络/IP/代理因素，问题在请求载荷（加密 body 的结构）本身。
8. 客户端成功的请求与我们的差异仍未定位。建议下一步：抓取客户端真实发出的加密 body
   （如 hook 其 fetch 或抓包），与我们 WASM 生成的 1228 字符 body 做二进制对比；
   或核对传给 WASM 的 body 字段是否与客户端 `QoderInferRequest` 完全一致
   （客户端日志有 `[QoderInferRequest details] model_config={...}` 可参考，
   其中 `is_reasoning:true`、`max_input_tokens:1000000`、`api_key` 非空）。

## 最终结论（2026-09-23 深夜）

### 已完全验证可行 ✅
**WASM 签名 + 身份认证 100% 可用**。铁证：
```bash
node wasmpre.mjs <AES_KEY_HEX>
# → GET https://gateway.qwenwork.cn/api/v2/model/list 返回 HTTP 200 + 完整模型目录
```
说明：只要用 WASM 签名，普通接口（model/list、userinfo 等）完全正常。

### 仍卡住的点 ❌
`prepareInferRequest`（chat 端点）无论怎么调都返回 `503 Model catalog unavailable`。
已系统排除：
- 网络/IP：从 Windows 宿主机发**完全相同**的请求也是 503（排除 WSL 代理/fake-IP）
- 认证：model/list 同签名 200（排除签名/身份）
- 客户端元数据：4 参数构造 + `{client_type:"6",business_product:"qoder_work",...}` 已正确应用
- 上下文头：Cosy-Version / Cosy-MachineId / Cosy-MachineToken / X-Request-ID / X-Session-ID 全补
- body 结构：严格照 SDK `$Wc`/`KWc` 构造（modelConfig 只有 key+is_reasoning）
- 明文 body vs 加密 body、api_key 取值、模型名、request_id 唯一性

### 关键线索（下一步突破口）
1. 用**加密 body + Encode=1** 时曾得到 `400 request_id is required` 和 `403 Duplicate request`
   —— 说明服务端**成功解密了我们的 body 并进入了业务逻辑**，只是内容不符预期。
2. 客户端日志显示 chat 前会先 `GET /api/v2/model/list` 预热 catalog，之后 chat 才 200。
   可能需要复现这个**前置预热 + 会话建立**流程（不是单纯签名问题）。
3. 建议抓取客户端真实发出的加密 body 做二进制对比（hook fetch 或抓包）。

## 2026-09-23 深夜 追加验证（用户已在客户端发消息，上游确认正常）

**用户 17:49 在官方客户端发消息 → 成功**（日志 `17-46-40.../qodercli.log` 有 11 次 status=200，
消息库记录 "国庆期间青岛市天气怎么样" + assistant Thinking 回复）。
→ **上游完全正常，问题确定在我们的请求构造。**

### 新发现：WASM 头可以填满
之前 `Cosy-Version`/`Cosy-MachineId`/`Cosy-MachineToken` 输出为空，是因为 `QoderContext` 第 1 参数
（machineId）传了空。**传入真实 machineId 后这三个头都有值**：
```js
new QoderContext('63eb741c-5afe-4154-8d7b-1bf4039c5d95', '1.1.59', userInfoJson, metaJson)
// → Cosy-Version: 1.1.59, Cosy-MachineId: <machineId>, Cosy-MachineToken: <machineId>
```
但即使 20 个头全有值，chat 仍 503。

### 已排除（本轮新增）
- session_type 取值（qodercli / qoder_work / qoder / 空）—— 全部 503
- 用客户端真实 session_id —— 503
- umid 真实 machineToken 填入 Cosy-MachineToken —— 503
- `prepareRequest` 签名 chat（带 Encode=1，1308 字符 body）—— 503
- flash 模型（客户端成功用的就是 flash）—— 503
- 环境变量 `QODER_DEVICE_TOKEN` 仅用于遥测，不是 chat 认证

### 有价值的旁证
- WASM 签名的 payload 结构：`Bearer COSY.<base64({"version":"v1","requestId":uuid,"info":<AES加密的身份>,"cosyVersion":..,"ideVersion":..})>.<32字符签名>`，`info` 是 AES 加密的身份 blob（内含 security_oauth_token）。
- `prepareInferRequest` 与 `prepareRequest` 生成的 URL 略有不同（后者只带 `?Encode=1`，前者带 `?FetchKeys=..&AgentId=..&Encode=1`）。
- 两个签名函数的 `Cosy-ClientIp` 头只有 `prepareRequest` 会生成。

### 结论
认证层已完全打通（model/list 200 证明），但 chat 端点的 `503 Model catalog unavailable`
在**所有**我们构造的请求下稳定复现，而官方客户端同一账号同一时刻正常。
说明存在一个我们尚未复现的**会话/上下文前提**（可能是官方客户端在服务端建立的会话绑定、
或某个我们没发现的头/字段）。手写复刻这条路成本已很高。
**下一步建议**：抓取官方客户端真实发出的 HTTP 请求（抓包 / hook fetch）做二进制级对比，
这是唯一能直接定位差异的方法。

## 2026-09-23 深夜 抓包对比结果（关键进展）

用 hook 注入 `qoderServerRequest` 抓到客户端真实请求（`C:\Users\64264\qw-capture\requests.jsonl`）。

### 抓包方法（可复用）
- 注入点：`app.asar.unpacked/.../qoder-worker-runtime.obf.mjs` 的 `async function To(A){`（即 `qoderServerRequest`，所有 HTTP 必经）
- 注入方式：文件开头插入延迟初始化的 `globalThis.__qwCapture`（用 `process.getBuiltinModule('node:fs')` 获取 fs，避开 ESM import 提升顺序问题）
- **注意**：改完必须重启客户端才生效（进程加载后不会热更新）
- 备份在 `...obf.mjs.orig-backup`

### 通过抓包对齐的关键差异（全部已修正）
1. **`Cosy-Scene` = `qwork`**（不是 `assistant`，那是 CLI 默认值）
2. **`Cosy-Data-Policy` = `disagree`**（不是 `agree`）
3. **machineId** 用客户端真实值（`~/.qwenworkcn/machine-id` 的内容会变，以抓包为准）
4. **身份 blob 只含 2 个字段**：`{uid, security_oauth_token}` → `encrypt_user_info` 长度 **856**（与客户端精确一致）。多传 `organization_id`/`organization_tags`/`data_policy_agreed` 会导致 940（偏长）
5. 客户端 chat 的 catalog 路径是 `/algo/api/v2/model/list?Encode=1`（带 `/algo` 前缀 + Encode=1）

修正后：**17 个静态头与客户端 100% 一致**，`encrypt_user_info` 长度精确匹配 856，但 **chat 仍返回 503**。

### 决定性证据
- **重放客户端真实请求**（原样 body + 原样头）→ `403 {"code":"103","message":"Duplicate request"}`
  → 服务端**接受并处理**了客户端的请求（幂等保护拦截重复），而我们构造的请求始终 503
  → 说明差异在**签名覆盖的内容**或**我们尚未复刻的某个环节**
- 客户端 `Cosy-Key` 在重试时**复用**（同一 requestId 两次请求用同一 Cosy-Key），我们每次新生成
- body 加密方式相同（字符集 65 个可打印 ASCII、比值 1.33-1.34 一致），客户端 body 明文约 3700-230000 字符（含完整 system prompt + 对话历史 + tools）

### 仍未定位
即使头部、身份、加密、URL 全部对齐，chat 仍 503。剩余可疑点：
1. `security_oauth_token` 可能是 jobToken（客户端 `payload_type="jobToken"`、`auth_type="qoder-browser"`），
   与 auth-v2.dat 的 OAuth token 不同 —— 但 info 长度 856 精确匹配说明 token 长度一致
2. 某个尚未发现的请求头或 body 字段
3. 服务端可能对 `Cosy-Key` 有会话级校验（客户端重试复用同一 key）

## 🎉 2026-09-23 22:26 攻克！根因 = body 缺 `business.sub_task` 字段

通过明文 hook（`prepareInferRequest` 包装层注入）抓到客户端加密前的真实 body，
发现我从未发送过的 **`business` 字段**：

```json
"business": {
  "product": "qoder_work",
  "version": "1.1.59",
  "type": "agent",
  "id": "<uuid>",
  "name": "你好",
  "begin_at": 1790173502142,
  "stage": "start",
  "sub_task": "ws_builtin_general"   // ★★ 就是它 ★★
}
```

服务端用 `business.sub_task` 路由模型目录。缺这个字段 → `503 Model catalog unavailable`。

### 成功验证（wbiz.mjs）
加上 business 字段后，chat 请求返回**真实流式响应**：
```
X-Model-Name: qwork-openai-chat-mode-pool, X-Provider-Name: maas-openai
data:{"choices":[{"delta":{"reasoning_content":"hi"},...}],"object":"chat.completion.chunk"}
```

### 同时确认的 body 其他必要结构
- `parameters: {max_tokens: 32000, context_length: 1000000}`（有 context_length）
- `request_set_id` 与 `request_id` 不同值（request_set_id = business.id）
- system/messages 为数组格式（客户端发完整 system prompt；但最小请求用空 system 也能通）

### 完整成功配方（wasmcore.mjs + wbiz.mjs）
1. DPAPI+AES-GCM 解 auth-v2.dat → token
2. `generate_runtime_auth_fields({uid, security_oauth_token})` → {encrypt_user_info(856), key}
3. `new QoderContext(machineId, '1.1.59', userInfoJson, {client_type:'6',business_product:'qoder_work',business_type:'agent',scene:'qwork'})`
4. body 加 `business` 字段（sub_task:'ws_builtin_general'）
5. `prepareInferRequest(ctx, origin, body, modelKey, 'system')` → 发送返回的 url/headers/body
