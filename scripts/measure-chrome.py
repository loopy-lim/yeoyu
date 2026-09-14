#!/usr/bin/env python3
"""Measure an even number of sidebar transitions, preserving the starting state.

This measures Android HWUI chrome frame statistics, not website FPS or input-to-photon latency.
Run the same page, sidebar width, display mode and cycle count before/after.
"""
import argparse
import datetime
import json
import pathlib
import re
import subprocess
import time

parser = argparse.ArgumentParser()
parser.add_argument("--serial", required=True)
parser.add_argument("--out", required=True)
parser.add_argument("--cycles", type=int, default=20)
args = parser.parse_args()
if args.cycles < 2 or args.cycles % 2:
    parser.error("cycles must be a positive even number")
out = pathlib.Path(args.out)
out.mkdir(parents=True, exist_ok=True)


def adb(*command):
    return subprocess.run(["adb", "-s", args.serial, *command], check=True, capture_output=True).stdout


before = adb("exec-out", "screencap", "-p")
(out / "before.png").write_bytes(before)
adb("shell", "dumpsys", "gfxinfo", "com.workspacebrowser", "reset")
started = time.monotonic()
completed = 0
try:
    for _ in range(args.cycles):
        adb("shell", "input", "keycombination", "-t", "60", "113", "47")
        completed += 1
        time.sleep(0.4)
        if completed == 1:
            (out / "first-transition.png").write_bytes(adb("exec-out", "screencap", "-p"))
finally:
    if completed % 2:
        adb("shell", "input", "keycombination", "-t", "60", "113", "47")
elapsed = time.monotonic() - started
gfx = adb("shell", "dumpsys", "gfxinfo", "com.workspacebrowser", "framestats").decode()
memory = adb("shell", "dumpsys", "meminfo", "com.workspacebrowser").decode()
(out / "gfxinfo.txt").write_text(gfx)
(out / "memory.txt").write_text(memory)
(out / "after.png").write_bytes(adb("exec-out", "screencap", "-p"))
metrics = {}
for label in ["Total frames rendered", "Janky frames", "50th percentile", "90th percentile", "95th percentile", "99th percentile"]:
    match = re.search(r"^" + re.escape(label) + r": (.+)$", gfx, re.M)
    metrics[label] = match.group(1) if match else None
receipt = {
    "capturedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "serial": args.serial,
    "cycles": completed,
    "elapsedSeconds": round(elapsed, 3),
    "metrics": metrics,
    "valid": metrics.get("Total frames rendered") not in (None, "0"),
    "boundary": "Android HWUI chrome only; screenshots must confirm transitions and equal start/end state. Memory is main app process, excludes Gecko children.",
}
(out / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
print(json.dumps(receipt, indent=2))
if not receipt["valid"]:
    raise SystemExit("Invalid measurement: no rendered chrome frames; restore the app and repeat.")
