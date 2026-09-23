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
// prepareRequest(A=endpoint, e=path, t=method, i="auth", n=bodyJson, r=undefined)
const prepReq=(c,a,b,cc,dd,ee,ff)=>{const sp=stackAdj(-16);try{const ps=[a,b,cc,dd,ee,ff].map(x=>x===undefined?'':passStr(x,malloc,realloc));ex.qodercontext_prepareRequest(sp,c,ps[0].ptr,ps[0].len,ps[1].ptr,ps[1].len,ps[2].ptr,ps[2].len,ps[3].ptr,ps[3].len,ps[4].ptr,ps[4].len,ps[5].ptr,ps[5].len);const dv=DV();const p=dv.getInt32(sp,true),e=dv.getInt32(sp+4,true),f=dv.getInt32(sp+8,true);if(f){const x=getHeap(e);throw new Error(x&&x.message?x.message:String(x));}return p>>>0;}finally{stackAdj(16);}};
const rs=(p,fn)=>{const sp=stackAdj(-16);try{ex[fn](sp,p);const dv=DV();return readStr(dv.getInt32(sp,true),dv.getInt32(sp+4,true));}finally{stackAdj(16);}};
const MID='63eb741c-5afe-4154-8d7b-1bf4039c5d95';
const f = gf(JSON.stringify({uid,security_oauth_token:token,organization_id:'',organization_tags:[],data_policy_agreed:true}));
const userInfo = JSON.stringify({uid,security_oauth_token:token,organization_id:'',organization_tags:[],data_policy_agreed:true,...f});
const ctx = nc4(MID,'1.1.59',userInfo,JSON.stringify({client_type:'6',business_product:'qoder_work',business_type:'agent',scene:'assistant'}));

const text='hi '+Date.now();
const rid=crypto.randomUUID();
const body=JSON.stringify({request_id:rid,request_set_id:rid,chat_record_id:rid,session_id:crypto.randomUUID(),stream:true,chat_task:'FREE_INPUT',chat_context:{text,features:[],extra:{context:[],modelConfig:{key:'flash',is_reasoning:true},originalContent:text},chatPrompt:'',imageUrls:null},is_reply:true,is_retry:false,source:1,version:'3',agent_id:'agent_common',task_id:'common',session_type:'qoder_work',aliyun_user_type:'',model_config:{key:'flash',display_name:'标准',model:'',format:'openai',is_vl:true,is_reasoning:true,api_key:'',url:'',source:'system',max_input_tokens:1000000},custom_model:null,system:'',messages:[{role:'user',content:text,contents:[{type:'text',text}]}],tools:[],parameters:{max_tokens:16}});

const path='/algo/api/v2/service/pro/sse/agent_chat_generation';
const rp = prepReq(ctx, 'https://gateway.qwenwork.cn', path, 'POST', 'auth', body, undefined);
const url = rs(rp, 'requestresult_url');
const h={}; getHeap(ex.requestresult_headers(rp)).forEach((v,k)=>{h[String(k)]=String(v);});
console.log('URL:', url);
console.log('头:', Object.keys(h).join(','));
let outBody; try { outBody = rs(rp, 'requestresult_body'); } catch(e){ outBody = undefined; }
console.log('WASM body:', outBody ? outBody.length + ' 字符' : '(无)');
const send = outBody || body;
console.log('发送 body 长度:', send.length);
const r=await fetch(url,{method:'POST',headers:h,body:send,signal:AbortSignal.timeout(45000)});
console.log('HTTP', r.status);
const t=await r.text();
console.log('响应:', t.slice(0,700));
