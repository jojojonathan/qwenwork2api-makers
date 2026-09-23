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
const nc=(j)=>{const sp=stackAdj(-16);try{const ps=['','',j,''].map(a=>passStr(a,malloc,realloc));ex.qodercontext_new(sp,ps[0].ptr,ps[0].len,ps[1].ptr,ps[1].len,ps[2].ptr,ps[2].len,ps[3].ptr,ps[3].len);const dv=DV();return dv.getInt32(sp,true)>>>0;}finally{stackAdj(16);}};
const prep=(c,u,b,m,s)=>{const sp=stackAdj(-16);try{const ps=[u,b,m,s].map(x=>passStr(x,malloc,realloc));ex.qodercontext_prepareInferRequest(sp,c,ps[0].ptr,ps[0].len,ps[1].ptr,ps[1].len,ps[2].ptr,ps[2].len,ps[3].ptr,ps[3].len);const dv=DV();return dv.getInt32(sp,true)>>>0;}finally{stackAdj(16);}};
const rs=(p,fn)=>{const sp=stackAdj(-16);try{ex[fn](sp,p);const dv=DV();return readStr(dv.getInt32(sp,true),dv.getInt32(sp+4,true));}finally{stackAdj(16);}};

const f = gf(JSON.stringify({uid,security_oauth_token:token,organization_id:'',organization_tags:[],data_policy_agreed:true}));
const ctx = nc(JSON.stringify({uid,security_oauth_token:token,organization_id:'',organization_tags:[],data_policy_agreed:true,...f}));

const mode = process.argv[3] || 'plain';
const rid = crypto.randomUUID();
const body = JSON.stringify({request_id:rid,request_set_id:rid,chat_record_id:rid,session_id:crypto.randomUUID(),stream:true,chat_task:'FREE_INPUT',chat_context:{text:'say ok',features:[],extra:{context:[],modelConfig:{key:'qwen3.8-max-preview',is_reasoning:true,is_vl:true},originalContent:'say ok'},chatPrompt:'',imageUrls:null},is_reply:true,is_retry:false,source:1,version:'3',agent_id:'agent_common',task_id:'common',session_type:'qoder_work',aliyun_user_type:'',model_config:{key:'qwen3.8-max-preview',display_name:'Qwen3.8-Max',model:'',format:'openai',is_vl:true,is_reasoning:true,api_key:'',url:'',source:'system',max_input_tokens:1000000},system:'',messages:[{role:'user',content:'say ok'}],tools:[],parameters:{max_tokens:16}});
const rp = prep(ctx, 'https://gateway.qwenwork.cn', body, 'qwen3.8-max-preview', 'system');
let url = rs(rp, 'requestresult_url');
const encBody = rs(rp, 'requestresult_body');
const hdrs={}; getHeap(ex.requestresult_headers(rp)).forEach((v,k)=>{hdrs[String(k)]=String(v);});
const sendBody = mode === 'enc' ? encBody : body;
if (mode !== 'enc') url = url.replace('&Encode=1','');
console.log(`模式=${mode} rid=${rid.slice(0,8)} body=${sendBody.length} url含Encode=${url.includes('Encode')}`);
const r = await fetch(url, {method:'POST',headers:hdrs,body:sendBody,signal:AbortSignal.timeout(40000)});
console.log('HTTP', r.status);
const reader=r.body.getReader(), dec=new TextDecoder(); let buf=''; const t0=Date.now();
while(Date.now()-t0<30000){const {done,value}=await Promise.race([reader.read(),new Promise(x=>setTimeout(()=>x({done:true}),30000-(Date.now()-t0)))]);if(done)break;buf+=dec.decode(value,{stream:true});if(buf.length>1500)break;}
try{reader.cancel()}catch{}
console.log('SSE:', buf.slice(0,1200));
