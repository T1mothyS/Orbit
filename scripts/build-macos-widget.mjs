// Opt-in signed macOS packaging. The normal Electron build does not require WidgetKit capabilities.
import { build, Platform, Arch } from 'electron-builder';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const group = process.env.ORBIT_WIDGET_APP_GROUP || '';
const identity = process.env.ORBIT_WIDGET_MAC_IDENTITY || '';
if (process.platform !== 'darwin' || !/^[A-Z0-9]{10}\.[A-Za-z0-9.-]+$/.test(group) || !identity.startsWith('Developer ID Application:') || !identity.endsWith(`(${group.split('.')[0]})`)) {
  throw new Error('需要配置与 App Group 同 Team 的 Developer ID Application 签名身份');
}
const arch = process.arch === 'arm64' ? Arch.arm64 : Arch.x64;
const swiftArch = arch === Arch.arm64 ? 'arm64' : 'x86_64';
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const temporary = mkdtempSync(path.join(tmpdir(), 'orbit-mac-widget-'));
const entitlement = (keys) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>com.apple.security.application-groups</key><array><string>${group}</string></array>
${keys.map(key => `<key>${key}</key><true/>`).join('\n')}
</dict></plist>\n`;
const hostEntitlements = path.join(temporary, 'host.plist');
const widgetEntitlements = path.join(temporary, 'widget.plist');
writeFileSync(hostEntitlements, entitlement(['com.apple.security.cs.allow-jit', 'com.apple.security.cs.allow-unsigned-executable-memory']));
writeFileSync(widgetEntitlements, entitlement(['com.apple.security.app-sandbox']));
const run = (file, args) => execFileSync(file, args, { stdio: 'inherit' });
const plutil = (key, value, plist) => run('plutil', ['-replace', key, '-string', value, plist]);

try {
  run('npm', ['run', 'build']);
  await build({
    projectDir: path.resolve('dist-desktop'),
    targets: Platform.MAC.createTarget(['dmg'], arch),
    config: {
      extends: path.resolve('electron-builder.yml'),
      forceCodeSigning: true,
      protocols: [{ name: 'Orbit 今日待办', schemes: ['orbit-today'] }],
      mac: {
        identity: identity.replace(/^Developer ID Application:\s*/, ''),
        entitlements: hostEntitlements,
        signIgnore: ['Contents/Helpers/OrbitWidgetSync$'],
        bundleShortVersion: version.split('-')[0],
        bundleVersion: version.split('-')[0],
        ...(process.env.ORBIT_WIDGET_HOST_PROFILE ? { provisioningProfile: process.env.ORBIT_WIDGET_HOST_PROFILE } : {}),
      },
      afterPack: async ({ appOutDir, packager }) => {
        const contents = path.join(appOutDir, packager.appInfo.productFilename + '.app', 'Contents');
        const bundle = path.join(contents, 'PlugIns', 'OrbitToday.appex');
        const widget = path.join(bundle, 'Contents');
        const plist = path.join(widget, 'Info.plist');
        const executable = path.join(widget, 'MacOS', 'OrbitToday');
        mkdirSync(path.dirname(executable), { recursive: true });
        copyFileSync('macos-widget/Info.plist', plist);
        plutil('OrbitAppGroup', group, plist);
        plutil('CFBundleShortVersionString', version.split('-')[0], plist);
        plutil('CFBundleVersion', version.split('-')[0], plist);
        if (process.env.ORBIT_WIDGET_EXTENSION_PROFILE) copyFileSync(process.env.ORBIT_WIDGET_EXTENSION_PROFILE, path.join(widget, 'embedded.provisionprofile'));
        run('xcrun', ['swiftc', '-O', '-parse-as-library', '-target', `${swiftArch}-apple-macosx14.0`, 'macos-widget/TodayWidget.swift', '-o', executable]);
        run('codesign', ['--force', '--timestamp', '--options', 'runtime', '--sign', identity, '--entitlements', widgetEntitlements, bundle]);
        run('codesign', ['--verify', '--strict', bundle]);
        const sync = path.join(contents, 'Helpers', 'OrbitWidgetSync');
        mkdirSync(path.dirname(sync), { recursive: true });
        run('xcrun', ['swiftc', '-O', '-parse-as-library', '-target', `${swiftArch}-apple-macosx14.0`, 'macos-widget/WidgetSync.swift', '-o', sync]);
        run('codesign', ['--force', '--timestamp', '--options', 'runtime', '--sign', identity, '--entitlements', widgetEntitlements, sync]);
        run('codesign', ['--verify', '--strict', sync]);
        writeFileSync(path.join(contents, 'Resources', 'orbit-widget-group.txt'), group + '\n');
      },
    },
  });
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
