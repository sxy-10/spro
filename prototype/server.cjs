// Static file server for the prototype frontend (port 8080).
// .cjs extension is required: ../package.json declares "type": "module".
// 同时托管项目根目录的 shared-auth/（URL 前缀 /shared-auth/），供页面加载共享鉴权包。
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html;charset=utf8',
  '.css': 'text/css;charset=utf8',
  '.js': 'application/javascript;charset=utf8',
  '.mjs': 'application/javascript;charset=utf8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

const ROOT = path.resolve(__dirname, '..');
const SHARED_PREFIX = '/shared-auth/';

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/login.html';
  const base = p.startsWith(SHARED_PREFIX) ? ROOT : __dirname;
  const file = path.join(base, p);
  if (!file.startsWith(base) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(8080, '127.0.0.1', () => {
  console.log('prototype served at http://127.0.0.1:8080/login.html');
});
