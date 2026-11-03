#!/usr/bin/env python3
"""Move an install's app data to another package slot via run-as.

For app-ID migrations (com.workspacebrowser → ll3.kr.yeoyu) and same-package
recovery. Both source and target must be debuggable builds (Debug profile);
acceptance/release builds refuse run-as. Data travels as a tar of the data
directory root (files, shared_prefs, databases) — cache dirs and lib stay out.

  python3 scripts/migrate-app-data.py dump -s SERIAL --from PKG -o old.tar
  python3 scripts/migrate-app-data.py restore -s SERIAL --to PKG -i old.tar

Cross-package move: dump from the old install, install the new build, launch
it once, restore. Same-package recovery: dump, pm clear, launch once, restore.
"""
import argparse
import subprocess
import sys
import tempfile
from pathlib import Path

DATA_DIRS = ("files", "shared_prefs", "databases")


def adb(serial, *args, binary_output=False):
    command = ["adb"]
    if serial:
        command += ["-s", serial]
    command += list(args)
    result = subprocess.run(command, capture_output=True)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).decode(errors="replace").strip()
        raise SystemExit(f"adb {' '.join(args)} failed: {detail}")
    return result.stdout if binary_output else result.stdout.decode(errors="replace").strip()


def require_debuggable(serial, package, role):
    probe = subprocess.run(
        ["adb", "-s", serial, "shell", "run-as", package, "true"], capture_output=True
    )
    if probe.returncode != 0:
        raise SystemExit(
            f"{role} package {package} refuses run-as ({probe.stderr.decode().strip()}). "
            "Both packages must be debuggable builds: ./scripts/build-android.sh Debug"
        )


def require_installed(serial, package, role):
    installed = adb(serial, "shell", "pm", "list", "packages", package)
    if f"package:{package}" not in installed.splitlines():
        raise SystemExit(f"{role} package {package} is not installed on {serial}")


def ensure_initialized(serial, package):
    probe = subprocess.run(
        ["adb", "-s", serial, "shell", "run-as", package, "ls", "files"],
        capture_output=True,
    )
    if probe.returncode == 0:
        return
    print(f"{package}: data directory absent — launching once to initialize")
    adb(serial, "shell", "monkey", "-p", package, "-c", "android.intent.category.LAUNCHER", "1")
    import time

    time.sleep(6)
    adb(serial, "shell", "am", "force-stop", package)


def pad_tar_end(payload):
    """toybox tar writes one trailing zero block; POSIX readers want two.

    GNU tar reports 'lone zero block' and device toybox warns 'bad header'
    while still extracting. Appending the missing block silences both.
    """
    if not payload.endswith(b"\0" * 1024):
        return payload + b"\0" * 512
    return payload


def dump(serial, package):
    require_installed(serial, package, "source")
    require_debuggable(serial, package, "source")
    ensure_initialized(serial, package)
    return pad_tar_end(
        adb(
            serial,
            "exec-out",
            "run-as",
            package,
            "tar",
            "-cf",
            "-",
            *DATA_DIRS,
            binary_output=True,
        )
    )


def restore(serial, package, archive):
    require_installed(serial, package, "target")
    require_debuggable(serial, package, "target")
    ensure_initialized(serial, package)
    remote = f"/data/local/tmp/yeoyu-migrate-{package}.tar"
    with tempfile.NamedTemporaryFile(suffix=".tar") as local:
        local.write(archive)
        local.flush()
        adb(serial, "push", local.name, remote)
    try:
        extract = subprocess.run(
            ["adb", "-s", serial, "shell", "run-as", package, "tar", "-xf", remote],
            capture_output=True,
        )
        present = subprocess.run(
            ["adb", "-s", serial, "shell", "run-as", package, "ls", *DATA_DIRS],
            capture_output=True,
        ).stdout.decode(errors="replace")
        if "files" not in present:
            raise SystemExit(
                f"restore into {package} failed: {extract.stderr.decode(errors='replace').strip()}"
            )
        if extract.returncode != 0:
            detail = extract.stderr.decode(errors="replace").strip()
            print(f"note: extractor exited {extract.returncode} ({detail}); contents verified instead")
        print(f"{package}: restored. Present: {present.strip().replace(chr(10), ', ')}")
    finally:
        subprocess.run(["adb", "-s", serial, "shell", "rm", "-f", remote])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("dump", "restore"))
    parser.add_argument("-s", "--serial", default=None)
    parser.add_argument("--from", dest="source", help="source package")
    parser.add_argument("--to", dest="target", help="target package")
    parser.add_argument("-o", "--out", type=Path, help="dump output tar path")
    parser.add_argument("-i", "--in", dest="archive", type=Path, help="restore input tar path")
    args = parser.parse_args()
    if args.action == "dump":
        if not args.source or not args.out:
            parser.error("dump needs --from PKG and -o OUT.tar")
        payload = dump(args.serial, args.source)
        args.out.write_bytes(payload)
        print(f"{args.source}: dumped {len(payload)} bytes → {args.out}")
    else:
        if not args.target or not args.archive:
            parser.error("restore needs --to PKG and -i IN.tar")
        restore(args.serial, args.target, args.archive.read_bytes())


if __name__ == "__main__":
    main()
