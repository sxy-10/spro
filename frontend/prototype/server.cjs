// Static file server for the prototype frontend (port 8080).
// .cjs extension is required: ../package.json declares "type": "module".
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html;charset=utf8',
  '.css': 'text/css;charset=utf8',
  '.js': 'application/javascript;charset=utf8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/login.html';
  const file = path.join(__dirname, p);
  if (!file.startsWith(__dirname) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(8080, '127.0.0.1', () => {
  console.log('prototype served at http://127.0.0.1:8080/login.html');
});
