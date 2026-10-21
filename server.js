'use strict';
// Ashfall Bunker: a plain static file server for ./public (no packages needed).
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.webp': 'image/webp' };

http.createServer((req, res) => {
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); return res.end('Bad request'); }
  if (rel === '/' || rel === '') rel = '/index.html';
  if (rel === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
  const file = path.normalize(path.join(PUBLIC, rel));
  if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found'); }
    const base = { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache', 'accept-ranges': 'bytes' };
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    const fail = () => { if (!res.headersSent) res.writeHead(500); res.end(); };
    if (m && (m[1] || m[2])) {
      let start, end;
      if (m[1] === '') { start = Math.max(0, st.size - +m[2]); end = st.size - 1; }
      else { start = +m[1]; end = m[2] === '' ? st.size - 1 : Math.min(+m[2], st.size - 1); }
      if (start >= st.size || start > end) { res.writeHead(416, { 'content-range': 'bytes */' + st.size }); return res.end(); }
      res.writeHead(206, Object.assign({}, base, { 'content-range': 'bytes ' + start + '-' + end + '/' + st.size, 'content-length': end - start + 1 }));
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(file, { start, end }).on('error', fail).pipe(res);
    }
    res.writeHead(200, Object.assign({}, base, { 'content-length': st.size }));
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).on('error', fail).pipe(res);
  });
}).listen(PORT, () => console.log('Ashfall Bunker running at http://localhost:' + PORT));
