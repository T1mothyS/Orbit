import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import nodemailer from 'nodemailer';
import {simpleParser} from 'mailparser';

const require = createRequire(import.meta.url);

test('mail compilation and parsing preserve UTF-8 recipients and attachments without SMTP', async () => {
  const transport = nodemailer.createTransport({streamTransport:true,buffer:true,disableFileAccess:true,disableUrlAccess:true});
  const result = await transport.sendMail({from:'测试 <sender@example.invalid>',to:['收件人 <receiver@example.invalid>','other@example.invalid'],subject:'合成安全回归',text:'仅在内存编译',html:'<p>仅在内存编译</p>',attachments:[{filename:'合成.txt',content:'附件内容'}]});
  const parsed = await simpleParser(result.message as Buffer);
  assert.equal(parsed.subject,'合成安全回归');
  assert.equal(parsed.from?.value[0].address,'sender@example.invalid');
  assert.equal((Array.isArray(parsed.to) ? parsed.to[0] : parsed.to)?.value[0].address,'receiver@example.invalid');
  assert.equal((Array.isArray(parsed.to) ? parsed.to[0] : parsed.to)?.value.length,2);
  assert.match(parsed.text || '',/仅在内存编译/);
  assert.equal(parsed.attachments[0].filename,'合成.txt');
  assert.equal(parsed.attachments[0].content.toString(),'附件内容');
  await assert.rejects(transport.sendMail({from:'a@example.invalid',to:'b@example.invalid',attachments:[{path:'https://example.invalid/private'}]}),/access rejected/i);
  await assert.rejects(transport.sendMail({from:'a@example.invalid',to:'b@example.invalid',attachments:[{path:'synthetic-private-file'}]}),/access rejected/i);
  transport.close();
});

test('existing query and configuration dependency security contracts remain covered', async () => {
  const qs = require('qs');
  assert.deepEqual(qs.parse('filters[status]=pending&page=2'),{filters:{status:'pending'},page:'2'});
  const malicious = qs.parse('__proto__[polluted]=true&constructor[prototype][polluted]=true');
  assert.equal(({} as any).polluted,undefined);
  assert.equal(Object.hasOwn(malicious,'__proto__'),false);
  const yaml = require('js-yaml');
  assert.deepEqual(yaml.load('build:\n  target: portable\n  enabled: true'),{build:{target:'portable',enabled:true}});
  assert.throws(()=>yaml.load('x: !!js/function function() {}'),/unknown tag/);
  const joi = require('joi');
  assert.equal(joi.object({port:joi.number().integer().min(1).max(65535)}).validate({port:5173}).error,undefined);
  assert.ok(joi.number().validate('invalid').error);
  const lodash = await import('lodash-es');
  assert.equal(lodash.template('Hello <%= name %>')({name:'calendar'}),'Hello calendar');
  assert.throws(()=>lodash.template('test',{imports:{'bad=value':1}}),/Invalid.*imports/);
});

test('IPv6 trust ranges cannot implicitly trust mapped IPv4 clients', () => {
  const proxy = require('proxy-addr');
  const ipv6 = proxy.compile('::/1');
  assert.equal(ipv6('::1'),true);
  assert.equal(ipv6('203.0.113.1'),false);
  assert.equal(ipv6('::ffff:203.0.113.1'),false);
  const mapped = proxy.compile('::ffff:127.0.0.0/104');
  assert.equal(mapped('127.0.0.1'),true);
  assert.equal(mapped('::ffff:127.0.0.1'),true);
  assert.equal(mapped('203.0.113.1'),false);
});

test('URI serialization rejects authority injection through the port', () => {
  const uri = require('fast-uri');
  assert.equal(uri.serialize({scheme:'https',host:'trusted.invalid',port:8443,path:'/read'}),'https://trusted.invalid:8443/read');
  for(const port of ['443@evil.invalid','443/path','443?query','443#fragment']) assert.throws(()=>uri.serialize({scheme:'https',host:'trusted.invalid',port,path:'/'}),/port is malformed/);
});

test('pathological address comments and nested brace input finish in a bounded isolated process', () => {
  const program = `const assert=require('node:assert/strict');const parser=require('nodemailer/lib/addressparser');const expand=require('glob/node_modules/brace-expansion');assert.deepEqual(expand('a{b,c}'),['ab','ac']);parser('recipient'+ '(comment)'.repeat(20000) +'@example.invalid');try{expand('{'.repeat(3500)+'a,b'+'}'.repeat(3500));}catch(e){if(e instanceof RangeError)throw e;}`;
  const child = spawnSync(process.execPath,['--max-old-space-size=96','-e',program],{cwd:process.cwd(),timeout:8000,encoding:'utf8',maxBuffer:100000});
  assert.equal(child.error,undefined,child.error?.message);
  assert.equal(child.status,0,child.stderr);
});
