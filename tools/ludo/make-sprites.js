// Generates a static sprite then idle + walk animations for each character in characters.json using the Ludo CLI.
// Usage (from this folder):  node make-sprites.js [--go] [--only mara,bram] [--max-credits 200]
// Without --go it only prints what each step would cost (Ludo --dry-run). First run:  npx @ludoai/cli login
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2);
const flag = n => args.includes('--' + n), val = n => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : null; };
const go = flag('go'), only = val('only') ? val('only').split(',') : null, maxCredits = val('max-credits') || '200';
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'characters.json'), 'utf8'));
const outRoot = path.join(__dirname, '..', '..', 'art', 'ludo');
fs.mkdirSync(outRoot, { recursive: true });
const isWin = process.platform === 'win32';
function ludo(a) {
  const r = spawnSync(isWin ? 'npx.cmd' : 'npx', ['-y', '@ludoai/cli', ...a], { encoding: 'utf8', shell: isWin });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  return r.status;
}
function firstPng(dir, prefix) {
  const f = fs.existsSync(dir) ? fs.readdirSync(dir).filter(x => x.startsWith(prefix) && /\.png$/i.test(x)) : [];
  return f.length ? path.join(dir, f[0]) : null;
}
for (const ch of cfg.characters) {
  if (only && !only.includes(ch.id)) continue;
  const dir = path.join(outRoot, ch.id); fs.mkdirSync(dir, { recursive: true });
  console.log('\n=== ' + ch.name + ' ===');
  let still = firstPng(dir, ch.id + '-still');
  if (!still) {
    const a = ['image', 'create', '--prompt', ch.prompt, '--image-type', 'sprite', '--name', ch.id + '-still', '--out', dir, '--max-credits', maxCredits];
    if (!go) a.push('--dry-run');
    if (ludo(a) !== 0 && go) { console.log('Still failed for ' + ch.id + ', skipping'); continue; }
    still = firstPng(dir, ch.id + '-still');
  }
  if (!go) { console.log('(dry run) would animate:', cfg.animations.map(x => x.name).join(', ')); continue; }
  if (!still) { console.log('No still image found for ' + ch.id); continue; }
  for (const an of cfg.animations) {
    if (firstPng(dir, ch.id + '-' + an.name)) continue;
    ludo(['sprite', 'animate', '--initial-image', still, '--motion-prompt', an.motion, '--name', ch.id + '-' + an.name, '--out', dir, '--max-credits', maxCredits]);
  }
}
console.log('\nDone. Output: ' + outRoot);
