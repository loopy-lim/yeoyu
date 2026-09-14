"""Fail-closed input boundary for the test-only Acceptance workload.

ADB is injected so this module can be tested without a device. No operation
launches an app or repairs focus: a changed/unknown input target aborts the run.
"""
from dataclasses import dataclass
import json
from pathlib import Path
import re
import subprocess
import uuid
from xml.etree import ElementTree as ET


EXPECTED_PACKAGE = "com.workspacebrowser.acceptance"


class GuardError(RuntimeError):
    """The current device state does not authorize a workload input."""


def _component(value):
    package, activity = value.split("/", 1)
    return f"{package}/{package + activity if activity.startswith('.') else activity}"


def _activity(value):
    found = re.fullmatch(
        r"ActivityRecord\{([\da-f]+) u(\d+) ([\w.]+/[\w.$]+) t(\d+)(?:, [^}]*)?\}", value)
    if not found:
        raise GuardError(f"unknown foreground activity: {value}")
    record, user, component, task = found.groups()
    return record, user, _component(component), task


@dataclass(frozen=True)
class Foreground:
    activity: tuple
    window: str
    width: int
    height: int
    rotation: int


def parse_foreground(raw):
    """Accept only an unambiguous resumed Acceptance activity on display 0.

    Package names in paused task history do not establish foreground ownership.
    The focused window is also checked because overlays can receive input while
    the underlying app is still RESUMED. Geometry uses the rotated display size.
    """
    text = raw.decode("utf-8", errors="strict") if isinstance(raw, bytes) else raw
    displays = re.findall(r"(?m)^Display #(\d+) \(activities from top to bottom\):", text)
    display_states = re.findall(r"(?m)^\s*Display: mDisplayId=(\d+)\b", text)
    if displays != ["0"] or display_states != ["0"]:
        raise GuardError("unknown or multiple foreground displays")
    resumed = re.findall(
        r"(?m)^\s*(?:topResumedActivity|mResumedActivity|ResumedActivity|Resumed)\s*[:=]\s*(.+)$", text)
    if not resumed:
        raise GuardError("missing resumed foreground activity")
    identities = {_activity(value) for value in resumed}
    if len(identities) != 1:
        raise GuardError("conflicting resumed foreground activities")
    identity = next(iter(identities))
    if identity[2].split("/", 1)[0] != EXPECTED_PACKAGE:
        raise GuardError(f"foreground is not the test-only {EXPECTED_PACKAGE}")
    focused_apps = re.findall(r"(?m)^\s*mFocusedApp=(.+)$", text)
    if len(focused_apps) != 1 or _activity(focused_apps[0]) != identity:
        raise GuardError("focused app does not match the resumed Acceptance activity")
    windows = re.findall(r"(?m)^\s*mCurrentFocus=(.+)$", text)
    if len(windows) != 1:
        raise GuardError("missing or ambiguous focused input window")
    windows += re.findall(r"(?m)^\s*mFocusedWindow=(.+)$", text)
    window_ids = set()
    for window in windows:
        found = re.fullmatch(r"Window\{([\da-f]+) u(\d+) ([\w.]+/[\w.$]+)\}", window)
        if not found or found[2] != identity[1] or _component(found[3]) != identity[2]:
            raise GuardError("focused input window is unknown or belongs to another app")
        window_ids.add(found[1])
    if len(window_ids) != 1:
        raise GuardError("focused input window is changing")
    sizes = re.findall(r"\bcur=(\d+)x(\d+)\b", text)
    frames = re.findall(r"\bDisplayFrames w=(\d+) h=(\d+) r=(\d+)\b", text)
    if len(sizes) != 1 or len(frames) != 1 or sizes[0] != frames[0][:2]:
        raise GuardError("unknown or changing display bounds")
    width, height, rotation = map(int, frames[0])
    if width <= 0 or height <= 0 or rotation not in range(4):
        raise GuardError("invalid display bounds")
    for name, expected in (("mAwake", "true"), ("mScreenOnFully", "true"),
                           ("isKeyguardShowing", "false")):
        if re.findall(rf"\b{name}=(\w+)\b", text) != [expected]:
            raise GuardError("screen is locked, not awake, or has unknown visibility")
    return Foreground(identity, next(iter(window_ids)), width, height, rotation)


def matches(tree, text=None, desc=None):
    return [node.attrib for node in tree.iter("node")
            if node.get("package") == EXPECTED_PACKAGE
            and (text is None or node.get("text") == text)
            and (desc is None or node.get("content-desc") == desc)
            and node.get("enabled") == "true"]


def web_view(tree):
    found = [node.attrib for node in tree.iter("node")
             if node.get("package") == EXPECTED_PACKAGE
             and node.get("class") == "android.webkit.WebView"]
    if len(found) != 1:
        raise GuardError("expected exactly one Acceptance fixture WebView")
    return found[0]


def _bounds(node):
    found = re.fullmatch(r"\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]", node.get("bounds", ""))
    if not found:
        raise GuardError("missing or malformed UI bounds")
    left, top, right, bottom = map(int, found.groups())
    if left >= right or top >= bottom:
        raise GuardError("empty or reversed UI bounds")
    return left, top, right, bottom


