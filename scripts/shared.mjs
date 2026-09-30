import { readdir, readFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const own = process.cwd();
const other = process.argv[3] || path.resolve(own, '..', path.basename(own) === 'macOs' ? 'webOs' : 'macOs');
const folders = ['src/core', 'src/runtime', 'src/ui'];
async function files(root, dir) {
  const result = [];
  for (const e of await readdir(path.join(root, dir), { withFileTypes: true })) {
    const name = path.join(dir, e.name);
    result.push(...(e.isDirectory() ? await files(root, name) : [name]));
  }
  return result;
}
let count = 0;
for (const dir of folders) for (const name of await files(own, dir)) {
  if (process.argv[2] === 'sync') { await mkdir(path.dirname(path.join(other, name)), { recursive: true }); await copyFile(path.join(own, name), path.join(other, name)); }
  const hash = async root => createHash('sha256').update(await readFile(path.join(root, name))).digest('hex');
  if (await hash(own) !== await hash(other)) throw new Error(`Ortak dosya farklı: ${name}`);
  count++;
}
console.log(`${count} ortak dosya aynı. Depoların derlenmesi birbirine bağlı değildir.`);
