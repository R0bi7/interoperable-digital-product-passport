import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

SOURCE = Path(__file__).resolve().parents[2] / 'scripts'


class WatchdogTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / 'scripts').mkdir()
        for name in ('live-watchdog.py', 'scan-health.sh'):
            shutil.copyfile(SOURCE / name, self.root / 'scripts' / name)
        self.env = dict(os.environ, LIVE_IDLE_SECONDS='0.3', LIVE_WAIT_SECONDS='0.3', LIVE_HEARTBEAT_SECONDS='0.1', LIVE_INTERRUPT_GRACE_SECONDS='1')

    def tearDown(self): self.temp.cleanup()

    def run_child(self, code):
        return subprocess.run([sys.executable, str(self.root / 'scripts/live-watchdog.py'), '--command', sys.executable, '-u', '-c', code], env=self.env, capture_output=True, text=True, timeout=5)

    def test_silent_child_gets_sigint_and_writes_checkpoint(self):
        result = self.run_child("import signal,time,pathlib,sys; signal.signal(signal.SIGINT,lambda *_:(pathlib.Path('checkpoint').write_text('saved'),sys.exit(0))); time.sleep(60)")
        self.assertEqual(result.returncode, 130, result.stdout + result.stderr)
        self.assertEqual((self.root / 'checkpoint').read_text(), 'saved')
        self.assertIn('no new child line', result.stdout)
        self.assertIn('alive=True', result.stdout)

    def test_repeated_waits_do_not_evade_stop(self):
        result = self.run_child("import time\nwhile True:\n print('waiting for destination (different elapsed time)')\n time.sleep(0.03)")
        self.assertEqual(result.returncode, 130, result.stdout + result.stderr)
        self.assertIn('repeated waiting/404', result.stdout)

    def test_progress_resets_wait_across_phases(self):
        code = "import time\nfor phase in ('mint', 'send', 'delivery'):\n print('waiting for '+phase)\n time.sleep(0.18)\n print('DS4 phase: '+phase+' complete')"
        result = self.run_child(code)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn('Watchdog STOP', result.stdout)
        self.assertIn('DS4 phase: delivery complete', result.stdout)

    def test_reconciliation_progress_prevents_idle_stop(self):
        code = "import time\nprint('DS4 reconcile start: 5 broadcast mint ids')\nfor token in range(5):\n time.sleep(0.18)\n print(f'DS4 reconcile token {token}: unresolved')\nprint('DS4 reconcile end: 5 broadcast mint ids')"
        result = self.run_child(code)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn('Watchdog STOP', result.stdout)
        self.assertIn('DS4 reconcile end: 5 broadcast mint ids', result.stdout)

    def test_preserves_child_exit_status_and_tees_output(self):
        result = self.run_child("import sys; print('completed'); sys.exit(7)")
        self.assertEqual(result.returncode, 7)
        log = next((self.root / 'e2e_reports').glob('live-*.log')).read_text()
        self.assertIn('completed', log)
        self.assertNotIn('Watchdog STOP', log)


    def test_closing_stdout_does_not_disable_idle_watchdog(self):
        result = self.run_child("import os,time; os.close(1); os.close(2); time.sleep(60)")
        self.assertEqual(result.returncode, 130, result.stdout + result.stderr)
        self.assertIn('no new child line', result.stdout)

    def test_descendant_is_killed_even_if_launcher_exits_on_sigint(self):
        code = "import subprocess,signal,sys,time; p=subprocess.Popen([sys.executable,'-c',\"import signal,time; signal.signal(signal.SIGINT,signal.SIG_IGN); time.sleep(60)\"]); open('descendant','w').write(str(p.pid)); signal.signal(signal.SIGINT,lambda *_:sys.exit(0)); time.sleep(60)"
        pid = None
        try:
            result = self.run_child(code)
            pid = int((self.root / 'descendant').read_text())
            self.assertEqual(result.returncode, 130, result.stdout + result.stderr)
            self.assertIn('SIGKILL surviving process group', result.stdout)
            state = subprocess.run(['ps','-p',str(pid),'-o','stat='], capture_output=True, text=True).stdout.strip()
            self.assertTrue(not state or state.startswith('Z'), state)
        finally:
            if pid:
                try: os.kill(pid, 9)
                except ProcessLookupError: pass

    def test_active_log_does_not_make_a_clean_child_dirty(self):
        subprocess.run(['git','init','-q'], cwd=self.root, check=True)
        subprocess.run(['git','add','scripts'], cwd=self.root, check=True)
        subprocess.run(['git','-c','user.name=Test','-c','user.email=test@example.test','commit','-qm','fixture'], cwd=self.root, check=True)
        result = self.run_child("import subprocess; print('DIRTY='+subprocess.check_output(['git','status','--porcelain'],text=True).strip())")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('DIRTY=\n', result.stdout)
        self.assertNotIn('?? e2e_reports', result.stdout)
        self.assertTrue(list((self.root / 'e2e_reports').glob('live-*.log')))

    def health(self, status, seconds_ago, off_mesh=False):
        fake = self.root / 'curl'
        fake.write_text("#!/usr/bin/env python3\nimport json,os,re,sys\nb=json.loads(os.environ['HEALTH_RESPONSE']); eid=int(re.search(r'srcChainIds=(\\d+)',sys.argv[-1]).group(1))\nfor m in b['data']: m['pathway']={'srcEid':eid,'dstEid':(40231 if eid==40161 else 40161)}\nif os.environ.get('OFF_MESH'): b['data'].insert(0,{'created':b['data'][0]['created'],'status':{'name':'BLOCKED'},'pathway':{'srcEid':eid,'dstEid':40378}})\nprint(json.dumps(b))\n")
        fake.chmod(0o755)
        created = (datetime.now(timezone.utc) - timedelta(seconds=seconds_ago)).isoformat()
        env = dict(self.env, OFF_MESH='1' if off_mesh else '', PATH=str(self.root) + os.pathsep + os.environ['PATH'], HEALTH_RESPONSE=json.dumps({'data': [{'created': created, 'status': {'name': status}}]}))
        return subprocess.run(['bash', str(self.root / 'scripts/scan-health.sh')], env=env, capture_output=True, text=True, timeout=5)

    def test_health_requires_fresh_delivered_or_inflight_on_all_sources(self):
        for status in ('DELIVERED', 'INFLIGHT'):
            self.assertEqual(self.health(status, 30).returncode, 0)
        self.assertEqual(self.health('CONFIRMING', 30).returncode, 1)
        self.assertEqual(self.health('DELIVERED', 3601).returncode, 1)

    def test_off_mesh_configuration_failures_do_not_block_eval3_health(self):
        self.assertEqual(self.health('DELIVERED', 30, off_mesh=True).returncode, 0)


if __name__ == '__main__': unittest.main()
