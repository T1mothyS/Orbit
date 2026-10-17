import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectUiSource, findingKey, newUiFindings } from '../scripts/ui-lint.js';

test('UI lint catches library bypasses, native controls and inline visual styling', () => {
  const findings = inspectUiSource('src/features/example/Page.tsx', "import {Button} from 'tdesign-react'; const page=<button style={{backgroundColor: 'red'}}>保存</button>;");
  assert.deepEqual(new Set(findings.map(item => item.rule)), new Set(['ui-import', 'native-control', 'inline-visual']));
  assert.equal(inspectUiSource('src/features/example/Page.tsx', "import {Button} from '../../ui'; const page=<Button>保存</Button>;").length, 0);
});
test('UI lint permits primitive implementation and geometry but rejects business dependencies', () => {
  assert.equal(inspectUiSource('src/ui/Input.tsx', 'const input=<input style={{width: dynamicWidth}}/>;').length, 0);
  assert.equal(inspectUiSource('src/ui/Input.tsx', "import {useAuth} from '../hooks/useAuth';")[0].rule, 'ui-business-dependency');
});
test('UI lint checks CSS values and forbids feature overrides of Orbit controls', () => {
  assert.deepEqual(inspectUiSource('src/features/example/page.css', '.page .oui-button{color:#fff;border-radius:9px;z-index:999}').map(item => item.rule),
    ['literal-color', 'component-restyle', 'literal-radius', 'component-restyle', 'literal-layer']);
  assert.equal(inspectUiSource('src/ui/ui.css', '.oui-button{color:var(--orbit-text);border-radius:var(--orbit-radius-control);z-index:var(--orbit-z-popover)}').length, 0);
});
test('legacy allowance cannot hide an additional copy or new occurrence', () => {
  const [existing] = inspectUiSource('src/components/Legacy.tsx', '<button>旧按钮</button>');
  const baseline = { [findingKey(existing)]: 1 };
  assert.equal(newUiFindings([existing], baseline).length, 0);
  assert.equal(newUiFindings([existing, existing], baseline).length, 1);
  assert.equal(newUiFindings(inspectUiSource('src/components/Legacy.tsx', '<button>新按钮</button>'), baseline).length, 1);
});
