import assert from 'node:assert/strict';
import test from 'node:test';
import {searchSettings,settingId,type SearchableSetting} from '../src/utils/settings-search.js';
import {chatInline,safeChatHref} from '../src/utils/chat-markdown.js';
test('settings search ranks names, aliases, Chinese subsequences and bounded English typos',()=>{
  const items:SearchableSetting[]=[{id:'a',section:'ai',label:'联网搜索',description:'网络资料',keywords:['tavily','search']},{id:'b',section:'notifications',label:'常驻城市或区县',description:'每日天气',keywords:['天气']},{id:'c',section:'ai',label:'日程 AI 模型',description:'联网搜索也使用此模型',keywords:['model','glm']}];
  assert.equal(searchSettings(items,'联网搜索')[0].id,'a');assert.equal(searchSettings(items,'常驻区县')[0].id,'b');assert.equal(searchSettings(items,'tavli').length,0);assert.equal(searchSettings(items,'tavilyy')[0].id,'a');assert.equal(searchSettings(items,'天气')[0].id,'b');assert.equal(searchSettings(items,'synthetic-secret').length,0);assert.equal(settingId('ai','个人 API Key'),settingId('ai','个人 API Key'));
});
test('chat Markdown supports hierarchy without HTML, scripts, images or unsafe links',()=>{
  assert.deepEqual(chatInline('时间 **10:00**'),[{type:'text',text:'时间 '},{type:'bold',text:'10:00'}]);assert.equal(safeChatHref('javascript:alert(1)'),undefined);assert.equal(safeChatHref('//evil.test'),undefined);assert.equal(safeChatHref('https://user:password@example.org'),undefined);assert.equal(safeChatHref('/reports/2026-10-03'),'/reports/2026-10-03');assert.equal(chatInline('![image](https://example.org/image.png)')[0].type,'text');assert.equal(chatInline('<script>test()</script>')[0].type,'text');
});
