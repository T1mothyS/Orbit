import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
import sys
from unittest.mock import patch
sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location('ops', Path(__file__).with_name('orbit-operations.py'))
ops = importlib.util.module_from_spec(spec); spec.loader.exec_module(ops)

class OperationsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.releases = self.root / 'releases'; self.releases.mkdir()
        self.state = self.root / 'state'
        self.logs = self.root / 'logs'; self.logs.mkdir()
        self.config = {'stateDir': str(self.state), 'services': {'main': {'releaseRoot': str(self.releases), 'releasePrefix': 'release-', 'currentPath': str(self.releases / 'release-current')}}, 'logs': [{'root': str(self.logs), 'active':['application.log'], 'archives':['closed-*.log']}]}
        self.config_ref = self.root / 'config.ref'; self.config_ref.touch()
        self.data_ref = self.root / 'recovery.ref'; self.data_ref.touch()
        self.runtime = self.directory('release-runtime'); (self.runtime / 'node_modules').mkdir()
        (self.runtime / 'node_modules/module.js').write_text('synthetic')
        ops.atomic(self.runtime / '.release-manifest.json', {'platform': 'linux', 'arch': 'x64'})

    def tearDown(self): self.temp.cleanup()

    def directory(self, name):
        directory = self.releases / name; directory.mkdir()
        (directory / 'server').mkdir(); (directory / 'dist').mkdir(); (directory / 'dist/index.html').write_text('synthetic')
        ops.atomic(directory / 'package.json', {'version': '0.56.0-261008.2200', 'dependencies': {'synthetic':'1'}})
        ops.atomic(directory / 'package-lock.json', {'version':'ignored', 'packages': {'':{'version':'ignored'}, 'node_modules/synthetic':{'version':'1'}}})
        return directory

    def evidence(self, i, status='success'):
        directory = self.directory('release-' + str(i))
        return {'id':'attempt-' + str(i), 'service':'main', 'version':'0.56.0-261008.2200', 'commit':'a'*40, 'path':str(directory), 'status':status, 'finishedAt':f'2026-01-{i+1:02d}T00:00:00Z', 'checks':dict.fromkeys(ops.CHECKS,True), 'recovery':{'configRef':str(self.config_ref), 'dataRecoveryRef':str(self.data_ref), 'dependencyHash':ops.dependency_hash(directory), 'runtime':{'kind':'directory','path':str(self.runtime/'node_modules')}}}

    def populate(self, count=11):
        items = [self.evidence(i) for i in range(count)]
        for item in items: ops.record(self.config,item)
        return items

    @patch.object(ops,'active_under',return_value=False)
    def test_ten_old_successes_current_failures_and_dry_run(self,_):
        items = self.populate(12)
        self.config['services']['main']['currentPath'] = items[-1]['path']
        failed = self.evidence(13,'failed'); ops.record(self.config,failed)
        preview = ops.maintenance(self.config)
        self.assertEqual([x['id'] for x in preview['releases']], ['attempt-0'])
        self.assertTrue(Path(items[0]['path']).exists())
        ops.maintenance(self.config,True)
        self.assertFalse(Path(items[0]['path']).exists())
        self.assertTrue(Path(items[-1]['path']).exists()); self.assertTrue(Path(failed['path']).exists())

    @patch.object(ops,'active_under',return_value=False)
    def test_shared_dependency_is_protected_then_frozen(self,_):
        items = self.populate()
        first = Path(items[0]['path']); (first / 'node_modules').mkdir(); (first / 'node_modules/module.js').write_text('synthetic')
        ops.atomic(first / '.release-manifest.json',{'platform':'linux','arch':'x64'})
        for item in items:
            item['recovery']['runtime']['path'] = str(first/'node_modules'); ops.record(self.config,item)
        preview = ops.maintenance(self.config)
        self.assertEqual(preview['releases'],[])
        self.assertIn('SHARED_RUNTIME_PROTECTED', [w['code'] for w in preview['warnings']])
        frozen = ops.freeze_runtime(self.config,'main',str(first))
        self.assertTrue(Path(frozen['runtime']['path']).exists())
        self.assertEqual(len(ops.maintenance(self.config)['releases']),1)
        ops.maintenance(self.config,True)
        self.assertFalse(first.exists())
        # Runtime material is outside release cleanup, and corruption removes recovery eligibility.
        Path(frozen['runtime']['path']).write_text('corrupt')
        ledger = ops.read(self.state/'deployments.json',{})
        self.assertFalse(ops.recovery_ready(ledger['records'][1]))

    @patch.object(ops,'active_under',return_value=False)
    def test_unknown_missing_config_data_and_business_files_are_protected(self,_):
        items = self.populate()
        oldest = Path(items[0]['path']); (oldest/'users.db').touch()
        self.assertEqual(ops.maintenance(self.config)['releases'],[])
        self.assertIn('BUSINESS_OR_CONFIG_PATH_PROTECTED',[w['code'] for w in ops.maintenance(self.config)['warnings']])
        self.config_ref.unlink()
        self.assertEqual(ops.maintenance(self.config)['releases'],[])
        self.assertTrue(oldest.exists())
        self.assertFalse(ops.recovery_ready(items[1]))

    def test_incomplete_attempts_and_concurrent_deployments(self):
        item = self.evidence(0); item['checks']['health'] = False
        with self.assertRaisesRegex(ValueError,'INCOMPLETE'): ops.record(self.config,item)
        item['status'] = 'running'; ops.record(self.config,item)
        self.assertEqual(ops.maintenance(self.config,True)['code'],'DEPLOYMENT_IN_PROGRESS')
        with ops.lock(self.state):
            with self.assertRaises(OSError):
                with ops.lock(self.state): pass

    def test_invalid_paths_and_dependency_changes(self):
        service = self.config['services']['main']
        for file in (self.root,self.releases,self.root/'release-outside',self.releases/'wrong-name'):
            with self.assertRaises(ValueError): ops.release_path(service,str(file))
        item = self.evidence(0)
        declaration = ops.read(Path(item['path'])/'package-lock.json',{})
        declaration['packages']['node_modules/synthetic']['version'] = '2'
        ops.atomic(Path(item['path'])/'package-lock.json',declaration)
        self.assertFalse(ops.recovery_ready(item))

    def test_corrupt_ledger_fails_closed(self):
        self.state.mkdir(); (self.state/'deployments.json').write_text('invalid json')
        with self.assertRaisesRegex(ValueError,'LEDGER_INVALID'): ops.maintenance(self.config,True)
        self.assertEqual((self.state/'deployments.json').read_text(),'invalid json')

    def test_relocation_preserves_deployment_success_time(self):
        item=self.evidence(0);ops.record(self.config,item)
        stamp=item.pop('finishedAt');ops.record(self.config,item)
        self.assertEqual(ops.read(self.state/'deployments.json',{})['records'][0]['finishedAt'],stamp)

    @patch.object(ops,'active_under',return_value=True)
    def test_active_process_or_unobserved_process_is_protected(self,_):
        self.populate()
        self.assertEqual(ops.maintenance(self.config)['releases'],[])

    @patch.object(ops,'active_under',return_value=False)
    def test_symlink_release_is_never_deleted(self,_):
        self.populate()
        link = self.releases/'release-link'
        try: link.symlink_to(self.runtime,target_is_directory=True)
        except OSError: self.skipTest('symlink privilege unavailable')
        with self.assertRaises(ValueError): ops.release_path(self.config['services']['main'],str(link))

    @patch.object(ops,'active_under',return_value=False)
    def test_global_log_budget_oldest_first_active_and_business_untouched(self,_):
        for i in range(4):
            file = self.logs / f'closed-{i}.log'
            with file.open('wb') as handle: handle.truncate(80*1024*1024)
            os.utime(file,(i+100,i+100))
        active = self.logs/'application.log'; active.write_text('live')
        business = self.logs/'users.db'; business.write_text('protected')
        manifest = self.logs/'deployment-evidence.json'; manifest.write_text('{}')
        preview = ops.maintenance(self.config)
        self.assertEqual([Path(f['path']).name for f in preview['logs']['delete']],['closed-0.log','closed-1.log'])
        self.assertLessEqual(preview['logs']['projectedBytes'],225*1024*1024)
        ops.maintenance(self.config,True)
        active.write_text('still live')
        self.assertTrue(business.exists()); self.assertTrue(manifest.exists()); self.assertTrue((self.logs/'closed-3.log').exists())

    @patch.object(ops,'active_under',return_value=False)
    def test_capacity_warning_for_large_active_log(self,_):
        active = self.logs/'application.log'
        with active.open('wb') as handle: handle.truncate(301*1024*1024)
        plan = ops.logs_plan(self.config)
        self.assertTrue(plan['capacityWarning']); self.assertEqual(plan['delete'],[])

    @patch.object(ops,'active_under',return_value=False)
    def test_failed_diagnostics_expire_without_destroying_recent_evidence(self,_):
        old = self.evidence(0,'failed'); old.update(errorCode='STATIC_ASSET_FAILED',failureStage='STATIC_ASSETS')
        recent = self.evidence(1,'failed'); recent.update(finishedAt=ops.now(),errorCode='HEALTH_CHECK_FAILED',failureStage='HEALTH')
        ops.record(self.config,old); ops.record(self.config,recent)
        ops.maintenance(self.config,True)
        rows = ops.read(self.state/'deployments.json',{})['records']
        self.assertNotIn('errorCode',rows[0]); self.assertEqual(rows[1]['errorCode'],'HEALTH_CHECK_FAILED')

    @patch.object(ops,'active_under',return_value=False)
    def test_cleanup_failure_preserves_record_and_running_release(self,_):
        self.populate()
        with patch.object(ops.shutil,'rmtree',side_effect=OSError('synthetic')):
            result = ops.maintenance(self.config,True)
        self.assertEqual(result['failures'][0]['code'],'RELEASE_CLEANUP_FAILED')
        self.assertTrue((self.releases/'release-0').exists())
        self.assertNotIn('prunedAt',ops.read(self.state/'deployments.json',{})['records'][0])

if __name__ == '__main__': unittest.main()