def _contains(outer, inner):
    return outer[0] <= inner[0] and outer[1] <= inner[1] and outer[2] >= inner[2] and outer[3] >= inner[3]


def _intersects(first, second):
    return first[0] < second[2] and second[0] < first[2] and first[1] < second[3] and second[1] < first[3]


def _scrim_point(backdrop, card):
    """Choose an interior pixel from fresh backdrop bounds outside the card."""
    left, top, right, bottom = backdrop
    bands = [
        (left, top, right, min(bottom, card[1])),
        (left, max(top, card[3]), right, bottom),
        (left, top, min(right, card[0]), bottom),
        (max(left, card[2]), top, right, bottom),
    ]
    # Leave a pixel on every boundary; a one-pixel edge is not a safe target.
    candidates = [band for band in bands if band[2]-band[0] >= 3 and band[3]-band[1] >= 3]
    for band in sorted(candidates, key=lambda b: (b[2]-b[0])*(b[3]-b[1]), reverse=True):
        x, y = (band[0]+band[2])//2, (band[1]+band[3])//2
        pixel = (x, y, x+1, y+1)
        if _contains(backdrop, pixel) and not _intersects(card, pixel):
            return x, y
    raise GuardError("no unobscured interior point in the Close scrim")


@dataclass
class _Snapshot:
    raw: bytes
    tree: ET.Element
    foreground: Foreground
    evidence: Path


