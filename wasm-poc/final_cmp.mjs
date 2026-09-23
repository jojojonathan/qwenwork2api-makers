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
const gf=(j)=>{const sp=stackAdj(-16);try{const s=passStr(j,malloc,realloc);ex.generate_runtime_auth_fields(sp,s.ptr,s.len);const dv=DV();return JSON.parse(readStr(dv.getInt32(sp,true),dv.getInt32(sp+4,true)));}finally{stackAdj(16);}};
const nc4=(a1,a2,a3,a4)=>{const sp=stackAdj(-16);try{const ps=[a1,a2,a3,a4].map(a=>passStr(a,malloc,realloc));ex.qodercontext_new(sp,ps[0].ptr,ps[0].len,ps[1].ptr,ps[1].len,ps[2].ptr,ps[2].len,ps[3].ptr,ps[3].len);const dv=DV();return dv.getInt32(sp,true)>>>0;}finally{stackAdj(16);}};
const prep=(c,u,b,m,s)=>{const sp=stackAdj(-16);try{const ps=[u,b,m,s].map(x=>passStr(x,malloc,realloc));ex.qodercontext_prepareInferRequest(sp,c,ps[0].ptr,ps[0].len,ps[1].ptr,ps[1].len,ps[2].ptr,ps[2].len,ps[3].ptr,ps[3].len);const dv=DV();return dv.getInt32(sp,true)>>>0;}finally{stackAdj(16);}};
const rs=(p,fn)=>{const sp=stackAdj(-16);try{ex[fn](sp,p);const dv=DV();return readStr(dv.getInt32(sp,true),dv.getInt32(sp+4,true));}finally{stackAdj(16);}};

const MID='6d04097d-0a04-470d-a6cb-103856cde5cf';
const uiBase={uid,security_oauth_token:token};
const f=gf(JSON.stringify(uiBase));
const ui=JSON.stringify({...uiBase,...f});
const ctx=nc4(MID,'1.1.59',ui,JSON.stringify({client_type:'6',business_product:'qoder_work',business_type:'agent',scene:'qwork'}));
const body=JSON.stringify({request_id:'x',stream:true,chat_task:'FREE_INPUT',model_config:{key:'flash'},messages:[{role:'user',content:'hi'}]});
const rp=prep(ctx,'https://gateway.qwenwork.cn',body,'flash','system');
const h={}; getHeap(ex.requestresult_headers(rp)).forEach((v,k)=>{h[String(k)]=String(v);});

const client=JSON.parse(fs.readFileSync('/tmp/client_short.json','utf8'));
console.log('=== 头部逐字段对比 ===');
const keys=[...new Set([...Object.keys(h),...Object.keys(client.headers)])].sort();
for (const k of keys) {
  const mine=String(h[k]??'<缺失>'), cl=String(client.headers[k]??'<缺失>');
  const same = (k==='Cosy-Date'||k==='Authorization'||k==='Cosy-Key'||k==='Cosy-MachineId') ? '(动态)' : (mine===cl?'✓':'✗');
  if (mine!==cl) console.log(`  ${k}:`);
  if (mine!==cl) { console.log(`     客户端: ${cl.slice(0,70)}`); console.log(`     我的:   ${mine.slice(0,70)}`); }
}
console.log('\n相同的头:', keys.filter(k=>String(h[k])===String(client.headers[k])).join(', '));
