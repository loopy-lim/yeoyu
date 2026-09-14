#!/usr/bin/env python3
"""Read-only app/Gecko-process sampling. Prepare tabs and the workload separately."""
import argparse
import datetime
import json
from pathlib import Path
import re
import subprocess
import time


def total_pss_kb(memory):
    match = re.search(r"TOTAL PSS:\s*(\d+)", memory)
    if not match:
        match = re.search(r"^\s*TOTAL\s+(\d+)\s", memory, re.M)
    return int(match.group(1)) if match else None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serial", required=True)
    parser.add_argument("--package", default="com.workspacebrowser.acceptance")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--duration-seconds", type=int, default=1800)
    parser.add_argument("--interval-seconds", type=int, default=60)
    parser.add_argument("--tabs", type=int, required=True)
    args = parser.parse_args()
    if args.duration_seconds < 1 or args.interval_seconds < 1 or args.tabs < 1:
        parser.error("duration, interval and prepared tab count must be positive")
    args.out.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    rows = []

    def adb(*command):
        result = subprocess.run(["adb", "-s", args.serial, *command], check=True, capture_output=True, text=True, timeout=30)
        return result.stdout

    def sample_processes(attempt):
        processes = []
        for line in adb("shell", "ps", "-A", "-o", "PID,NAME").splitlines()[1:]:
            parts = line.strip().split(None, 1)
            if len(parts) != 2 or not parts[0].isdigit():
                continue
            pid, name = parts
            if name != args.package and not name.startswith(args.package + ":"):
                continue
            memory = adb("shell", "dumpsys", "meminfo", pid)
            suffix = "" if attempt == 1 else f"-attempt-{attempt}"
            (args.out / f"sample-{len(rows):03d}{suffix}-pid-{pid}.txt").write_text(memory)
            processes.append({"pid": int(pid), "name": name, "pssKb": total_pss_kb(memory)})
        return processes

    try:
        while True:
            elapsed = time.monotonic() - started
            processes = sample_processes(1)
            attempts = [{"processes": processes}]
            initial_main = [item["pid"] for item in processes if item["name"] == args.package]
            # A Gecko child can exit after ps but before meminfo. Re-enumerate
            # once, preserving the failed read; never replace it with zero PSS.
            if initial_main and any(item["pssKb"] is None for item in processes):
                processes = sample_processes(2)
                attempts.append({"processes": processes})
            same_main = initial_main == [item["pid"] for item in processes if item["name"] == args.package]
            row = {
                "at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "elapsedSeconds": round(time.monotonic() - started, 3),
                "processes": processes,
                "attempts": attempts,
                "sameMainInstanceDuringSample": same_main,
                "mainPresent": any(item["name"] == args.package for item in processes),
                "totalPssKb": sum(item["pssKb"] or 0 for item in processes),
                "completePss": bool(processes) and same_main and all(item["pssKb"] is not None for item in processes),
            }
            rows.append(row)
            with (args.out / "samples.jsonl").open("a") as file:
                file.write(json.dumps(row) + "\n")
            print(json.dumps(row), flush=True)
            if elapsed >= args.duration_seconds:
                break
            time.sleep(min(args.interval_seconds, max(0, args.duration_seconds - (time.monotonic() - started))))
    finally:
        receipt = {
            "package": args.package, "serial": args.serial, "preparedTabs": args.tabs,
            "requestedSeconds": args.duration_seconds,
            "elapsedSeconds": round(time.monotonic() - started, 3), "samples": len(rows),
            "durationCompleted": bool(rows) and rows[-1]["elapsedSeconds"] >= args.duration_seconds,
            "allSamplesComplete": bool(rows) and all(row["mainPresent"] and row["completePss"] for row in rows),
            "boundary": "PSS sum of the app and processes sharing its package name prefix. Screens and server receipts must establish the prepared tab count and actual workload. This sampler neither opens tabs nor proves leak freedom or battery cost.",
        }
        (args.out / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")


if __name__ == "__main__":
    main()