class BrowserDeviceGuard:
    def __init__(self, adb, out):
        self._adb = adb
        self._out = Path(out) / "input-guard"
        self._out.mkdir(parents=True, exist_ok=True)

    def _deny(self, evidence, error):
        message = str(error)
        (evidence / "denied.json").write_text(json.dumps({
            "expectedPackage": EXPECTED_PACKAGE, "reason": message,
        }, indent=2) + "\n")
        raise GuardError(f"{message}; evidence: {evidence}") from error

    def _read(self, evidence, name, *command):
        (evidence / f"{name}.command.json").write_text(json.dumps(command) + "\n")
        try:
            raw = self._adb(*command)
        except (subprocess.SubprocessError, OSError) as error:
            output = getattr(error, "output", None) or b""
            (evidence / name).write_bytes(output if isinstance(output, bytes) else output.encode())
            self._deny(evidence, error)
        (evidence / name).write_bytes(raw)
        return raw

    def _foreground(self, evidence, name):
        return parse_foreground(self._read(evidence, name, "shell", "dumpsys", "activity", "activities"))

    def _capture(self):
        token = uuid.uuid4().hex
        evidence = self._out / token
        evidence.mkdir()
        try:
            before = self._foreground(evidence, "foreground-before.txt")
            for attempt in (1, 2):
                # Retry only Android's explicit idle timeout, without input.
                # Each read uses a fresh path and retains its own output.
                suffix = "" if attempt == 1 else "-retry"
                remote = f"/sdcard/yeoyu-soak-{token}{suffix}.xml"
                output = self._read(evidence, f"dump{suffix}.txt", "shell", "uiautomator", "dump", remote)
                if attempt == 1 and output.strip() == b"ERROR: could not get idle state.":
                    if self._foreground(evidence, "foreground-after-idle.txt") != before:
                        raise GuardError("foreground activity or display changed during idle timeout")
                    continue
                success = re.findall(rb"(?m)^UI hier(?:chary|archy) dumped to: (\S+)\s*$", output)
                if success != [remote.encode()]:
                    raise GuardError("fresh UI dump did not report success for this attempt")
                break
            raw = self._read(evidence, "ui.xml", "exec-out", "cat", remote)
            tree = ET.fromstring(raw)
            if tree.tag != "hierarchy" or tree.get("rotation") != str(before.rotation):
                raise GuardError("UI hierarchy is missing or display rotation changed")
            after = self._foreground(evidence, "foreground-after.txt")
            if before != after:
                raise GuardError("foreground activity or display changed during UI capture")
            return _Snapshot(raw, tree, after, evidence)
        except (GuardError, ET.ParseError, UnicodeError) as error:
            self._deny(evidence, error)

    def dump(self):
        snapshot = self._capture()
        return snapshot.raw, snapshot.tree

    def _validate_region(self, snapshot, region, *, target=None, scroll=False, explicit_dismiss=False, key=None):
        foreground = snapshot.foreground
        if not _contains((0, 0, foreground.width, foreground.height), region):
            raise GuardError("input target lies outside current display bounds")
        roots = [node for node in snapshot.tree if node.tag == "node"
                 and node.get("package") == EXPECTED_PACKAGE]
        if len(roots) != 1 or not _contains(_bounds(roots[0]), region):
            raise GuardError("input target is outside the Acceptance window")
        for node in snapshot.tree.iter("node"):
            if node.get("package") != EXPECTED_PACKAGE:
                if _intersects(_bounds(node), region):
                    raise GuardError("foreign or unknown UI overlay intersects input target")

        # React sheets expose background AX nodes in the same package/window.
        # Only their card descendants (or an explicitly selected Close) own input.
        parents = {child: parent for parent in snapshot.tree.iter() for child in parent}
        display = (0, 0, foreground.width, foreground.height)

        def inside_web(node):
            while node in parents:
                node = parents[node]
                if node.get("class") == "android.webkit.WebView":
                    return True
            return False

        backdrops = [node for node in snapshot.tree.iter("node")
                     if node.get("package") == EXPECTED_PACKAGE
                     and node.get("class") == "android.widget.Button"
                     and node.get("content-desc") == "Close"
                     and node.get("clickable") == "true"
                     and not inside_web(node) and _bounds(node) == display]
        if not backdrops:
            # Native dialogs have their own window root, checked above.
            return
        if len(backdrops) != 1:
            raise GuardError("multiple in-app sheets: cannot identify the active overlay")
        backdrop = backdrops[0]
        cards = [child for child in parents[backdrop] if child is not backdrop]
        if len(cards) != 1 or _bounds(cards[0]) == display:
            raise GuardError("unknown in-app sheet structure")
        card = cards[0]
        allowed = set(card.iter("node"))
        if key is not None:
            if key in (4, 111):
                return  # Explicit Back/Escape after window, foreign UI and sheet checks.
            raise GuardError("key is not a dismiss action for the active overlay")
        if target is backdrop and explicit_dismiss:
            # A full-display Close's geometric center can be inside the card.
            return _scrim_point(_bounds(backdrop), _bounds(card))
        if not _contains(_bounds(card), region):
            raise GuardError("input target is outside the active overlay card")
        if target is not None:
            if target not in allowed:
                raise GuardError("input target is behind an in-app overlay")
            return
        if scroll:
            if any(node.get("scrollable") == "true" and _contains(_bounds(node), region)
                   for node in allowed):
                return
            raise GuardError("swipe is outside the active overlay scroll area")

        # Direct press_widget callers validate exact node bounds. A raw scroll
        # corridor is not a widget; use swipe() for a sheet's own scroll area.
        exact = []
        for node in snapshot.tree.iter("node"):
            if node.get("enabled") != "true":
                continue
            try:
                if _bounds(node) == region:
                    exact.append(node)
            except GuardError:
                continue  # AX can include inverted bounds on offscreen siblings.
        if exact and all(node in allowed for node in exact):
            return
        raise GuardError("raw input region is not an active overlay widget")

    def _send(self, snapshot, *command):
        current = self._foreground(snapshot.evidence, "foreground-before-input.txt")
        if current != snapshot.foreground:
            raise GuardError("foreground activity or display changed immediately before input")
        self._read(snapshot.evidence, "input.txt", "shell", "input", *command)

    def press(self, text=None, desc=None, expected_title=None):
        snapshot = self._capture()
        try:
            if text is None and desc is None:
                raise GuardError("a specific input target is required")
            if expected_title is not None and web_view(snapshot.tree).get("text") != expected_title:
                raise GuardError("fixture document changed before input")
            found = matches(snapshot.tree, text, desc)
            if len(found) != 1:
                raise GuardError("input target is absent, disabled, or ambiguous in Acceptance")
            bounds = _bounds(found[0])
            target = next(node for node in snapshot.tree.iter("node") if node.attrib is found[0])
            point = self._validate_region(snapshot, bounds, target=target, explicit_dismiss=desc == "Close")
            parents = {child: parent for parent in snapshot.tree.iter() for child in parent}
            ancestor = parents.get(target)
            while ancestor is not None and ancestor.tag == "node":
                if not _contains(_bounds(ancestor), bounds):
                    raise GuardError("input target is clipped by its parent UI bounds")
                ancestor = parents.get(ancestor)
            x, y = point if point is not None else ((bounds[0] + bounds[2]) // 2, (bounds[1] + bounds[3]) // 2)
            self._send(snapshot, "swipe", x, y, x, y, 180)
        except GuardError as error:
            self._deny(snapshot.evidence, error)

    def swipe(self, x1, y1, x2, y2, duration=180):
        snapshot = self._capture()
        try:
            if any(type(value) is not int for value in (x1, y1, x2, y2, duration)) or duration <= 0:
                raise GuardError("swipe coordinates and duration must be positive-size integers")
            self._validate_region(snapshot,
                                  (min(x1, x2), min(y1, y2), max(x1, x2) + 1, max(y1, y2) + 1),
                                  scroll=True)
            self._send(snapshot, "swipe", x1, y1, x2, y2, duration)
        except GuardError as error:
            self._deny(snapshot.evidence, error)

    def keyevent(self, key):
        snapshot = self._capture()
        try:
            if type(key) is not int or key < 0:
                raise GuardError("keyevent requires a numeric Android key code")
            roots = [node for node in snapshot.tree if node.tag == "node"
                     and node.get("package") == EXPECTED_PACKAGE]
            if len(roots) != 1:
                raise GuardError("missing or ambiguous Acceptance window for key input")
            self._validate_region(snapshot, _bounds(roots[0]), key=key)
            self._send(snapshot, "keyevent", key)
        except GuardError as error:
            self._deny(snapshot.evidence, error)
