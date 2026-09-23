import fs from 'node:fs';

const WASM = '/mnt/c/Users/64264/AppData/Local/Programs/QwenWorkCN/1.2.1-26092107/resources/qoder-auth-wasm/qoder_auth_wasm_bg.wasm';
const buf = fs.readFileSync(WASM);

let heap = new Array(1028).fill(undefined);
let freeHead = 1028;
export const addHeap = (o) => { if (freeHead === heap.length) heap.push(heap.length + 1); const i = freeHead; freeHead = heap[i]; heap[i] = o; return i; };
export const getHeap = (i) => heap[i];
const dropHeap = (i) => { if (i < 1028) return; heap[i] = freeHead; freeHead = i; };

let Pn = null, memU8 = null, memDV = null;
export const U8 = () => { if (!memU8 || memU8.byteLength === 0 || memU8.buffer !== Pn.memory.buffer) memU8 = new Uint8Array(Pn.memory.buffer); return memU8; };
export const DV = () => { if (!memDV || memDV.buffer !== Pn.memory.buffer) memDV = new DataView(Pn.memory.buffer); return memDV; };
export const I1e = (ptr, len) => U8().subarray(ptr >>> 0, (ptr >>> 0) + len);
const enc = new TextEncoder(), dec = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
export const readStr = (p, l) => dec.decode(U8().subarray(p, p + l));
const jqe = (fn, args) => { try { return fn.apply(null, args); } catch (e) { Pn.__wbindgen_export(addHeap(e)); } };

const cryptoObj = {
  getRandomValues: (arr) => globalThis.crypto.getRandomValues(arr),
  randomFillSync: (arr) => { globalThis.crypto.getRandomValues(arr); return arr; },
};
cryptoObj.msCrypto = cryptoObj;

const imports = {
  './qoder_auth_wasm_bg.js': {
    __wbindgen_object_drop_ref: (i) => dropHeap(i),
    __wbindgen_object_clone_ref: (i) => addHeap(getHeap(i)),
    __wbg_set_08463b1df38a7e29: (a, b, c) => addHeap(getHeap(a).set(getHeap(b), getHeap(c))),
    __wbg_getRandomValues_d49329ff89a07af1: function () { return jqe((A, e) => globalThis.crypto.getRandomValues(I1e(A, e)), arguments); },
    __wbg_crypto_38df2bab126b63dc: (i) => addHeap(getHeap(i).crypto ?? cryptoObj),
    __wbg_process_44c7a14e11e9f69e: (i) => addHeap(process),
    __wbg_versions_276b2795b1c6a219: (i) => addHeap(process.versions),
    __wbg_node_84ea875411254db1: (i) => addHeap(process.versions.node),
    __wbg_require_b4edbdcf3e2a1ef0: () => { throw new Error('require unsupported'); },
    __wbg_msCrypto_bd5a034af96bcba6: (i) => addHeap(cryptoObj),
    __wbg_getRandomValues_c44a50d8cfdaebeb: function () { return jqe((A, e) => getHeap(A).getRandomValues(getHeap(e)), arguments); },
    __wbg_randomFillSync_6c25eac9869eb53c: function () { return jqe((A, e) => getHeap(A).randomFillSync(getHeap(e)), arguments); },
    __wbg_call_d578befcc3145dee: function () { return jqe(function (A, e, t) { return addHeap(getHeap(A).call(getHeap(e), getHeap(t))); }, arguments); },
    __wbg_new_with_length_9cedd08484b73942: (n) => addHeap(new Uint8Array(n >>> 0)),
    __wbg_length_0c32cb8543c8e4c8: (i) => getHeap(i).length,
    __wbg_prototypesetcall_3e05eb9545565046: (a, b, c) => { Uint8Array.prototype.set.call(I1e(a, b), getHeap(c)); },
    __wbg_subarray_0f98d3fb634508ad: (a, b, c) => addHeap(getHeap(a).subarray(b >>> 0, c >>> 0)),
    __wbg_new_99cabae501c0a8a0: () => addHeap(new Map()),
    __wbg_now_88621c9c9a4f3ffc: () => Date.now(),
    __wbg_static_accessor_GLOBAL_THIS_a1248013d790bf5f: () => addHeap(globalThis),
    __wbg_static_accessor_SELF_24f78b6d23f286ea: () => addHeap(globalThis),
    __wbg_static_accessor_GLOBAL_f2e0f995a21329ff: () => addHeap(globalThis),
    __wbg_static_accessor_WINDOW_59fd959c540fe405: () => addHeap(undefined),
    __wbg___wbindgen_throw_81fc77679af83bc6: (p, l) => { throw new Error(readStr(p, l)); },
    __wbg_Error_2e59b1b37a9a34c3: (p, l) => addHeap(new Error(readStr(p, l))),
    __wbg___wbindgen_is_object_40c5a80572e8f9d3: (i) => (typeof getHeap(i) === 'object' && getHeap(i) !== null),
    __wbg___wbindgen_is_string_b29b5c5a8065ba1a: (i) => (typeof getHeap(i) === 'string'),
    __wbg___wbindgen_is_function_49868bde5eb1e745: (i) => (typeof getHeap(i) === 'function'),
    __wbg___wbindgen_is_undefined_c0cca72b82b86f4d: (i) => (getHeap(i) === undefined),
    __wbindgen_cast_0000000000000001: (a, b) => addHeap(I1e(a, b)),
    __wbindgen_cast_0000000000000002: (a, b) => addHeap(readStr(a, b)),
  },
};

const inst = new WebAssembly.Instance(new WebAssembly.Module(buf), imports);
Pn = inst.exports;
export const ex = Pn;
export const malloc = ex.__wbindgen_export2, realloc = ex.__wbindgen_export3, drop = ex.__wbindgen_export4;
export const stackAdj = ex.__wbindgen_add_to_stack_pointer;

// 返回 {ptr, len}，避免全局 lastLen 被覆盖
export function passStr(s, malloc, realloc) {
  const str = s ?? '';
  if (realloc === undefined) {
    const t = enc.encode(str);
    const p = malloc(t.length, 1) >>> 0;
    U8().subarray(p, p + t.length).set(t);
    return { ptr: p, len: t.length };
  }
  let i = str.length, p = malloc(i, 1) >>> 0, u = U8(), o = 0, src = str;
  for (; o < i; o++) { const c = src.charCodeAt(o); if (c > 127) break; u[p + o] = c; }
  if (o !== i) {
    if (o !== 0) src = src.slice(o);
    p = realloc(p, i, i = o + 3 * src.length, 1) >>> 0;
    o += enc.encodeInto(src, U8().subarray(p + o, p + i)).written;
    p = realloc(p, i, o, 1) >>> 0;
  }
  return { ptr: p, len: o };
}
