'use strict';
// Ashfall Bunker: a plain static file server for ./public (no packages needed).
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.webp': 'image/webp' };

// Compressible types (already-compressed media is skipped).
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.ico', '.txt', '.map']);
const MIN_COMPRESS = 1024;

// CSP: the page uses inline <style> and style="" attributes plus Google Fonts; all scripts are same-origin files.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "media-src 'self' blob: data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'"
].join('; ');

const SECURITY = {
  'content-security-policy': CSP,
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'SAMEORIGIN',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'cross-origin-opener-policy': 'same-origin'
};

function send(res, status, headers, body) {
  res.writeHead(status, Object.assign({}, SECURITY, headers));
  res.end(body);
}

// In-memory cache of compressed bodies, keyed by file + etag + encoding.
const zcache = new Map();
function compressed(file, etag, enc) {
  const key = file + '|' + etag + '|' + enc;
  let p = zcache.get(key);
  if (!p) {
    p = new Promise((resolve, reject) => {
      fs.readFile(file, (err, buf) => {
        if (err) return reject(err);
        if (enc === 'br') zlib.brotliCompress(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }, (e, out) => e ? reject(e) : resolve(out));
        else zlib.gzip(buf, { level: 9 }, (e, out) => e ? reject(e) : resolve(out));
      });
    });
    p.catch(() => zcache.delete(key));
    zcache.set(key, p);
    if (zcache.size > 200) zcache.delete(zcache.keys().next().value);
  }
  return p;
}

function pickEncoding(header) {
  const h = (header || '').toLowerCase();
  const has = (n) => new RegExp('(^|[,\\s])' + n + '(\\s*;\\s*q=(?!0(\\.0*)?(,|$)))?\\s*(,|$)').test(h);
  if (has('br')) return 'br';
  if (has('gzip')) return 'gzip';
  return null;
}

http.createServer((req, res) => {
  const method = req.method;
  if (method === 'OPTIONS') return send(res, 204, { allow: 'GET, HEAD, OPTIONS', 'content-length': 0 });
  if (method !== 'GET' && method !== 'HEAD') return send(res, 405, { allow: 'GET, HEAD, OPTIONS', 'content-type': 'text/plain; charset=utf-8' }, 'Method not allowed');
  const head = method === 'HEAD';

  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { return send(res, 400, { 'content-type': 'text/plain; charset=utf-8' }, 'Bad request'); }
  if (rel.indexOf('\0') !== -1) return send(res, 400, { 'content-type': 'text/plain; charset=utf-8' }, 'Bad request');
  if (rel === '/' || rel === '') rel = '/index.html';
  if (rel === '/healthz') return send(res, 200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }, head ? undefined : 'ok');
  const file = path.normalize(path.join(PUBLIC, rel));
  if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) return send(res, 403, { 'content-type': 'text/plain; charset=utf-8' }, 'Forbidden');

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, { 'content-type': 'text/plain; charset=utf-8' }, head ? undefined : 'Not found');
    const ext = path.extname(file).toLowerCase();
    const isAudio = ext === '.mp3' || ext === '.ogg' || ext === '.wav';
    const etag = '"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + '"';
    const cache = isAudio ? 'public, max-age=31536000'
      : (ext === '.png' || ext === '.jpg' || ext === '.webp' || ext === '.svg' || ext === '.ico') ? 'public, max-age=86400'
      : 'no-cache'; // html/js/json: always revalidate (cheap 304 via ETag)
    const base = {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': cache,
      'etag': etag,
      'last-modified': st.mtime.toUTCString(),
      'accept-ranges': 'bytes'
    };
    const compressible = COMPRESSIBLE.has(ext) && st.size >= MIN_COMPRESS;
    if (compressible) base.vary = 'Accept-Encoding';

    // Conditional request
    const inm = req.headers['if-none-match'];
    if (inm && inm.split(',').some((t) => t.trim().replace(/^W\//, '') === etag || t.trim() === '*')) {
      return send(res, 304, { etag, 'cache-control': cache, vary: base.vary || undefined });
    }

    const fail = () => { if (!res.headersSent) res.writeHead(500); res.end(); };
    const ifRange = req.headers['if-range'];
    const rangeOk = !ifRange || ifRange === etag;
    const m = rangeOk ? /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '') : null;

    if (m && (m[1] || m[2])) {
      let start, end;
      if (m[1] === '') { start = Math.max(0, st.size - +m[2]); end = st.size - 1; }
      else { start = +m[1]; end = m[2] === '' ? st.size - 1 : Math.min(+m[2], st.size - 1); }
      if (start >= st.size || start > end) return send(res, 416, { 'content-range': 'bytes */' + st.size });
      res.writeHead(206, Object.assign({}, SECURITY, base, { 'content-range': 'bytes ' + start + '-' + end + '/' + st.size, 'content-length': end - start + 1 }));
      if (head) return res.end();
      return fs.createReadStream(file, { start, end }).on('error', fail).pipe(res);
    }

    const enc = compressible ? pickEncoding(req.headers['accept-encoding']) : null;
    if (enc) {
      return compressed(file, etag, enc).then((buf) => {
        // Distinct ETag per encoding so caches never mix them up.
        res.writeHead(200, Object.assign({}, SECURITY, base, { etag: etag.slice(0, -1) + '-' + enc + '"', 'content-encoding': enc, 'content-length': buf.length }));
        res.end(head ? undefined : buf);
      }).catch(fail);
    }

    res.writeHead(200, Object.assign({}, SECURITY, base, { 'content-length': st.size }));
    if (head) return res.end();
    fs.createReadStream(file).on('error', fail).pipe(res);
  });
}).listen(PORT, () => console.log('Ashfall Bunker running at http://localhost:' + PORT));
