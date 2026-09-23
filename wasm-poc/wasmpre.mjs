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
// prepareRequest(endpoint, path, method, "auth", bodyJson, undefined)
const prepReq=(c,a,b,cc,dd,ee,ff)=>{const sp=stackAdj(-16);try{const ps=[a,b,cc,dd,ee,ff].map(x=>x===undefined?'':passStr(x,malloc,realloc));ex.qodercontext_prepareRequest(sp,c,ps[0].ptr,ps[0].len,ps[1].ptr,ps[1].len,ps[2].ptr,ps[2].len,ps[3].ptr,ps[3].len,ps[4].ptr,ps[4].len,ps[5].ptr,ps[5].len);const dv=DV();const p=dv.getInt32(sp,true),e=dv.getInt32(sp+4,true),f=dv.getInt32(sp+8,true);if(f){const x=getHeap(e);throw new Error(x&&x.message?x.message:String(x));}return p>>>0;}finally{stackAdj(16);}};
const rs=(p,fn)=>{const sp=stackAdj(-16);try{ex[fn](sp,p);const dv=DV();return readStr(dv.getInt32(sp,true),dv.getInt32(sp+4,true));}finally{stackAdj(16);}};

const fields = gf(JSON.stringify({uid,security_oauth_token:token,organization_id:'',organization_tags:[],data_policy_agreed:true}));
const userInfo = JSON.stringify({uid,security_oauth_token:token,organization_id:'',organization_tags:[],data_policy_agreed:true,...fields});
const ctx = nc4('63eb741c-5afe-4154-8d7b-1bf4039c5d95','1.1.59',userInfo,JSON.stringify({client_type:'6',business_product:'qoder_work',business_type:'agent',scene:'assistant'}));

// 客户端日志：GET https://gateway.qwenwork.cn/api/v2/model/list
for (const [endpoint, path, method] of [
  ['https://gateway.qwenwork.cn', '/api/v2/model/list', 'GET'],
  ['https://gateway.qwenwork.cn', '/algo/api/v2/model/list', 'GET'],
]) {
  try {
    const rp = prepReq(ctx, endpoint, path, method, 'auth', undefined, undefined);
    const url = rs(rp, 'requestresult_url');
    const hdrs={}; getHeap(ex.requestresult_headers(rp)).forEach((v,k)=>{hdrs[String(k)]=String(v);});
    const r = await fetch(url, {method, headers:hdrs, signal:AbortSignal.timeout(20000)});
    const t = await r.text();
    console.log(`[${method} ${path}] ${r.status} → ${t.slice(0,200).replace(/\n/g,' ')}`);
  } catch(e) { console.log(`[${method} ${path}] ERR ${e.message.slice(0,100)}`); }
}
