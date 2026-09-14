"""Device-free input-boundary regressions for the Acceptance soak workload."""
import json
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from xml.etree import ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from browser_device_guard import BrowserDeviceGuard, GuardError, matches, parse_foreground
ACCEPTANCE = "com.workspacebrowser.acceptance"
NORMAL = "com.workspacebrowser"

# Minimal API 36 records from physical-state-audit/activities.txt. Only the
# package/record values vary in tests; background Acceptance is not foreground.
def activities(package=ACCEPTANCE, focus=None):
    focus = package if focus is None else focus
    return f"""ACTIVITY MANAGER ACTIVITIES (dumpsys activity activities)
Display #0 (activities from top to bottom):
    topResumedActivity=ActivityRecord{{132248474 u0 {package}/com.workspacebrowser.MainActivity t323, isEmbedded=false}}
  * Task{{73c43ef #322 type=standard A=10327:{ACCEPTANCE} U=0 visible=false visibleRequested=false}}
    mLastPausedActivity: ActivityRecord{{221224397 u0 {ACCEPTANCE}/com.workspacebrowser.MainActivity t322, isEmbedded=false}}
  Resumed activities in task display areas (from top to bottom):
    Resumed: ActivityRecord{{132248474 u0 {package}/com.workspacebrowser.MainActivity t323, isEmbedded=false}}
  ResumedActivity: ActivityRecord{{132248474 u0 {package}/com.workspacebrowser.MainActivity t323, isEmbedded=false}}
ActivityTaskSupervisor state:
  Display: mDisplayId=0 (organized)
    init=2000x3200 400dpi mMinSizeOfResizeableTaskDp=220 cur=3200x2000 app=3200x2000
  mCurrentFocus=Window{{334984 u0 {focus}/com.workspacebrowser.MainActivity}}
  mFocusedApp=ActivityRecord{{132248474 u0 {package}/com.workspacebrowser.MainActivity t323, isEmbedded=false}}
  DisplayFrames w=3200 h=2000 r=1
    mAwake=true mScreenOnEarly=true mScreenOnFully=true
    isKeyguardShowing=false
    mFocusedWindow=Window{{334984 u0 {focus}/com.workspacebrowser.MainActivity}}
""".encode()


# Bounds, classes and labels from soak-100-before-texture-fix/cycle-01.xml.
# Unrelated descendants are omitted, retaining API 36 package ownership.
XML = f"""<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="1">
 <node class="android.widget.FrameLayout" package="{ACCEPTANCE}" enabled="true" bounds="[0,0][3200,2000]">
  <node class="android.widget.Button" package="{ACCEPTANCE}" text="" content-desc="Collapse sidebar" enabled="true" clickable="true" bounds="[30,50][110,130]" />
  <node class="android.webkit.WebView" package="{ACCEPTANCE}" text="Lifecycle A" content-desc="" enabled="true" bounds="[616,26][3176,1976]">
   <node class="android.view.View" package="{ACCEPTANCE}" text="" content-desc="Next lifecycle page" enabled="true" clickable="true" bounds="[973,91][1537,230]" />
   <node class="android.widget.Button" package="{ACCEPTANCE}" text="Scroll to marker" content-desc="" enabled="true" clickable="true" bounds="[1577,86][2068,235]" />
   <node class="android.widget.Button" package="{ACCEPTANCE}" text="Report page state" content-desc="" enabled="true" clickable="true" bounds="[2108,86][2653,235]" />
  </node>
 </node>
</hierarchy>""".encode()


class FakeAdb:
    def __init__(self, foreground=None, xml=XML, dump_ok=True):
        self.foreground = foreground or [activities()]
        self.xml = xml
        self.dump_ok = dump_ok
        self.commands = []
        self.inputs = []
        self.fail_on_input = False

    def __call__(self, *args):
        args = tuple(map(str, args))
        self.commands.append(args)
        if args == ("shell", "dumpsys", "activity", "activities"):
            return self.foreground.pop(0) if len(self.foreground) > 1 else self.foreground[0]
        if args[:3] == ("shell", "uiautomator", "dump"):
            return (f"UI hierchary dumped to: {args[3]}\n".encode()
                    if self.dump_ok else b"ERROR: could not get idle state.\n")
        if args[:2] == ("exec-out", "cat"):
            return self.xml
        if args[:2] == ("shell", "input"):
            self.inputs.append(args)
            if self.fail_on_input:
                raise RuntimeError("unsafe input reached fake device")
            return b""
        raise AssertionError(f"unexpected device command: {args}")

    def check_output(self, command, **kwargs):
        if command[:3] != ["adb", "-s", "fake-device"]:
            raise AssertionError(f"unexpected subprocess: {command}")
        return self(*command[3:])


