import assert from 'node:assert/strict';
import test from 'node:test';
import { renderLibraryMarkdown } from './library-markdown.js';

test('阅读隐藏标准导入元数据并保留普通正文分隔线', () => {
  const source = '\uFEFF---\r\nsourceId: synthetic-import\r\ntitle: 合成资料\r\ntags: [test]\r\n---\r\n# 正文\r\n\r\n内容\r\n---\r\n尾段';
  const rendered = renderLibraryMarkdown(source);
  assert.doesNotMatch(rendered, /synthetic-import|sourceId:|tags:/);
  assert.match(rendered, /正文/);
  assert.match(rendered, /---/);
  for (const [ordinary, retained] of [['---\n普通正文\n---\n后文', '普通正文'], ['---\ntitle: 正文内容\n---', '正文内容'], ['---\nsourceId: 保留\ntitle: 未闭合', '未闭合']]) {
    assert.ok(renderLibraryMarkdown(ordinary).includes(retained));
  }
});

test('知识库 Markdown 输出公式和 Mermaid 占位符', () => {
  const rendered = renderLibraryMarkdown([
    '# 渲染测试',
    '',
    '内联公式：\\(f=ma\\)。',
    '',
    '\\[',
    'AI \\rightarrow 生产率提高',
    '\\]',
    '',
    '```mermaid',
    'flowchart TD',
    '    A[开始] --> B{判断}',
    '    B -->|是| C[结束]',
    '```',
  ].join('\n'));

  assert.match(rendered, /class="library-math library-math-inline" data-library-math="inline"/);
  assert.match(rendered, /class="library-math library-math-display" data-library-math="display"/);
  assert.match(rendered, /class="library-mermaid" data-library-mermaid="true"/);
  assert.match(rendered, /AI \\rightarrow 生产率提高/);
  assert.doesNotMatch(rendered, /<pre><code[^>]*>flowchart TD/);
  assert.doesNotMatch(rendered, /<p>\\\[/);
});

test('知识库可识别未标注语言的 flowchart 源码', () => {
  const rendered = renderLibraryMarkdown([
    '```',
    'flowchart LR',
    '    A[输入] --> B[输出]',
    '```',
  ].join('\n'));

  assert.match(rendered, /class="library-mermaid" data-library-mermaid="true"/);
});

test('知识库仍会转义富内容源码和危险 HTML', () => {
  const rendered = renderLibraryMarkdown([
    '\\[',
    '<script>alert(1)</script>',
    '\\]',
    '',
    '```mermaid',
    'flowchart TD',
    '    A["<script>"] --> B[安全]',
    '```',
  ].join('\n'));

  assert.match(rendered, /&lt;script&gt;/);
  assert.doesNotMatch(rendered, /<script>/);
});
