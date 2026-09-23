import fs from 'node:fs';
import crypto from 'node:crypto';
import * as W from '/tmp/wasmcore.mjs';
const { ex, malloc, realloc, passStr, readStr, DV, getHeap, stackAdj } = W;

const key = Buffer.from(process.argv[2], 'hex');
const data = fs.readFileSync('/mnt/c/Users/64264/AppData/Roaming/QwenWorkCN/auth-v2.dat');
const nonce = data.subarray(3,15), tag = data.subarray(data.length-16), cipher = data.subarray(15, data.length-16);
const d = crypto.createDecipheriv('aes-256-gcm', key, nonce); d.setAuthTag(tag);
const auth = JSON.parse(Buffer.concat([d.update(cipher), d.final()]).toString('utf8'));
const uid = auth.user.id, token = auth.token;

const gf=(j)=>{const sp=stackAdj(-16);try{const s=passStr(j,malloc,realloc);ex.generate_runtime_auth_fields(sp,s.ptr,s.len);const dv=DV();const f=dv.getInt32(sp+8,true);if(f)throw new Error('gf flag');return JSON.parse(readStr(dv.getInt32(sp,true),dv.getInt32(sp+4,true)));}finally{stackAdj(16);}};
const nc=(j)=>{const sp=stackAdj(-16);try{const ps=['','',j,''].map(a=>passStr(a,malloc,realloc));ex.qodercontext_new(sp,ps[0].ptr,ps[0].len,ps[1].ptr,ps[1].len,ps[2].ptr,ps[2].len,ps[3].ptr,ps[3].len);const dv=DV();const p=dv.getInt32(sp,true),e=dv.getInt32(sp+4,true),f=dv.getInt32(sp+8,true);if(f){const x=getHeap(e);throw new Error(x&&x.message?x.message:String(x));}return p>>>0;}finally{stackAdj(16);}};
const prep=(c,u,h,b,m)=>{const sp=stackAdj(-16);try{const ps=[u,h,b,m].map(a=>passStr(a,malloc,realloc));ex.qodercontext_prepareInferRequest(sp,c,ps[0].ptr,ps[0].len,ps[1].ptr,ps[1].len,ps[2].ptr,ps[2].len,ps[3].ptr,ps[3].len);const dv=DV();const p=dv.getInt32(sp,true),e=dv.getInt32(sp+4,true),f=dv.getInt32(sp+8,true);if(f){const x=getHeap(e);throw new Error(x&&x.message?x.message:String(x));}return p>>>0;}finally{stackAdj(16);}};
const rs=(p,fn)=>{const sp=stackAdj(-16);try{ex[fn](sp,p);const dv=DV();return readStr(dv.getInt32(sp,true),dv.getInt32(sp+4,true));}finally{stackAdj(16);}};

// 读取 umid machine token
let MT='', MCODE='';
try {
  const { execSync } = await import('node:child_process');
  const j = JSON.parse(execSync('"/mnt/c/Users/64264/.qwenworkcn/.bin/umid-win32-x64-48d1294f147c9d89/runtime-info.exe" </dev/null', {encoding:'utf8'}));
  MT = j.machineToken; MCODE = j.machineType;
} catch(e) { console.log('umid 读取失败:', e.message.slice(0,80)); }

const fields = gf(JSON.stringify({ uid, security_oauth_token: token, organization_id: '', organization_tags: [], data_policy_agreed: true }));
const ctx = nc(JSON.stringify({ uid, security_oauth_token: token, organization_id: '', organization_tags: [], data_policy_agreed: true, ...fields }));

const rid = crypto.randomUUID();
const bodyObj = { request_id: rid, request_set_id: rid, chat_record_id: rid, session_id: crypto.randomUUID(), stream: true, chat_task: 'FREE_INPUT', chat_context: { text: 'say ok', features: [], extra: { context: [], modelConfig: { key: 'qwen3.8-max-preview', is_reasoning: true, is_vl: true }, originalContent: 'say ok' }, chatPrompt: '', imageUrls: null }, is_reply: true, is_retry: false, source: 1, version: '3', agent_id: 'agent_common', task_id: 'common', session_type: 'qoder_work', aliyun_user_type: '', model_config: { key: 'qwen3.8-max-preview', display_name: 'Qwen3.8-Max', model: '', format: 'openai', is_vl: true, is_reasoning: true, api_key: '', url: '', source: 'system', max_input_tokens: 1000000 }, system: '', messages: [{ role: 'user', content: 'say ok' }], tools: [], parameters: { max_tokens: 16 } };
const bodyStr = JSON.stringify(bodyObj);

const rp = prep(ctx, 'https://gateway.qwenwork.cn', bodyStr, 'qwen3.8-max-preview', 'system');
const outUrl = rs(rp, 'requestresult_url');
const hdrs = {}; getHeap(ex.requestresult_headers(rp)).forEach((v,k)=>{ hdrs[String(k)] = String(v); });
const outBody = rs(rp, 'requestresult_body') || bodyStr;
console.log('WASM body 长度:', outBody.length, '| 内容:', outBody.slice(0,100));

// 补上 machine token（WASM 生成的为空）
// (machine token 由 WASM 生成)

console.log('=== 发送请求 ===');
console.log('URL:', outUrl);
console.log('Authorization 前 60:', (hdrs.Authorization||'').slice(0,60));
console.log('Cosy-Key 前 40:', (hdrs['Cosy-Key']||'').slice(0,40));
console.log('MachineToken:', MT ? MT.slice(0,30)+'...' : '(空)');
console.log('请求体长度:', outBody.length);

const r = await fetch(outUrl, { method: 'POST', headers: hdrs, body: outBody, signal: AbortSignal.timeout(40000) });
console.log('\nHTTP', r.status);
const reader = r.body.getReader(); const dec = new TextDecoder(); let buf='';
const t0=Date.now();
while (Date.now()-t0 < 30000) { const {done,value}=await Promise.race([reader.read(), new Promise(x=>setTimeout(()=>x({done:true}),30000-(Date.now()-t0)))]); if(done)break; buf+=dec.decode(value,{stream:true}); if(buf.length>2500)break; }
try{reader.cancel()}catch{}
console.log('--- SSE 前 2000 字符 ---');
console.log(buf.slice(0,2000));
