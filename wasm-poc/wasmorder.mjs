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
const prep4=(c,a,b,cc,dd)=>{const sp=stackAdj(-16);try{const ps=[a,b,cc,dd].map(x=>passStr(x,malloc,realloc));ex.qodercontext_prepareInferRequest(sp,c,ps[0].ptr,ps[0].len,ps[1].ptr,ps[1].len,ps[2].ptr,ps[2].len,ps[3].ptr,ps[3].len);const dv=DV();const p=dv.getInt32(sp,true),e=dv.getInt32(sp+4,true),f=dv.getInt32(sp+8,true);if(f){const x=getHeap(e);throw new Error(x&&x.message?x.message:String(x));}return p>>>0;}finally{stackAdj(16);}};
const rs=(p,fn)=>{const sp=stackAdj(-16);try{ex[fn](sp,p);const dv=DV();return readStr(dv.getInt32(sp,true),dv.getInt32(sp+4,true));}finally{stackAdj(16);}};

const f = gf(JSON.stringify({uid,security_oauth_token:token,organization_id:'',organization_tags:[],data_policy_agreed:true}));
const ctx = nc(JSON.stringify({uid,security_oauth_token:token,organization_id:'',organization_tags:[],data_policy_agreed:true,...f}));

const rid = crypto.randomUUID();
const body = JSON.stringify({request_id:rid,request_set_id:rid,chat_record_id:rid,session_id:crypto.randomUUID(),stream:true,chat_task:'FREE_INPUT',chat_context:{text:'say ok',features:[],extra:{context:[],modelConfig:{key:'qwen3.8-max-preview',is_reasoning:true,is_vl:true},originalContent:'say ok'},chatPrompt:'',imageUrls:null},is_reply:true,is_retry:false,source:1,version:'3',agent_id:'agent_common',task_id:'common',session_type:'qoder_work',aliyun_user_type:'',model_config:{key:'qwen3.8-max-preview',display_name:'Qwen3.8-Max',model:'',format:'openai',is_vl:true,is_reasoning:true,api_key:'',url:'',source:'system',max_input_tokens:1000000},system:'',messages:[{role:'user',content:'say ok'}],tools:[],parameters:{max_tokens:16}});
const O = 'https://gateway.qwenwork.cn';
const mk = 'qwen3.8-max-preview';

const orders = [
  ['(origin, body, mk, system)', [O, body, mk, 'system']],
  ['(origin, mk, body, system)', [O, mk, body, 'system']],
  ['(origin, system, body, mk)', [O, 'system', body, mk]],
  ['(body, origin, mk, system)', [body, O, mk, 'system']],
  ['(origin, body, system, mk)', [O, body, 'system', mk]],
];
for (const [name, args] of orders) {
  try {
    const rp = prep4(ctx, ...args);
    const url = rs(rp, 'requestresult_url');
    const ob = rs(rp, 'requestresult_body');
    const hdrs={}; getHeap(ex.requestresult_headers(rp)).forEach((v,k)=>{hdrs[String(k)]=String(v);});
    const xmk = hdrs['X-Model-Key'] || '';
    const r = await fetch(url, {method:'POST',headers:hdrs,body:ob,signal:AbortSignal.timeout(30000)});
    const t = await r.text();
    const m = t.match(/message\\?":\\?"([^\\"]+)/);
    console.log(`[${name}] body=${ob.length} X-Model-Key="${xmk.slice(0,30)}" → ${r.status} ${m?m[1]:t.slice(0,60).replace(/\n/g,' ')}`);
  } catch(e) { console.log(`[${name}] ERR ${e.message.slice(0,80)}`); }
}
