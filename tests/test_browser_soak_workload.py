"""Exercise the real workload and input guard with a device-free fixture transport."""
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
from xml.etree import ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_browser_device_guard import FakeAdb, XML, ROOT, ACCEPTANCE

RUN = "unique-soak-regression"
BASE = "http://127.0.0.1:8877/browser-lifecycle.html"


class FixtureAdb(FakeAdb):
    def __init__(self, receipts, fault=None):
        super().__init__()
        self.receipts, self.fault = receipts, fault
        self.state = dict(run=RUN, page="a", created=100, scrollY=0)
        self.sidebar = "Collapse sidebar"
        self.action_names = []
        self.scroll_attempts = 0
        self.refresh_xml()

    def refresh_xml(self):
        self.state["href"] = f"{BASE}?page={self.state['page']}&run={RUN}"
        tree = ET.fromstring(XML)
        web = next(n for n in tree.iter("node") if n.get("class") == "android.webkit.WebView")
        web.set("text", f"Lifecycle {self.state['page'].upper()}")
        next(n for n in tree.iter("node") if n.get("content-desc") == "Collapse sidebar").set("content-desc", self.sidebar)
        ET.SubElement(web, "node", {"package": ACCEPTANCE, "resource-id": "state", "text": json.dumps(self.state),
                                  "class": "android.view.View", "bounds": "[616,26][3176,1976]"})
        self.xml = ET.tostring(tree)

    def emit(self, kind):
        value = dict(self.state)
        if self.fault == "foreign":
            value.update(run="other-run", page="b", created=101, scrollY=1100,
                         href=f"{BASE}?page=b&run=other-run")
        with self.receipts.open("a") as output:
            output.write(json.dumps({"kind": kind, "value": value}) + "\n")

    def __call__(self, *command):
        if command == ("exec-out", "screencap", "-p"):
            return b"test screenshot"
        result = super().__call__(*command)
        if command[:2] != ("shell", "input"):
            return result
        x = int(command[3])
        if x < 200:
            self.action_names.append(self.sidebar)
            self.sidebar = "Expand sidebar" if self.sidebar == "Collapse sidebar" else "Collapse sidebar"
            if self.fault in ("reload", "scroll-loss"):
                self.state["scrollY"] = 0
                if self.fault == "reload": self.state["created"] = 202
        elif x < 1500:
            self.action_names.append("Next lifecycle page")
            if self.fault != "foreign": self.state.update(page="b", created=101, scrollY=0)
            self.refresh_xml()
            self.emit("lifecycle-loaded")
        elif x < 2200:
            self.action_names.append("Scroll to marker")
            self.scroll_attempts += 1
            if self.fault != "miss-scroll" or self.scroll_attempts > 1:
                self.state["scrollY"] = 1100
                self.emit("lifecycle-scroll-command")
        else:
            self.action_names.append("Report page state")
            self.emit("lifecycle-checkpoint")
        self.refresh_xml()
        return result


class WorkloadReceiptTest(unittest.TestCase):
    def exercise(self, fault=None):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            receipts = directory / "server.jsonl"
            receipts.write_text("")
            adb = FixtureAdb(receipts, fault)
            argv = ["run-browser-soak-workload.py", "--serial", "fake-device", "--run", RUN,
                    "--out", str(directory / "out"), "--receipts", str(receipts), "--cycles", "1"]
            clock = [0.0]
            def sleep(seconds): clock[0] += seconds
            failure = None
            with patch.object(sys, "argv", argv), patch.object(subprocess, "check_output", adb.check_output), \
                    patch("time.monotonic", lambda: clock[0]), patch("time.sleep", sleep), contextlib.redirect_stdout(io.StringIO()):
                try: runpy.run_path(str(ROOT / "scripts/run-browser-soak-workload.py"), run_name="__main__")
                except (RuntimeError, AssertionError) as error: failure = error
            receipt = json.loads((directory / "out/workload-receipt.json").read_text())
            attempts = [json.loads(line) for line in (directory / "out/input-attempts.jsonl").read_text().splitlines()]
            return receipt, attempts, adb.action_names, failure

    def test_other_run_receipts_cannot_pass_an_input_that_never_navigated(self):
        receipt, attempts, _, failure = self.exercise("foreign")
        self.assertFalse(receipt["allCyclesPassed"])
        self.assertIsNotNone(failure)
        self.assertEqual([row["passed"] for row in attempts], [False, False])

    def test_sidebar_reload_cannot_reuse_the_checkpoint_from_before_the_toggle(self):
        receipt, _, _, failure = self.exercise("reload")
        self.assertFalse(receipt["allCyclesPassed"])
        self.assertIsNotNone(failure)

    def test_sidebar_scroll_loss_is_measured_by_a_new_report(self):
        receipt, attempts, names, failure = self.exercise("scroll-loss")
        self.assertFalse(receipt["allCyclesPassed"])
        self.assertIsNotNone(failure)
        self.assertEqual(names[-1], "Report page state")
        self.assertFalse(attempts[-1]["passed"])

    def test_a_retry_remains_visible_and_success_uses_a_post_sidebar_checkpoint(self):
        receipt, attempts, names, failure = self.exercise("miss-scroll")
        self.assertIsNone(failure)
        self.assertTrue(receipt["allCyclesPassed"])
        self.assertEqual(receipt["failedInputAttempts"], 1)
        self.assertEqual(names[-1], "Report page state")
        self.assertEqual([row["passed"] for row in attempts if row["action"] == "lifecycle-scroll-command"], [False, True])


if __name__ == "__main__": unittest.main()
