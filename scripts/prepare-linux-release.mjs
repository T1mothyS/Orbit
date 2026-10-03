import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';

if(process.platform!=='linux'||process.arch!=='x64')throw new Error('Release runtime must be prepared on Linux x64');
const [directory,commit]=process.argv.slice(2),root=path.resolve(directory||'');
if(!/^[a-f0-9]{40}$/.test(commit||''))throw new Error('A frozen commit is required');
for(const name of ['.env','data','.git','AGENTS.md','AGENTS.local.md','DEPLOY.md','CONTINUOUS-REQUIREMENTS.md'])if(fs.existsSync(path.join(root,name)))throw new Error('Local/runtime data must not enter release: '+name);
for(const name of ['package.json','package-lock.json','server/index.ts','server/file-parser-worker.mjs','server/archive-validation.mjs','dist/index.html','protected-tools/manifest.json','project-evolution/generated.json','node_modules/tsx/dist/cli.mjs'])fs.accessSync(path.join(root,name));
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'))),lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json')));
if(pkg.version!==lock.version||pkg.version!==lock.packages[''].version)throw new Error('Release versions do not agree');
const require=createRequire(path.join(root,'package.json'));
const sharp=require('sharp');await sharp({create:{width:1,height:1,channels:3,background:'red'}}).png().toBuffer();
require('mammoth');require('exceljs');
await import(require.resolve('pdfjs-dist/legacy/build/pdf.mjs'));
const files={};
function visit(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name),relative=path.relative(root,file).split(path.sep).join('/');if(relative==='node_modules')continue;if(entry.isDirectory())visit(file);else if(entry.isFile())files[relative]=createHash('sha256').update(fs.readFileSync(file)).digest('hex');else throw new Error('Unexpected source symlink: '+relative);}}
visit(root);
fs.writeFileSync(path.join(root,'.release-manifest.json'),JSON.stringify({commit,version:pkg.version,node:process.version,platform:process.platform,arch:process.arch,dependencies:'complete-linux-node_modules',files},null,2));
console.log(JSON.stringify({commit,version:pkg.version,sourceFiles:Object.keys(files).length,runtime:'Linux x64',node:process.version}));
