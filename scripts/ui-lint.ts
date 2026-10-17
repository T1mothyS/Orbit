import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import postcss from 'postcss';

export interface UiFinding { file: string; line: number; rule: string; fingerprint: string }
const normalized = (value: string) => value.replaceAll('\\', '/');
export function inspectUiSource(filename: string, source: string): UiFinding[] {
  const file = normalized(filename), findings: UiFinding[] = [];
  const primitive = file.startsWith('src/ui/');
  const palette = file === 'src/design/tokens.css';
  const add = (rule: string, line: number, code: string) => findings.push({ file, line, rule,
    fingerprint: createHash('sha256').update(code.replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16) });
  if (/\.[jt]sx?$/.test(file)) {
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const report = (rule: string, node: ts.Node) => add(rule, ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1, node.getText(ast));
    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const module = node.moduleSpecifier.text;
        if (!primitive && /^(?:tdesign-react|tdesign-icons-react|@base-ui\/react|@radix-ui\/)/.test(module)) report('ui-import', node);
        if (primitive && /(?:\/features\/|\/services\/|\/hooks\/useAuth|\/components\/)/.test(module)) report('ui-business-dependency', node);
      }
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && !primitive
        && ['button', 'input', 'select', 'textarea'].includes(node.tagName.getText(ast))) report('native-control', ts.isJsxOpeningElement(node) ? node.parent : node);
      if (ts.isJsxAttribute(node) && node.name.getText(ast) === 'style') {
        // Geometry is allowed; visual language belongs to the component and tokens.
        if (/(?:color|background\w*|border\w*|boxShadow|font\w*|lineHeight|zIndex)\s*:/.test(node.getText(ast))) report('inline-visual', node);
      }
      if (ts.isStringLiteralLike(node) || ts.isJsxExpression(node)) {
        if (/(?:bg|text|border|rounded|shadow|z)-\[[^\]]*(?:#[\da-f]{3,8}|\d+(?:px|rem)|\d+)\]/i.test(node.getText(ast))) report('arbitrary-visual', node);
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  } else if (file.endsWith('.css')) {
    const ast = postcss.parse(source, { from: file });
    ast.walkDecls(decl => {
      const code = `${decl.parent && 'selector' in decl.parent ? decl.parent.selector : ''}|${decl.prop}:${decl.value}`;
      const line = decl.source?.start?.line || 1;
      if (!palette && /#[\da-f]{3,8}\b/i.test(decl.value)) add('literal-color', line, code);
      if (/^(?:border(?:-\w+)?-radius|border-radius)$/.test(decl.prop) && !/^(?:0|inherit|var\()/u.test(decl.value)) add('literal-radius', line, code);
      if (decl.prop === 'z-index' && !/^(?:0|auto|var\()/u.test(decl.value)) add('literal-layer', line, code);
      if (!primitive && !file.startsWith('src/design/') && /\.oui-(?:button|input|checkbox|switch|popup)\b/.test(String(decl.parent && 'selector' in decl.parent ? decl.parent.selector : ''))
        && /^(?:background\w*|color|border(?:-radius|-color)?|font-size)$/.test(decl.prop)) add('component-restyle', line, code);
    });
  }
  return findings;
}
export function findingKey(finding: UiFinding) { return `${finding.file}|${finding.rule}|${finding.fingerprint}`; }
export function newUiFindings(findings: UiFinding[], baseline: Record<string, number>) {
  const seen = new Map<string, number>();
  return findings.filter(finding => {
    const key = findingKey(finding), count = (seen.get(key) || 0) + 1;
    seen.set(key, count);
    const strict = /^src\/(?:ui|design|dev|features)\//.test(finding.file);
    return count > (strict ? 0 : baseline[key] || 0);
  });
}
function walk(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
}
function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const baselinePath = path.join(root, 'scripts/ui-lint-baseline.json');
  const findings = walk(path.join(root, 'src')).filter(file => /\.(?:tsx?|css)$/.test(file)).flatMap(file => inspectUiSource(normalized(path.relative(root, file)), fs.readFileSync(file, 'utf8')));
  if (process.argv.includes('--write-baseline')) {
    if (process.env.CI) throw new Error('CI cannot update UI exceptions.');
    if (findings.some(finding => /^src\/(?:ui|design|dev|features)\//.test(finding.file))) throw new Error('New regions cannot enter the legacy baseline.');
    const counts: Record<string, number> = {};
    for (const finding of findings) counts[findingKey(finding)] = (counts[findingKey(finding)] || 0) + 1;
    fs.writeFileSync(baselinePath, JSON.stringify({ description: 'Existing debt only. Remove entries as regions migrate; adding exceptions requires review.', findings: counts }, null, 2) + '\n');
    console.log(`Recorded ${findings.length} existing UI findings. No new-region exceptions.`);
    return;
  }
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8')).findings;
  const failures = newUiFindings(findings, baseline);
  for (const finding of failures) console.error(`${finding.file}:${finding.line} ${finding.rule}`);
  if (failures.length) { console.error(`${failures.length} new UI violation(s).`); process.exitCode = 1; }
  else console.log(`UI boundaries pass. ${findings.length} legacy findings remain; no new violations.`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