class WorkloadBoundaryTest(unittest.TestCase):
    def run_workload(self, adb, directory):
        receipts = directory / "fixture.jsonl"
        receipts.write_text("")
        argv = ["run-browser-soak-workload.py", "--serial", "fake-device",
                "--out", str(directory / "out"), "--receipts", str(receipts),
                "--cycles", "1", "--run", "fixture-run"]
        adb.fail_on_input = True
        with patch.object(sys, "argv", argv), patch.object(subprocess, "check_output", adb.check_output):
            with self.assertRaises(RuntimeError):
                runpy.run_path(str(ROOT / "scripts/run-browser-soak-workload.py"), run_name="__main__")
        return json.loads((directory / "out/workload-receipt.json").read_text())

    def test_normal_foreground_with_acceptance_xml_aborts_before_input(self):
        adb = FakeAdb(foreground=[activities(NORMAL)])
        with tempfile.TemporaryDirectory() as directory:
            receipt = self.run_workload(adb, Path(directory))
            self.assertEqual(adb.inputs, [], "normal app must never receive workload input")
            self.assertEqual(receipt["completedCycles"], 0)
            self.assertIn("GuardError", receipt["failure"])

    def test_failed_dump_does_not_read_old_xml_or_send_input(self):
        adb = FakeAdb(dump_ok=False)
        with tempfile.TemporaryDirectory() as directory:
            self.run_workload(adb, Path(directory))
            self.assertEqual(adb.inputs, [], "failed dump must not reuse a previous UI tree")
            self.assertFalse(any(command[:2] == ("exec-out", "cat") for command in adb.commands))

    def test_complete_fixture_cycle_preserves_receipts_with_guarded_inputs(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            receipts = directory / "fixture.jsonl"
            receipts.write_text("")

            class FixtureAdb(FakeAdb):
                def __init__(self):
                    super().__init__()
                    self.set_state("a", 100, 0)

                def set_state(self, page, created, scroll):
                    value = {"run": "fixture-run", "page": page, "created": created, "scrollY": scroll,
                             "href": f"http://127.0.0.1:8877/browser-lifecycle.html?page={page}&run=fixture-run"}
                    tree = ET.fromstring(self.xml)
                    web = next(n for n in tree.iter("node") if n.get("class") == "android.webkit.WebView")
                    states = [n for n in web if n.get("resource-id") == "state"]
                    state = states[0] if states else ET.SubElement(web, "node", {
                        "resource-id": "state", "class": "android.view.View", "package": ACCEPTANCE,
                        "bounds": "[616,26][3176,1976]"})
                    state.set("text", json.dumps(value))
                    self.xml = ET.tostring(tree)
                    return value

                def __call__(self, *command):
                    if command == ("exec-out", "screencap", "-p"):
                        return b"fake screenshot"
                    result = super().__call__(*command)
                    if command[:2] == ("shell", "input"):
                        count = len(self.inputs)
                        if count in (1, 2, 5):
                            kind = {1: "lifecycle-loaded", 2: "lifecycle-scroll-command", 5: "lifecycle-checkpoint"}[count]
                            value = self.set_state("b", 101, 0 if count == 1 else 1100)
                            with receipts.open("a") as output:
                                output.write(json.dumps({"kind": kind, "value": value}) + "\n")
                            if count == 1:
                                self.xml = self.xml.replace(b"Lifecycle A", b"Lifecycle B")
                        elif count == 3:
                            self.xml = self.xml.replace(b"Collapse sidebar", b"Expand sidebar")
                        elif count == 4:
                            self.xml = self.xml.replace(b"Expand sidebar", b"Collapse sidebar")
                    return result

            adb = FixtureAdb()
            argv = ["run-browser-soak-workload.py", "--serial", "fake-device", "--out", str(directory / "out"),
                    "--receipts", str(receipts), "--cycles", "1", "--run", "fixture-run"]
            with patch.object(sys, "argv", argv), patch.object(subprocess, "check_output", adb.check_output), patch("builtins.print"):
                runpy.run_path(str(ROOT / "scripts/run-browser-soak-workload.py"), run_name="__main__")
            receipt = json.loads((directory / "out/workload-receipt.json").read_text())
            self.assertEqual(receipt["completedCycles"], 1)
            self.assertEqual(receipt["expectedPackage"], ACCEPTANCE)
            self.assertIsNone(receipt["failure"])
            self.assertEqual(len(adb.inputs), 5)
            for index, command in enumerate(adb.commands):
                if command[:2] == ("shell", "input"):
                    self.assertEqual(adb.commands[index - 1], ("shell", "dumpsys", "activity", "activities"))


class ForegroundTest(unittest.TestCase):
    def test_resumed_activity_and_input_window_agree_on_rotated_bounds(self):
        result = parse_foreground(activities())
        self.assertEqual(result.activity[2], f"{ACCEPTANCE}/com.workspacebrowser.MainActivity")
        self.assertEqual((result.width, result.height, result.rotation), (3200, 2000, 1))

    def test_normal_foreground_is_not_authorized_by_background_acceptance(self):
        with self.assertRaises(GuardError):
            parse_foreground(activities(NORMAL))

    def test_foreign_focused_overlay_is_denied_even_when_acceptance_resumed(self):
        for package in (NORMAL, "com.android.permissioncontroller", "com.android.systemui"):
            with self.subTest(package=package), self.assertRaises(GuardError):
                parse_foreground(activities(focus=package))

    def test_missing_unknown_conflicting_or_locked_foreground_fails_closed(self):
        valid = activities().decode()
        variants = [
            "", valid.replace("topResumedActivity=ActivityRecord", "topResumedActivity=null #"),
            valid.replace("mCurrentFocus=Window", "mCurrentFocus=null #"),
            valid.replace("mFocusedApp=ActivityRecord", "mFocusedApp=null #"),
            valid.replace("ResumedActivity: ActivityRecord{132248474", "ResumedActivity: ActivityRecord{123456"),
            valid.replace("mScreenOnFully=true", "mScreenOnFully=false"),
            valid.replace("mAwake=true", "mAwake=false"),
            valid.replace("isKeyguardShowing=false", "isKeyguardShowing=true"),
            valid.replace("mCurrentFocus=Window{334984 u0 " + ACCEPTANCE + "/com.workspacebrowser.MainActivity}",
                          "mCurrentFocus=Window{334984 u0 NotificationShade}"),
            valid.replace("mFocusedApp=", "unknownField="),
            valid.replace("mFocusedWindow=Window{334984", "mFocusedWindow=Window{123456"),
        ]
        for text in variants:
            with self.subTest(text=text[:90]), self.assertRaises(GuardError):
                parse_foreground(text)

    def test_unknown_multidisplay_and_changing_geometry_fail_closed(self):
        valid = activities().decode()
        for text in (valid.replace("cur=3200x2000", "cur=2000x3200"),
                     valid.replace("Display #0", "Display #2"),
                     valid + "\nDisplay #1 (activities from top to bottom):\n",
                     valid.replace("DisplayFrames w=3200 h=2000 r=1", "DisplayFrames w=0 h=0 r=1")):
            with self.subTest(text=text[-90:]), self.assertRaises(GuardError):
                parse_foreground(text)


class InputGuardTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.out = Path(self.directory.name)

    def guard(self, adb):
        return BrowserDeviceGuard(adb, self.out)

    def assert_denied(self, adb, action=None):
        with self.assertRaises(GuardError):
            (action or (lambda guard: guard.press(desc="Collapse sidebar")))(self.guard(adb))
        self.assertEqual(adb.inputs, [])
        self.assertTrue(list(self.out.glob("input-guard/*/denied.json")))
        self.assertFalse(any("am" in command or "start" in command for command in adb.commands),
                         "a guard failure must not launch an app to repair foreground")

    def test_valid_press_uses_fresh_dump_and_rechecks_foreground_just_before_input(self):
        adb = FakeAdb()
        self.guard(adb).press(desc="Collapse sidebar")
        self.assertEqual(adb.inputs, [("shell", "input", "swipe", "70", "90", "70", "90", "180")])
        self.assertEqual(adb.commands[-2], ("shell", "dumpsys", "activity", "activities"))
        self.assertEqual(len(list(self.out.glob("input-guard/*/ui.xml"))), 1)

    def test_transient_idle_failure_retries_only_fresh_read_and_keeps_evidence(self):
        adb = FakeAdb()
        dumps = []

        def transient(*command):
            if command[:3] == ("shell", "uiautomator", "dump"):
                dumps.append(command[3])
                if len(dumps) == 1:
                    return b"ERROR: could not get idle state.\n"
            return adb(*command)

        self.guard(transient).press(desc="Collapse sidebar")
        self.assertEqual(len(dumps), 2)
        self.assertEqual(len(set(dumps)), 2)
        self.assertEqual([c[2] for c in adb.commands if c[:2] == ("exec-out", "cat")], dumps[1:])
        self.assertEqual(len(adb.inputs), 1)
        self.assertEqual(next(self.out.glob("input-guard/*/dump.txt")).read_bytes(),
                         b"ERROR: could not get idle state.\n")
        self.assertTrue(list(self.out.glob("input-guard/*/dump-retry.txt")))

    def test_persistent_idle_failure_stops_after_two_reads_without_input(self):
        adb = FakeAdb(dump_ok=False)
        self.assert_denied(adb)
        self.assertEqual(sum(c[:3] == ("shell", "uiautomator", "dump") for c in adb.commands), 2)
        self.assertFalse(any(c[:2] == ("exec-out", "cat") for c in adb.commands))

    def test_idle_failure_with_foreground_change_does_not_retry_or_input(self):
        adb = FakeAdb(dump_ok=False, foreground=[activities(), activities(NORMAL)])
        self.assert_denied(adb)
        self.assertEqual(sum(c[:3] == ("shell", "uiautomator", "dump") for c in adb.commands), 1)

    def test_unknown_dump_failure_is_not_retried(self):
        adb = FakeAdb()
        calls = []

        def unknown(*command):
            if command[:3] == ("shell", "uiautomator", "dump"):
                calls.append(command)
                return b"ERROR: unknown capture failure\n"
            return adb(*command)

        with self.assertRaises(GuardError):
            self.guard(unknown).press(desc="Collapse sidebar")
        self.assertEqual(len(calls), 1)
        self.assertEqual(adb.inputs, [])

    def test_cross_package_text_and_description_nodes_are_never_targets(self):
        tree = ET.fromstring(XML)
        target = next(node for node in tree.iter("node") if node.get("content-desc") == "Collapse sidebar")
        target.set("package", NORMAL)
        self.assertEqual(matches(tree, desc="Collapse sidebar"), [])
        self.assert_denied(FakeAdb(xml=ET.tostring(tree)))

    def test_disabled_or_ambiguous_acceptance_target_is_denied(self):
        for change in ("disabled", "duplicate"):
            with self.subTest(change=change):
                tree = ET.fromstring(XML)
                target = next(node for node in tree.iter("node") if node.get("content-desc") == "Collapse sidebar")
                if change == "disabled":
                    target.set("enabled", "false")
                else:
                    tree[0].append(ET.fromstring(ET.tostring(target)))
                self.assert_denied(FakeAdb(xml=ET.tostring(tree)))

    def test_invalid_offscreen_and_clipped_target_bounds_are_denied(self):
        for bounds in ("[-1,50][110,130]", "[30,-1][110,130]", "[30,50][3201,130]",
                       "[30,50][110,2001]", "[30,50][30,130]", "[110,50][30,130]", "30 50 110 130"):
            with self.subTest(bounds=bounds):
                self.assert_denied(FakeAdb(xml=XML.replace(b"[30,50][110,130]", bounds.encode())))
        tree = ET.fromstring(XML)
        button = tree[0][0]
        tree[0].remove(button)
        clipped = ET.SubElement(tree[0], "node", {"package": ACCEPTANCE, "bounds": "[0,0][20,20]"})
        clipped.append(button)
        self.assert_denied(FakeAdb(xml=ET.tostring(tree)))

    def test_foreign_and_unknown_overlays_covering_input_are_denied(self):
        for package in (NORMAL, "com.android.systemui", ""):
            with self.subTest(package=package):
                tree = ET.fromstring(XML)
                ET.SubElement(tree, "node", {"package": package, "bounds": "[0,0][3200,2000]"})
                self.assert_denied(FakeAdb(xml=ET.tostring(tree)))

    def test_disjoint_system_bar_does_not_block_a_press(self):
        tree = ET.fromstring(XML)
        ET.SubElement(tree, "node", {"package": "com.android.systemui", "bounds": "[0,1980][3200,2000]"})
        adb = FakeAdb(xml=ET.tostring(tree))
        self.guard(adb).press(desc="Collapse sidebar")
        self.assertEqual(len(adb.inputs), 1)

    def test_foreground_switch_during_dump_and_just_before_input_aborts(self):
        for reports in ([activities(), activities(NORMAL)],
                        [activities(), activities(), activities(NORMAL)],
                        [activities(), activities(), activities().replace(b"t323", b"t324")],
                        [activities(), activities(), activities().replace(b"Window{334984", b"Window{123456")]):
            with self.subTest(reports=len(reports)):
                self.assert_denied(FakeAdb(foreground=reports))

    def test_failed_dump_invalid_xml_and_rotation_change_preserve_evidence(self):
        cases = (FakeAdb(dump_ok=False), FakeAdb(xml=b"not a hierarchy"),
                 FakeAdb(xml=XML.replace(b'rotation="1"', b'rotation="0"')))
        for adb in cases:
            with self.subTest(xml=adb.xml[:30]):
                self.assert_denied(adb)
        self.assertTrue(list(self.out.glob("input-guard/*/dump.txt")))
        self.assertTrue(any(path.read_bytes() == b"not a hierarchy" for path in self.out.glob("input-guard/*/ui.xml")))

    def test_command_failure_preserves_raw_error_and_never_reads_xml(self):
        adb = FakeAdb()
        def fail_dump(*command):
            if command[:3] == ("shell", "uiautomator", "dump"):
                raise subprocess.CalledProcessError(1, command, output=b"ERROR: UiAutomation not connected")
            return adb(*command)
        with self.assertRaises(GuardError):
            self.guard(fail_dump).press(desc="Collapse sidebar")
        self.assertEqual(adb.inputs, [])
        self.assertFalse(any(command[:2] == ("exec-out", "cat") for command in adb.commands))
        self.assertEqual(next(self.out.glob("input-guard/*/dump.txt")).read_bytes(), b"ERROR: UiAutomation not connected")

    def test_each_dump_uses_a_unique_path_and_only_reads_that_successful_dump(self):
        adb = FakeAdb()
        guard = self.guard(adb)
        guard.dump()
        guard.press(desc="Collapse sidebar")
        dumps = [command[3] for command in adb.commands if command[:3] == ("shell", "uiautomator", "dump")]
        reads = [command[2] for command in adb.commands if command[:2] == ("exec-out", "cat")]
        self.assertEqual(len(set(dumps)), 2)
        self.assertEqual(dumps, reads)
        self.assertNotIn("/sdcard/yeoyu-growth.xml", reads)

    def test_success_marker_for_an_old_dump_does_not_authorize_reading_it(self):
        adb = FakeAdb()
        def stale_dump(*command):
            if command[:3] == ("shell", "uiautomator", "dump"):
                return b"UI hierchary dumped to: /sdcard/yeoyu-growth.xml\n"
            return adb(*command)
        with self.assertRaises(GuardError):
            self.guard(stale_dump).press(desc="Collapse sidebar")
        self.assertEqual(adb.inputs, [])
        self.assertFalse(any(command[:2] == ("exec-out", "cat") for command in adb.commands))

    def test_changed_fixture_document_does_not_receive_a_stale_action(self):
        self.assert_denied(FakeAdb(), lambda guard: guard.press(desc="Next lifecycle page", expected_title="Lifecycle B"))

    def test_scroll_and_key_inputs_use_the_same_foreground_boundary(self):
        for action in (lambda guard: guard.swipe(1000, 1500, 1000, 500), lambda guard: guard.keyevent(4)):
            with self.subTest(action=action):
                self.assert_denied(FakeAdb(foreground=[activities(), activities(), activities(NORMAL)]), action)
                adb = FakeAdb()
                action(self.guard(adb))
                self.assertEqual(len(adb.inputs), 1)
                self.assertEqual(adb.commands[-2], ("shell", "dumpsys", "activity", "activities"))

    def test_scroll_path_intersecting_an_overlay_and_out_of_bounds_are_denied(self):
        tree = ET.fromstring(XML)
        ET.SubElement(tree, "node", {"package": "com.android.systemui", "bounds": "[900,900][1100,1100]"})
        self.assert_denied(FakeAdb(xml=ET.tostring(tree)), lambda guard: guard.swipe(1000, 1500, 1000, 500))
        self.assert_denied(FakeAdb(), lambda guard: guard.swipe(3200, 1500, 1000, 500))


# Anonymous synthetic trees preserve only the observed overlay ownership:
# background AX nodes remain exposed beside a full-screen Close and one card.
def sheet_xml(kind="address"):
    tree = ET.fromstring(XML)
    root = tree[0]

    def node(parent, bounds, cls="android.widget.Button", **attrs):
        return ET.SubElement(parent, "node", {"package": ACCEPTANCE, "enabled": "true",
            "class": cls, "bounds": bounds, "clickable": "true", **attrs})

    node(root, "[490,1873][570,1953]", **{"content-desc": "Add"})
    node(root, "[30,400][500,500]", **{"content-desc": "Tab New tab"})
    if kind == "normal":
        return ET.tostring(tree)
    if kind == "native":
        for child in list(root):
            root.remove(child)
        root.set("bounds", "[800,600][2400,1400]")
        node(root, "[900,700][2300,850]", "android.widget.CheckedTextView", text="Alpha")
        node(root, "[900,850][2300,1000]", "android.widget.CheckedTextView",
             text="Disabled", enabled="false")
        node(root, "[2000,1200][2300,1350]", text="Cancel")
        return ET.tostring(tree)
    overlay = node(root, "[0,0][3200,2000]", "android.view.ViewGroup")
    node(overlay, "[0,0][3200,2000]", **{"content-desc": "Close"})
    card = node(overlay, "[900,700][2300,1500]", "android.view.ViewGroup")
    if kind == "address":
        node(card, "[1000,800][2200,950]", "android.widget.EditText", **{"content-desc": "Address"})
    elif kind == "permission":
        for label, x in (("Dismiss", 1000), ("Allow once", 1400), ("Block", 1800)):
            node(card, f"[{x},1200][{x+300},1350]", text=label)
    elif kind == "settings":
        node(card, "[2000,730][2250,830]", text="Close settings")
        scroll = node(card, "[950,900][2250,1450]", "android.widget.ScrollView", scrollable="true")
        node(scroll, "[1000,950][2200,1050]", text="Preference")
    return ET.tostring(tree)


class SheetBoundaryTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.out = Path(self.tmp.name)

    def run_action(self, xml, action, denied=False):
        adb = FakeAdb(xml=xml)
        guard = BrowserDeviceGuard(adb, self.out)
        if denied:
            with self.assertRaises(GuardError):
                action(guard)
            self.assertEqual(adb.inputs, [], "overlay rejection must happen before input")
        else:
            try:
                action(guard)
            except GuardError as error:
                self.fail(f"permitted input was denied: {error}")
            self.assertEqual(len(adb.inputs), 1)
            self.assertEqual(adb.commands[-2], ("shell", "dumpsys", "activity", "activities"))
        return adb

    def raw_press(self, guard, desc):
        # Existing press_widget seam: no public guard.press target argument.
        snap = guard._capture()
        target = matches(snap.tree, desc=desc)[0]
        numbers = target["bounds"].replace("][", ",").replace("[", "").replace("]", "").split(",")
        bounds = tuple(map(int, numbers))
        guard._validate_region(snap, bounds)
        x, y = (bounds[0]+bounds[2])//2, (bounds[1]+bounds[3])//2
        guard._send(snap, "swipe", x, y, x, y, 180)

    def raw_region(self, guard, region):
        # Existing page_swipe seam validates its complete corridor directly.
        snap = guard._capture()
        guard._validate_region(snap, region)
        guard._send(snap, "swipe", region[0], region[1], region[2]-1, region[3]-1, 450)

    def test_address_blocks_background_add(self):
        self.run_action(sheet_xml(), lambda g: g.press(desc="Add"), denied=True)

    def test_address_blocks_background_tab(self):
        self.run_action(sheet_xml(), lambda g: g.press(desc="Tab New tab"), denied=True)

    def test_permission_blocks_background_add_tab_and_page_scroll(self):
        for action in (lambda g: g.press(desc="Add"), lambda g: g.press(desc="Tab New tab"),
                       lambda g: g.swipe(2700, 1600, 2700, 500)):
            with self.subTest(action=action):
                self.run_action(sheet_xml("permission"), action, denied=True)

    def test_background_node_inside_card_pixels_is_still_denied(self):
        tree = ET.fromstring(sheet_xml())
        matches(tree, desc="Add")[0]["bounds"] = "[1100,1000][1200,1100]"
        self.run_action(ET.tostring(tree), lambda g: g.press(desc="Add"), denied=True)

    def test_direct_widget_seam_blocks_background_add(self):
        self.run_action(sheet_xml(), lambda g: self.raw_press(g, "Add"), denied=True)

    def test_direct_page_scroll_seam_blocks_background_corridor(self):
        self.run_action(sheet_xml(), lambda g: self.raw_region(g, (2699, 499, 2701, 1601)), denied=True)

    def test_address_field_and_explicit_backdrop_close_are_allowed(self):
        for desc in ("Address", "Close"):
            with self.subTest(desc=desc):
                self.run_action(sheet_xml(), lambda g: g.press(desc=desc))

    def test_permission_buttons_are_allowed(self):
        for text in ("Dismiss", "Allow once", "Block"):
            with self.subTest(text=text):
                self.run_action(sheet_xml("permission"), lambda g: g.press(text=text))

    def test_settings_own_button_and_scroll_are_allowed(self):
        for action in (lambda g: g.press(text="Close settings"), lambda g: g.swipe(1500, 1350, 1500, 1000)):
            with self.subTest(action=action):
                self.run_action(sheet_xml("settings"), action)

    def test_settings_scroll_must_stay_inside_scrollable_card_region(self):
        for points in ((1500, 1400, 1500, 750), (2700, 1400, 2700, 1000)):
            with self.subTest(points=points):
                self.run_action(sheet_xml("settings"), lambda g: g.swipe(*points), denied=True)

    def test_direct_widget_seam_allows_exact_sheet_widget_bounds(self):
        self.run_action(sheet_xml(), lambda g: self.raw_press(g, "Address"))

    def test_direct_region_inside_card_without_widget_is_denied(self):
        self.run_action(sheet_xml(), lambda g: self.raw_region(g, (1500, 1000, 1501, 1200)), denied=True)

    def test_direct_widget_bounds_shared_with_background_are_denied(self):
        tree = ET.fromstring(sheet_xml())
        matches(tree, desc="Add")[0]["bounds"] = matches(tree, desc="Address")[0]["bounds"]
        self.run_action(ET.tostring(tree), lambda g: self.raw_press(g, "Address"), denied=True)

    def test_normal_page_add_tab_scroll_and_key_remain_allowed(self):
        for action in (lambda g: g.press(desc="Add"), lambda g: g.press(desc="Tab New tab"),
                       lambda g: g.swipe(2700, 1600, 2700, 500), lambda g: g.keyevent(4)):
            with self.subTest(action=action):
                self.run_action(sheet_xml("normal"), action)

    def test_native_prompt_enabled_choice_and_cancel_remain_allowed(self):
        for text in ("Alpha", "Cancel"):
            with self.subTest(text=text):
                self.run_action(sheet_xml("native"), lambda g: g.press(text=text))

    def test_native_prompt_disabled_choice_and_outside_scroll_remain_denied(self):
        for action in (lambda g: g.press(text="Disabled"), lambda g: g.swipe(2700, 1600, 2700, 500)):
            with self.subTest(action=action):
                self.run_action(sheet_xml("native"), action, denied=True)

    def test_ambiguous_or_unknown_sheet_structure_is_denied(self):
        for change in ("duplicate", "extra-card"):
            with self.subTest(change=change):
                tree = ET.fromstring(sheet_xml())
                overlay = tree[0][-1]
                if change == "duplicate":
                    tree[0].append(ET.fromstring(ET.tostring(overlay)))
                else:
                    ET.SubElement(overlay, "node", {"package": ACCEPTANCE, "bounds": "[10,10][20,20]"})
                self.run_action(ET.tostring(tree), lambda g: g.press(desc="Add"), denied=True)

    def test_web_page_close_label_is_not_mistaken_for_app_sheet(self):
        tree = ET.fromstring(sheet_xml("normal"))
        web = next(n for n in tree.iter("node") if n.get("class") == "android.webkit.WebView")
        ET.SubElement(web, "node", {"package": ACCEPTANCE, "class": "android.widget.Button",
            "content-desc": "Close", "clickable": "true", "enabled": "true", "bounds": "[0,0][3200,2000]"})
        self.run_action(ET.tostring(tree), lambda g: g.press(desc="Add"))

    def test_allowed_sheet_button_still_checks_foreground_immediately_before_input(self):
        adb = FakeAdb(xml=sheet_xml(), foreground=[activities(), activities(), activities(NORMAL)])
        with self.assertRaises(GuardError):
            BrowserDeviceGuard(adb, self.out).press(desc="Address")
        self.assertEqual(adb.inputs, [])

    def test_raw_fullscreen_region_and_other_key_are_not_implicit_sheet_dismissals(self):
        for action in (lambda g: self.raw_region(g, (0, 0, 3200, 2000)), lambda g: g.keyevent(66)):
            with self.subTest(action=action):
                self.run_action(sheet_xml(), action, denied=True)


    def quick_open_xml(self):
        tree = ET.fromstring(sheet_xml())
        card = tree[0][-1][1]
        card.set("bounds", "[900,869][2300,1132]")
        field = next(n for n in card.iter("node") if n.get("class") == "android.widget.EditText")
        field.set("content-desc", "Quick Open query")
        field.set("bounds", "[950,900][2250,1080]")
        return ET.tostring(tree)

    def test_explicit_escape_is_allowed_for_quick_open(self):
        adb = self.run_action(self.quick_open_xml(), lambda g: g.keyevent(111))
        self.assertEqual(adb.inputs, [("shell", "input", "keyevent", "111")])

    def test_explicit_back_is_allowed_for_quick_open(self):
        adb = self.run_action(self.quick_open_xml(), lambda g: g.keyevent(4))
        self.assertEqual(adb.inputs, [("shell", "input", "keyevent", "4")])

    def test_dismiss_keys_work_on_other_recognized_sheets(self):
        for kind in ("address", "permission", "settings"):
            for key in (4, 111):
                with self.subTest(kind=kind, key=key):
                    self.run_action(sheet_xml(kind), lambda g: g.keyevent(key))

    def test_other_keys_remain_denied_on_sheet(self):
        for key in (3, 19, 61, 66, 48, 47, 0):
            with self.subTest(key=key):
                self.run_action(self.quick_open_xml(), lambda g: g.keyevent(key), denied=True)

    def test_invalid_key_does_not_authorize_later_raw_input(self):
        for key in (True, "111", -1, None):
            with self.subTest(key=key):
                adb = FakeAdb(xml=self.quick_open_xml())
                guard = BrowserDeviceGuard(adb, self.out)
                with self.assertRaises(GuardError):
                    guard.keyevent(key)
                with self.assertRaises(GuardError):
                    self.raw_region(guard, (0, 0, 3200, 2000))
                self.assertEqual(adb.inputs, [])

    def test_raw_whole_window_remains_denied_after_dismiss_key(self):
        adb = FakeAdb(xml=self.quick_open_xml())
        guard = BrowserDeviceGuard(adb, self.out)
        try:
            guard.keyevent(111)
        except GuardError as error:
            self.fail(f"explicit Escape was denied: {error}")
        adb.inputs.clear()
        with self.assertRaises(GuardError):
            self.raw_region(guard, (0, 0, 3200, 2000))
        self.assertEqual(adb.inputs, [])

    def test_foreign_overlay_blocks_sheet_dismiss_keys(self):
        tree = ET.fromstring(self.quick_open_xml())
        ET.SubElement(tree, "node", {"package": "example.foreign", "bounds": "[1400,850][1800,1150]"})
        for key in (4, 111):
            with self.subTest(key=key):
                self.run_action(ET.tostring(tree), lambda g: g.keyevent(key), denied=True)

    def test_foreign_foreground_blocks_sheet_dismiss_key(self):
        adb = FakeAdb(xml=self.quick_open_xml(), foreground=[activities(NORMAL)])
        with self.assertRaises(GuardError):
            BrowserDeviceGuard(adb, self.out).keyevent(111)
        self.assertEqual(adb.inputs, [])

    def test_foreground_change_at_key_send_blocks_input(self):
        adb = FakeAdb(xml=self.quick_open_xml(), foreground=[activities(), activities(), activities(NORMAL)])
        with self.assertRaises(GuardError):
            BrowserDeviceGuard(adb, self.out).keyevent(111)
        self.assertEqual(adb.inputs, [])

    def test_unknown_fullscreen_card_blocks_dismiss_key(self):
        tree = ET.fromstring(self.quick_open_xml())
        tree[0][-1][1].set("bounds", "[0,0][3200,2000]")
        self.run_action(ET.tostring(tree), lambda g: g.keyevent(111), denied=True)

    def test_duplicate_sheets_block_dismiss_key(self):
        tree = ET.fromstring(self.quick_open_xml())
        tree[0].append(ET.fromstring(ET.tostring(tree[0][-1])))
        self.run_action(ET.tostring(tree), lambda g: g.keyevent(4), denied=True)

    def test_normal_page_non_dismiss_key_policy_is_unchanged(self):
        self.run_action(sheet_xml("normal"), lambda g: g.keyevent(66))

    def test_native_dialog_key_policy_is_unchanged(self):
        self.run_action(sheet_xml("native"), lambda g: g.keyevent(4))

    def close_point(self, xml):
        adb = self.run_action(xml, lambda g: g.press(desc="Close"))
        command = adb.inputs[0]
        self.assertEqual(command[:3], ("shell", "input", "swipe"))
        self.assertEqual(command[3:5], command[5:7])
        return int(command[3]), int(command[4])

    def assert_scrim_point(self, point, card):
        x, y = point
        self.assertTrue(0 < x < 3199 and 0 < y < 1999, point)
        left, top, right, bottom = card
        self.assertFalse(left <= x < right and top <= y < bottom,
                         "Close must be delivered outside the card, not merely authorized")

    def test_semantic_close_avoids_centered_quick_open_card(self):
        self.assert_scrim_point(self.close_point(self.quick_open_xml()), (900, 869, 2300, 1132))

    def test_semantic_close_is_derived_from_each_fresh_asymmetric_card(self):
        points = []
        for bounds in ((20, 20, 3000, 1800), (200, 200, 3180, 1980)):
            with self.subTest(bounds=bounds):
                tree = ET.fromstring(self.quick_open_xml())
                left, top, right, bottom = bounds
                tree[0][-1][1].set("bounds", f"[{left},{top}][{right},{bottom}]")
                point = self.close_point(ET.tostring(tree))
                points.append(point)
                self.assert_scrim_point(point, bounds)
        self.assertNotEqual(points[0], points[1], "one fixed coordinate is not a fresh scrim target")

    def test_semantic_close_denies_card_covering_entire_scrim(self):
        tree = ET.fromstring(self.quick_open_xml())
        tree[0][-1][1].set("bounds", "[-10,-10][3210,2010]")
        self.run_action(ET.tostring(tree), lambda g: g.press(desc="Close"), denied=True)

    def test_semantic_close_denies_scrim_without_an_interior_pixel(self):
        tree = ET.fromstring(self.quick_open_xml())
        tree[0][-1][1].set("bounds", "[1,0][3200,2000]")
        self.run_action(ET.tostring(tree), lambda g: g.press(desc="Close"), denied=True)

    def test_semantic_close_keeps_foreign_overlay_rejection(self):
        tree = ET.fromstring(self.quick_open_xml())
        ET.SubElement(tree, "node", {"package": "example.foreign", "bounds": "[0,0][300,300]"})
        self.run_action(ET.tostring(tree), lambda g: g.press(desc="Close"), denied=True)

    def test_semantic_close_keeps_ancestor_clip_rejection(self):
        tree = ET.fromstring(self.quick_open_xml())
        tree[0][-1].set("bounds", "[10,10][3190,1990]")
        self.run_action(ET.tostring(tree), lambda g: g.press(desc="Close"), denied=True)

    def test_semantic_close_rechecks_foreground_before_delivery(self):
        adb = FakeAdb(xml=self.quick_open_xml(), foreground=[activities(), activities(), activities(NORMAL)])
        with self.assertRaises(GuardError):
            BrowserDeviceGuard(adb, self.out).press(desc="Close")
        self.assertEqual(adb.inputs, [])

    def test_non_backdrop_close_keeps_its_own_button_center(self):
        tree = ET.fromstring(sheet_xml("native"))
        cancel = next(n for n in tree.iter("node") if n.get("text") == "Cancel")
        cancel.set("content-desc", "Close")
        self.assertEqual(self.close_point(ET.tostring(tree)), (2150, 1275))

    def test_semantic_close_does_not_authorize_later_raw_scrim_input(self):
        xml = self.quick_open_xml()
        x, y = self.close_point(xml)
        self.run_action(xml, lambda g: self.raw_region(g, (x, y, x+1, y+1)), denied=True)


if __name__ == "__main__":
    unittest.main()
