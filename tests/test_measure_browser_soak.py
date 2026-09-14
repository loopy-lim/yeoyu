"""Run the real sampler against a process that exits between ps and meminfo."""
import contextlib
import io
import json
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = 'com.workspacebrowser.acceptance'

class SamplingRaceTest(unittest.TestCase):
    def sample(self, fault):
        calls = [0]
        clock = [0]
        def now():
            clock[0] += 1
            return clock[0]
        def run(argv, **kwargs):
            if argv[4] == 'ps':
                calls[0] += 1
                main = 3 if fault == 'restart' and calls[0] > 1 else 1
                child = calls[0] == 1 or fault == 'unreadable'
                body = f'PID NAME\n{main} {PACKAGE}\n' + (f'2 {PACKAGE}:tab\n' if child else '')
            else:
                body = 'No process found for: 2\n' if argv[-1] == '2' else 'TOTAL PSS: 500\n'
            return subprocess.CompletedProcess(argv, 0, stdout=body, stderr='')
        with tempfile.TemporaryDirectory() as tmp:
            argv = ['measure-browser-soak.py', '--serial', 'fake', '--out', tmp, '--tabs', '2', '--duration-seconds', '1']
            with patch.object(sys, 'argv', argv), patch.object(subprocess, 'run', run), patch('time.monotonic', now), contextlib.redirect_stdout(io.StringIO()):
                runpy.run_path(str(ROOT/'scripts/measure-browser-soak.py'), run_name='__main__')
            return json.loads((Path(tmp)/'receipt.json').read_text()), json.loads((Path(tmp)/'samples.jsonl').read_text().splitlines()[0]), calls[0]

    def test_exited_child_gets_one_fresh_enumeration_and_keeps_failed_attempt(self):
        receipt, row, calls = self.sample('exited')
        self.assertTrue(receipt['allSamplesComplete'])
        self.assertEqual(calls, 2)
        self.assertEqual(row['totalPssKb'], 500)
        self.assertIsNone(row['attempts'][0]['processes'][1]['pssKb'])
        self.assertEqual(len(row['processes']), 1)

    def test_still_unreadable_child_remains_incomplete_after_bounded_retry(self):
        receipt, _, calls = self.sample('unreadable')
        self.assertFalse(receipt['allSamplesComplete'])
        self.assertEqual(calls, 2)

    def test_main_restart_during_retry_cannot_be_reported_as_complete(self):
        receipt, _, calls = self.sample('restart')
        self.assertFalse(receipt['allSamplesComplete'])
        self.assertEqual(calls, 2)

if __name__ == '__main__': unittest.main()
