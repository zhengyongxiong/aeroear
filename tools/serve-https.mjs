// 局域网 HTTPS 静态服务器（给手机安装 PWA / 使用蓝牙用）
// 用法：node tools/serve-https.mjs [端口]
// 证书由 mkcert 生成，放在 ~/.aeroear-certs；根证书通过 /rootCA.crt 提供给手机安装
import https from 'node:https';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { execSync } from 'node:child_process';

const PORT = Number(process.argv[2]) || 8443;
const ROOT = resolve(new URL('../app', import.meta.url).pathname);
const CERTS = join(homedir(), '.aeroear-certs');
const caroot = execSync('mkcert -CAROOT').toString().trim();
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon',
};

https.createServer({ key: readFileSync(join(CERTS, 'key.pem')), cert: readFileSync(join(CERTS, 'cert.pem')) }, (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/rootCA.crt') {
    res.writeHead(200, { 'Content-Type': 'application/x-x509-ca-cert', 'Content-Disposition': 'attachment; filename="AeroEar-rootCA.crt"' });
    return res.end(readFileSync(join(caroot, 'rootCA.pem')));
  }
  let file = normalize(join(ROOT, url === '/' ? 'index.html' : url));
  if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end('Not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(readFileSync(file));
}).listen(PORT, '0.0.0.0', () => console.log(`HTTPS on :${PORT}  root=${ROOT}`));
