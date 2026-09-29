// build.js — 单文件打包：把 7 个 js 内联进 index.html，产出 dist/shape-line.html（双击即玩 / 任意静态托管）
// 用法：node build.js
const fs = require('fs');
const path = require('path');
const root = __dirname;
const FILES = ['levels.js', 'blueprint.js', 'petal-v3.js', 'challenges.js', 'challenge-v3.js', 'core.js', 'sim.js', 'render.js', 'input.js'];

let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const f of FILES) {
  const tag = '<script src="js/' + f + '"></script>';
  const code = fs.readFileSync(path.join(root, 'js', f), 'utf8');
  if (!html.includes(tag)) { console.error('打包失败：index.html 未找到引用 ' + tag); process.exit(1); }
  if (/<\/script/i.test(code)) { console.error('打包失败：' + f + ' 含 </script> 会破坏内联'); process.exit(1); }
  html = html.replace(tag, () => '<script>\n' + code + '\n</script>'); // 函数替换防 $ 特殊符
}
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist', 'shape-line.html');
fs.writeFileSync(out, html);
fs.copyFileSync(path.join(root, 'README.md'), path.join(root, 'dist', 'README.md'));
console.log('打包完成: dist/shape-line.html  ' + (html.length / 1024).toFixed(1) + ' KB（单文件，含全部代码与资源）');
