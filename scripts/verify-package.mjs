import { extractFile } from '@electron/asar';
import { readFile, readdir, open, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=fileURLToPath(new URL('../',import.meta.url));
const packageJson=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const archive=path.join(root,'release/win-unpacked/resources/app.asar');
const files=['electron/main.cjs','electron/preload.cjs','electron/note-store.cjs','dist/index.html',...(await readdir(path.join(root,'dist/assets'))).map(name=>`dist/assets/${name}`)];
for(const file of files)assert.ok(extractFile(archive,path.normalize(file)).equals(await readFile(path.join(root,file))),`Packaged content differs: ${file}`);
const executable=path.join(root,'release',`Nest-Planner-${packageJson.version}-Windows.exe`);
const handle=await open(executable,'r');const header=Buffer.alloc(2);
try{await handle.read(header,0,2,0);}finally{await handle.close();}
assert.equal(header.toString(),'MZ');
const info=await stat(executable);
console.log(`PASS: ${files.length} packaged source/assets exactly match the verified build.`);
console.log(`Windows executable: ${(info.size/1024/1024).toFixed(1)} MiB; ${info.mtime.toISOString()}`);
