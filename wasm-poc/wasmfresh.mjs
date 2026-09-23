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
const nc4=(mid,cv,ui,meta)=>{const sp=stackAdj(-16);try{const ps=[mid,cv,ui,meta].map(a=>passStr(a,malloc,realloc));ex.qodercontext_new(sp,ps[0].ptr,ps[0].len,ps[1].ptr,ps[1].len,ps[2].ptr,ps[2].len,ps[3].ptr,ps[3].len);const dv=DV();return dv.getInt32(sp,true)>>>0;}finally{stackAdj(16);}};
const prep=(c,u,b,m,s)=>{const sp=stackAdj(-16);try{const ps=[u,b,m,s].map(x=>passStr(x,malloc,realloc));ex.qodercontext_prepareInferRequest(sp,c,ps[0].ptr,ps[0].len,ps[1].ptr,ps[1].len,ps[2].ptr,ps[2].len,ps[3].ptr,ps[3].len);const dv=DV();return dv.getInt32(sp,true)>>>0;}finally{stackAdj(16);}};
const rs=(p,fn)=>{const sp=stackAdj(-16);try{ex[fn](sp,p);const dv=DV();return readStr(dv.getInt32(sp,true),dv.getInt32(sp+4,true));}finally{stackAdj(16);}};

const fields = gf(JSON.stringify({uid,security_oauth_token:token,organization_id:'',organization_tags:[],data_policy_agreed:true}));
const userInfo = JSON.stringify({uid,security_oauth_token:token,organization_id:'',organization_tags:[],data_policy_agreed:true,...fields});
const ctx = nc4('63eb741c-5afe-4154-8d7b-1bf4039c5d95','1.1.59',userInfo,JSON.stringify({client_type:'6',business_product:'qoder_work',business_type:'agent',scene:'assistant'}));

function mkBody() {
  const rid = crypto.randomUUID();
  return { rid, body: JSON.stringify({request_id:rid,request_set_id:rid,chat_record_id:rid,session_id:crypto.randomUUID(),stream:true,chat_task:'FREE_INPUT',chat_context:{text:'say ok',features:[],extra:{context:[],modelConfig:{key:'qwen3.8-max-preview',is_reasoning:true,is_vl:true},originalContent:'say ok'},chatPrompt:'',imageUrls:null},is_reply:true,is_retry:false,source:1,version:'3',agent_id:'agent_common',task_id:'common',session_type:'qoder_work',aliyun_user_type:'',model_config:{key:'qwen3.8-max-preview',display_name:'Qwen3.8-Max',model:'',format:'openai',is_vl:true,is_reasoning:true,api_key:'',url:'',source:'system',max_input_tokens:1000000},system:'',messages:[{role:'user',content:'say ok'}],tools:[],parameters:{max_tokens:16}}) };
}

// 用同一 ctx 生成签名，但发送【明文 body + Encode=1】，每次全新 request_id
for (let i = 0; i < 3; i++) {
  const { rid, body } = mkBody();
  const rp = prep(ctx, 'https://gateway.qwenwork.cn', body, 'qwen3.8-max-preview', 'system');
  const url = rs(rp, 'requestresult_url');           // 含 &Encode=1
  const hdrs={}; getHeap(ex.requestresult_headers(rp)).forEach((v,k)=>{hdrs[String(k)]=String(v);});
  // 用明文 body 发送（签名是按明文 body 算的）
  const r = await fetch(url, {method:'POST',headers:hdrs,body,signal:AbortSignal.timeout(35000)});
  const t = await r.text();
  const m = t.match(/message\\?":\\?"([^\\"]+)/);
  console.log(`明文+Encode=1 [${rid.slice(0,8)}]: ${r.status} → ${m?m[1]:t.slice(0,90).replace(/\n/g,' ')}`);
  await new Promise(r=>setTimeout(r,1200));
}
