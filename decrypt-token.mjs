#!/usr/bin/env node
// 解密 Windows 客户端的 auth-v2.dat → 明文 token.json
// 用法: node decrypt-token.mjs <auth-v2.dat> <aes-key-hex> <out.json>
// AES 密钥来自 Local State 的 os_crypt.encrypted_key（DPAPI 解出，稳定不变）
import fs from 'node:fs';
import crypto from 'node:crypto';

const [datPath, keyHex, outPath] = process.argv.slice(2);
if (!datPath || !keyHex || !outPath) {
  console.error('用法: node decrypt-token.mjs <auth-v2.dat> <aes-key-hex(64位十六进制)> <out.json>');
  process.exit(1);
}
if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
  console.error('AES 密钥必须是 64 位十六进制字符');
  process.exit(1);
}
const key = Buffer.from(keyHex, 'hex');
const data = fs.readFileSync(datPath);
const prefix = data.subarray(0, 3).toString('ascii');
if (prefix !== 'v10') {
  console.error(`意外的文件前缀: ${prefix}（期望 v10，Electron safeStorage 格式）`);
  process.exit(1);
}
// v10 + nonce(12) + ciphertext + tag(16)
const nonce = data.subarray(3, 15);
const tag = data.subarray(data.length - 16);
const cipher = data.subarray(15, data.length - 16);
const d = crypto.createDecipheriv('aes-256-gcm', key, nonce);
d.setAuthTag(tag);
const plain = Buffer.concat([d.update(cipher), d.final()]).toString('utf8');
const j = JSON.parse(plain); // 校验
if (!j.token || !j.user || !j.user.id) {
  console.error('解密成功但内容缺少 token/user.id');
  process.exit(1);
}
fs.writeFileSync(outPath, JSON.stringify(j, null, 2));
console.log(`✓ 已解密 → ${outPath}`);
console.log(`  用户: ${j.user.name || j.user.username || j.user.id}`);
console.log(`  token 过期: ${j.expiresAt || '未知'}（约 7 天有效期，过期后重跑 docker-run.sh）`);
