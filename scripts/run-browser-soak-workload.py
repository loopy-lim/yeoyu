#!/usr/bin/env python3
"""Exercise the local lifecycle fixture; preserve bounded input retries as evidence."""
import argparse
import datetime
import json
from pathlib import Path
import subprocess
import time
from urllib.parse import parse_qs, urlsplit

from browser_device_guard import BrowserDeviceGuard, EXPECTED_PACKAGE, matches, web_view


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serial", required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--receipts", type=Path, required=True)
    parser.add_argument("--run", required=True, help="Unique run ID already opened in the lifecycle fixture")
    parser.add_argument("--fixture-url", default="http://127.0.0.1:8877/browser-lifecycle.html")
    parser.add_argument("--cycles", type=int, default=30)
    parser.add_argument("--interval-seconds", type=int, default=60)
    args = parser.parse_args()
    if args.cycles < 1 or args.interval_seconds < 1:
        parser.error("cycles and interval must be positive")
    if not args.run.strip():
        parser.error("run must be a nonempty unique ID")
    fixture_url = urlsplit(args.fixture_url)
    if fixture_url.scheme not in ("http", "https") or not fixture_url.netloc or fixture_url.query or fixture_url.fragment:
        parser.error("fixture-url must be the full fixture URL without its query or fragment")
    args.out.mkdir(parents=True, exist_ok=True)
    if (args.out / "workload.jsonl").exists():
        parser.error("output already contains a workload; use a fresh directory")
    start = time.monotonic()
    rows, attempts = [], []
    failure = None
    awaiting_receipt = False
    input_receipt_start = None

    def adb(*values):
        nonlocal input_receipt_start
        # The guard performs fresh UI captures before sending input. Take the
        # receipt boundary here, after those captures, not before guard.press().
        if awaiting_receipt and values[:2] == ("shell", "input"):
            input_receipt_start = len(receipts())
        return subprocess.check_output(["adb", "-s", args.serial, *map(str, values)],
                                       timeout=30, stderr=subprocess.STDOUT)

    guard = BrowserDeviceGuard(adb, args.out)
    dump = guard.dump

    def receipts():
        return [json.loads(line) for line in args.receipts.read_text().splitlines()]

    def same_page(value, page):
        if not isinstance(value, dict) or value.get("run") != args.run or value.get("page") != page:
            return False
        href = value.get("href")
        if not isinstance(href, str):
            return False
        try:
            url = urlsplit(href)
            return ((url.scheme, url.netloc, url.path) == (fixture_url.scheme, fixture_url.netloc, fixture_url.path)
                    and not url.fragment and parse_qs(url.query, keep_blank_values=True) == {"page": [page], "run": [args.run]})
        except ValueError:
            return False

    def fixture_state(tree, expected=None):
        view = web_view(tree)
        web = next(node for node in tree.iter("node") if node.attrib is view)
        containers = [node for node in web.iter("node") if node.get("resource-id") == "state"]
        assert len(containers) == 1, "missing or ambiguous lifecycle state"
        values = [json.loads(node.get("text")) for node in containers[0].iter("node") if node.get("text")]
        assert len(values) == 1, "missing or ambiguous lifecycle state value"
        value = values[0]
        page = value.get("page") if isinstance(value, dict) else None
        assert page in ("a", "b", "c") and same_page(value, page), "fixture run, page or URL changed"
        assert view["text"] == f"Lifecycle {page.upper()}", "fixture title and page disagree"
        if expected is not None:
            assert value.get("created") == expected.get("created") and page == expected.get("page"), "fixture document changed"
        return value

    def record_attempt(action, attempt, passed):
        row = {"cycle": len(rows) + 1, "action": action, "attempt": attempt,
               "passed": passed, "elapsedSeconds": round(time.monotonic() - start, 3)}
        attempts.append(row)
        with (args.out / "input-attempts.jsonl").open("a") as output:
            output.write(json.dumps(row) + "\n")

    def page_action(kind, text=None, desc=None, predicate=lambda row: True, expected=None):
        nonlocal awaiting_receipt, input_receipt_start
        for attempt in (1, 2):
            _, tree = dump()
            title = web_view(tree)["text"]
            current = fixture_state(tree, expected)
            page = {"a": "b", "b": "c", "c": "a"}[current["page"]] if kind == "lifecycle-loaded" else current["page"]
            input_receipt_start = None
            awaiting_receipt = True
            try:
                guard.press(text, desc, expected_title=title)
            finally:
                awaiting_receipt = False
            assert input_receipt_start is not None, "missing fresh input boundary"
            before = input_receipt_start
            deadline = time.monotonic() + 5
            while True:
                received = receipts()
                assert len(received) >= before, "fixture receipt log was truncated"
                found = [row for row in received[before:]
                         if row.get("kind") == kind and same_page(row.get("value"), page)
                         and (row["value"].get("created") != current.get("created") if kind == "lifecycle-loaded"
                              else row["value"].get("created") == current.get("created")) and predicate(row)]
                if found or time.monotonic() >= deadline:
                    break
                time.sleep(0.1)
            record_attempt(kind, attempt, bool(found))
            if found:
                return found[-1]
            raw, tree = dump()
            (args.out / f"cycle-{len(rows)+1:02d}-{kind}-attempt-{attempt}.xml").write_bytes(raw)
            # A changed document without its receipt is ambiguous. Do not click
            # Next again and silently skip a navigation to obtain a passing run.
            assert web_view(tree)["text"] == title, "document changed without expected receipt"
        raise AssertionError(f"{kind} failed after two recorded input attempts")

    def sidebar(action, expected):
        for attempt in (1, 2):
            _, tree = dump()
            assert len(matches(tree, desc=action)) == 1, (action, "unexpected initial state")
            guard.press(desc=action)
            raw, tree = dump()
            passed = len(matches(tree, desc=expected)) == 1
            record_attempt(action, attempt, passed)
            if passed:
                return
            (args.out / f"cycle-{len(rows)+1:02d}-{action.split()[0]}-attempt-{attempt}.xml").write_bytes(raw)
        raise AssertionError(f"{action} failed after two recorded input attempts")

    try:
        expected_current = None
        for cycle in range(1, args.cycles + 1):
            if cycle > 1:
                time.sleep(max(0, (cycle - 1) * args.interval_seconds - (time.monotonic() - start)))
            began = time.monotonic()
            loaded = page_action("lifecycle-loaded", desc="Next lifecycle page", expected=expected_current)
            page_action("lifecycle-scroll-command", text="Scroll to marker",
                        predicate=lambda row: abs(row["value"]["scrollY"] - 1100) < 3, expected=loaded["value"])
            sidebar("Collapse sidebar", "Expand sidebar")
            sidebar("Expand sidebar", "Collapse sidebar")
            checkpoint = page_action("lifecycle-checkpoint", text="Report page state",
                                     predicate=lambda row: row["value"]["created"] == loaded["value"]["created"]
                                     and abs(row["value"]["scrollY"] - 1100) < 3, expected=loaded["value"])
            raw, tree = dump()
            view = web_view(tree)
            expected_current = fixture_state(tree, checkpoint["value"])
            assert abs(expected_current["scrollY"] - 1100) < 3, "scroll changed after the final checkpoint"
            row = {"cycle": cycle, "at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                   "elapsedSeconds": round(time.monotonic() - start, 3),
                   "interactionSeconds": round(time.monotonic() - began, 3),
                   "checkpoint": checkpoint, "webView": {"title": view["text"], "bounds": view["bounds"]},
                   "passed": True}
            rows.append(row)
            with (args.out / "workload.jsonl").open("a") as output:
                output.write(json.dumps(row) + "\n")
            if cycle in (1, (args.cycles + 1) // 2, args.cycles):
                (args.out / f"cycle-{cycle:02d}.xml").write_bytes(raw)
            print(json.dumps(row), flush=True)
    except BaseException as error:
        failure = f"{type(error).__name__}: {error}"
        raise
    finally:
        receipt = {"completedCycles": len(rows), "requestedCycles": args.cycles,
                   "elapsedSeconds": round(time.monotonic() - start, 3),
                   "allCyclesPassed": len(rows) == args.cycles, "failure": failure,
                   "expectedPackage": EXPECTED_PACKAGE,
                   "run": args.run, "fixtureUrl": args.fixture_url,
                   "inputBoundary": "Fresh UI dump and resumed/focused Acceptance package checks before every input; abort on uncertainty without restoring focus.",
                   "failedInputAttempts": sum(not item["passed"] for item in attempts),
                   "retryPolicy": "At most two attempts per action; retain every failed attempt and UI state.",
                   "actionsPerCycle": ["navigate next lifecycle page", "scroll to1100 CSS px", "collapse sidebar", "expand sidebar", "verify same document and scroll with fresh page report"],
                   "boundary": "One foreground same-origin fixture is navigated, scrolled and resized; pair with tab-preparation and memory receipts. This does not prove100 unrelated production websites."}
        (args.out / "workload-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")


if __name__ == "__main__":
    main()
