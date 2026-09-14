#!/usr/bin/env python3
"""Check the app's pane style against the installed Yoga/Fabric cache behavior.

Run separately from the fast Bun suite: requires Bun and a C++20 compiler.
This exercises Yoga layout; physical verification still covers Android mounting.
"""

import json
import os
from pathlib import Path
import subprocess
import tempfile


def main():
    repo = Path(__file__).resolve().parent.parent
    # Load the actual style builder in an isolated process. Only StyleSheet's
    # registration is stubbed; pane properties come from the app, not this probe.
    read_style = """
import { mock } from "bun:test";
mock.module("react-native", () => ({
  StyleSheet: { create: (styles) => styles, hairlineWidth: 1 },
}));
const { useStyles } = await import("./src/chrome/appStyles");
const { themes } = await import("./src/theme");
console.log(JSON.stringify(useStyles(Object.values(themes)[0]).pane));
"""
    pane = json.loads(subprocess.check_output(
        ["bun", "-e", read_style], cwd=repo, text=True
    ))
    basis = pane.get("flexBasis", "auto")
    if not isinstance(basis, (int, float)) and basis != "auto":
        raise ValueError(f"Unsupported pane flexBasis for this probe: {basis!r}")
    yoga = repo / "node_modules/react-native/ReactCommon/yoga"
    fixture = repo / "tests/fixtures/split-geometry.cpp"
    sources = sorted((yoga / "yoga").rglob("*.cpp"))
    if not sources:
        raise RuntimeError("Install project dependencies before running this check")
    with tempfile.TemporaryDirectory(prefix="yeoyu-split-geometry-") as temporary:
        binary = Path(temporary) / "split-geometry"
        subprocess.run([
            os.environ.get("CXX", "c++"), "-std=c++20", "-O0",
            f"-I{yoga}", str(fixture), *map(str, sources), "-o", str(binary),
        ], check=True, cwd=repo)
        print(f"Actual app pane flexBasis: {basis}", flush=True)
        result = subprocess.run([str(binary), str(basis)], cwd=repo)
    raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
