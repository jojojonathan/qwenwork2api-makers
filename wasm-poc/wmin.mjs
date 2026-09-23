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
const nc4=(a1,a2,a3,a4)=>{const sp=stackAdj(-16);try{const ps=[a1,a2,a3,a4].map(a=>passStr(a,malloc,realloc));ex.qodercontext_new(sp,ps[0].ptr,ps[0].len,ps[1].ptr,ps[1].len,ps[2].ptr,ps[2].len,ps[3].ptr,ps[3].len);const dv=DV();const p=dv.getInt32(sp,true),e=dv.getInt32(sp+4,true),f=dv.getInt32(sp+8,true);if(f){const x=getHeap(e);throw new Error(x&&x.message?x.message:String(x));}return p>>>0;}finally{stackAdj(16);}};
const prep=(c,u,b,m,s)=>{const sp=stackAdj(-16);try{const ps=[u,b,m,s].map(x=>passStr(x,malloc,realloc));ex.qodercontext_prepareInferRequest(sp,c,ps[0].ptr,ps[0].len,ps[1].ptr,ps[1].len,ps[2].ptr,ps[2].len,ps[3].ptr,ps[3].len);const dv=DV();return dv.getInt32(sp,true)>>>0;}finally{stackAdj(16);}};
const rs=(p,fn)=>{const sp=stackAdj(-16);try{ex[fn](sp,p);const dv=DV();return readStr(dv.getInt32(sp,true),dv.getInt32(sp+4,true));}finally{stackAdj(16);}};

// 用客户端真实 machineId
const MID = process.argv[3] || '6d04097d-0a04-470d-a6cb-103856cde5cf';
// ★ 关键：只用 uid + token 两个字段
const uiBase = {uid, security_oauth_token: token};
const f = gf(JSON.stringify(uiBase));
const ui = JSON.stringify({...uiBase, ...f});
console.log('encrypt_user_info 长度:', f.encrypt_user_info.length, '(客户端为 856)');
const ctx = nc4(MID,'1.1.59',ui,JSON.stringify({client_type:'6',business_product:'qoder_work',business_type:'agent',scene:'qwork'}));

const text = process.argv[4] || ('hello ' + Date.now());
const rid=crypto.randomUUID();
const body=JSON.stringify({request_id:rid,request_set_id:rid,chat_record_id:rid,session_id:crypto.randomUUID(),stream:true,chat_task:'FREE_INPUT',chat_context:{text,features:[],extra:{context:[],modelConfig:{key:'flash',is_reasoning:true},originalContent:text},chatPrompt:'',imageUrls:null},is_reply:true,is_retry:false,source:1,version:'3',agent_id:'agent_common',task_id:'common',session_type:'qoder_work',aliyun_user_type:'',model_config:{key:'flash',display_name:'标准',model:'',format:'openai',is_vl:true,is_reasoning:true,api_key:'',url:'',source:'system',max_input_tokens:1000000},custom_model:null,system:'',messages:[{role:'user',content:text,contents:[{type:'text',text}]}],tools:[],parameters:{max_tokens:16}});
const rp=prep(ctx,'https://gateway.qwenwork.cn',body,'flash','system');
const url=rs(rp,'requestresult_url'), ob=rs(rp,'requestresult_body');
const h={}; getHeap(ex.requestresult_headers(rp)).forEach((v,k)=>{h[String(k)]=String(v);});
console.log('Scene:', h['Cosy-Scene'], '| DataPolicy:', h['Cosy-Data-Policy'], '| MachineId:', h['Cosy-MachineId']);
console.log('发送中...');
const r=await fetch(url,{method:'POST',headers:h,body:ob,signal:AbortSignal.timeout(60000)});
console.log('HTTP', r.status);
const reader=r.body.getReader(), dec=new TextDecoder(); let buf=''; const t0=Date.now();
while(Date.now()-t0<45000){const {done,value}=await Promise.race([reader.read(),new Promise(x=>setTimeout(()=>x({done:true}),45000-(Date.now()-t0)))]);if(done)break;buf+=dec.decode(value,{stream:true});if(buf.length>2500)break;}
try{reader.cancel()}catch{}
console.log('SSE:', buf.slice(0,2000));
