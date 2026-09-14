#!/usr/bin/env python3
"""Capture local source/APK identity without reading or changing a device profile."""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def source_inputs():
    paths = subprocess.check_output(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=ROOT).decode().split("\0")
    roots = ("src/", "native/", "generated/", "modules/", "android/", "tests/", "scripts/")
    root_files = {"Cargo.toml", "Cargo.lock", "package.json", "bun.lock", "rustra.json", "index.js", "babel.config.js", "metro.config.js", "tsconfig.json"}
    return {name: sha256(ROOT / name) for name in sorted(set(paths)) if name and (name.startswith(roots) or name in root_files) and (ROOT / name).is_file()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--apk", type=Path)
    parser.add_argument("--aapt", type=Path)
    parser.add_argument("--expected-inputs", type=Path)
    args = parser.parse_args()
    inputs = source_inputs()
    if args.expected_inputs and json.loads(args.expected_inputs.read_text())["sourceInputs"] != inputs:
        parser.error("Source inputs changed during verification; rebuild and capture a new receipt")
    result = {
        "schema": 1, "capturedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "sourceInputs": inputs,
        "sourceDigest": hashlib.sha256(json.dumps(inputs, sort_keys=True).encode()).hexdigest(),
        "engine": re.search(r'geckoview:geckoview:([^"\s]+)', (ROOT / "android/app/build.gradle").read_text()).group(1),
        "deviceAcceptance": {"status": "unexecuted", "cases": ["private cookie/storage isolation and last-tab cleanup", "private download/popup/PiP", "real autofill/passkey provider", "TalkBack and 200% text", "network/screen-off/process-death downloads", "matched frame/PSS/energy workloads", "fresh 30-minute and two-hour reliability"]},
        "boundary": "Source/APK identity only. Builds and host tests cannot prove device/provider/runtime behavior. No normal app/profile writes were performed.",
    }
    if args.apk:
        if not args.aapt:
            parser.error("--aapt is required with --apk")
        badging = subprocess.check_output([str(args.aapt), "dump", "badging", str(args.apk)], text=True)
        package = re.search(r"^package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'", badging, re.M)
        if not package or package[1] != "com.workspacebrowser.acceptance":
            parser.error("Only the isolated Acceptance package may receive this candidate receipt")
        result["apk"] = {"file": args.apk.name, "sha256": sha256(args.apk), "bytes": args.apk.stat().st_size, "applicationId": package[1], "versionCode": package[2], "versionName": package[3]}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"sourceFiles": len(inputs), "sourceDigest": result["sourceDigest"], "apk": result.get("apk")}))


if __name__ == "__main__":
    main()
