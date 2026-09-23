import fs from 'node:fs';
import crypto from 'node:crypto';
import * as W from '/tmp/wasmcore.mjs';
const { ex, malloc, realloc, passStr, readStr, DV, getHeap, stackAdj } = W;
const key = Buffer.from(process.argv[2], 'hex');
const data = fs.readFileSync('/mnt/c/Users/64264/AppData/Roaming/QwenWorkCN/auth-v2.dat');
const nonce = data.subarray(3,15), tag = data.subarray(data.length-16), cipher = data.subarray(15, data.length-16);
const d = crypto.createDecipheriv('aes-256-gcm', key, nonce); d.setAuthTag(tag);
const auth = JSON.parse(Buffer.concat([d.update(cipher), d.final()]).toString('utf8'));
const uid=auth.user.id, token=auth.token;
const gf=(j)=>{const sp=stackAdj(-16);try{const s=passStr(j,malloc,realloc);ex.generate_runtime_auth_fields(sp,s.ptr,s.len);const dv=DV();return JSON.parse(readStr(dv.getInt32(sp,true),dv.getInt32(sp+4,true)));}finally{stackAdj(16);}};
const nc4=(a1,a2,a3,a4)=>{const sp=stackAdj(-16);try{const ps=[a1,a2,a3,a4].map(a=>passStr(a,malloc,realloc));ex.qodercontext_new(sp,ps[0].ptr,ps[0].len,ps[1].ptr,ps[1].len,ps[2].ptr,ps[2].len,ps[3].ptr,ps[3].len);const dv=DV();return dv.getInt32(sp,true)>>>0;}finally{stackAdj(16);}};
const prep=(c,u,b,m,s)=>{const sp=stackAdj(-16);try{const ps=[u,b,m,s].map(x=>passStr(x,malloc,realloc));ex.qodercontext_prepareInferRequest(sp,c,ps[0].ptr,ps[0].len,ps[1].ptr,ps[1].len,ps[2].ptr,ps[2].len,ps[3].ptr,ps[3].len);const dv=DV();return dv.getInt32(sp,true)>>>0;}finally{stackAdj(16);}};
const rs=(p,fn)=>{const sp=stackAdj(-16);try{ex[fn](sp,p);const dv=DV();return readStr(dv.getInt32(sp,true),dv.getInt32(sp+4,true));}finally{stackAdj(16);}};

// 用最新捕获的 machineId
const cap=JSON.parse(fs.readFileSync('/mnt/c/Users/64264/qw-capture/requests.jsonl','utf8').trim().split('\n').filter(l=>l.includes('agent_chat_generation')).pop());
const MID=cap.headers['Cosy-MachineId'];
console.log('machineId:', MID);
const f=gf(JSON.stringify({uid,security_oauth_token:token}));
const ctx=nc4(MID,'1.1.59',JSON.stringify({uid,security_oauth_token:token,...f}),JSON.stringify({client_type:'6',business_product:'qoder_work',business_type:'agent',scene:'qwork'}));

// ★ 加 business 字段（客户端真实结构）
const rid=crypto.randomUUID();
const sess=crypto.randomUUID();
const text='hi '+Date.now();
const bizId=crypto.randomUUID();
const body=JSON.stringify({
  request_id:rid, request_set_id:bizId, chat_record_id:rid,
  session_id:sess,
  stream:true, chat_task:'FREE_INPUT',
  chat_context:{text,features:[],extra:{context:[],modelConfig:{key:'pro',is_reasoning:true},originalContent:text},chatPrompt:'',imageUrls:null},
  is_reply:true, is_retry:false, source:1, version:'3',
  agent_id:'agent_common', task_id:'common', session_type:'qoder_work', aliyun_user_type:'',
  model_config:{key:'pro',display_name:'高级',model:'',format:'openai',is_vl:true,is_reasoning:true,api_key:'',url:'',source:'system',max_input_tokens:1000000},
  custom_model:null,
  system:'', messages:[{role:'user',content:text,contents:[{type:'text',text}]}],
  tools:[],
  parameters:{max_tokens:32000, context_length:1000000},
  business:{product:'qoder_work',version:'1.1.59',type:'agent',id:bizId,name:'chat',begin_at:Date.now(),stage:'start',sub_task:'ws_builtin_general'}
});
console.log('body 明文长度:', body.length);
const rp=prep(ctx,'https://gateway.qwenwork.cn',body,'pro','system');
const url=rs(rp,'requestresult_url'), ob=rs(rp,'requestresult_body');
const h={}; getHeap(ex.requestresult_headers(rp)).forEach((v,k)=>{h[String(k)]=String(v);});
const r=await fetch(url,{method:'POST',headers:h,body:ob,signal:AbortSignal.timeout(60000)});
console.log('HTTP', r.status);
const reader=r.body.getReader(), dec=new TextDecoder(); let buf=''; const t0=Date.now();
while(Date.now()-t0<50000){const {done,value}=await Promise.race([reader.read(),new Promise(x=>setTimeout(()=>x({done:true}),50000-(Date.now()-t0)))]);if(done)break;buf+=dec.decode(value,{stream:true});if(buf.length>3000)break;}
try{reader.cancel()}catch{}
console.log('SSE:', buf.slice(0,2500));
