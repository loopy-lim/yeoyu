[한국어](development.ko.md)

# Development and verification

## Toolchain

The repository pins Node, Bun, Rust, GeckoView, Android SDK, Build Tools, and NDK versions. Prefer the pinned versions because generated JSI and Android native builds are sensitive to toolchain drift.

Required tools:

- Node.js 22 and Bun 1.4.1
- Rust 1.98 with `rustfmt`, `clippy`, and `aarch64-linux-android`
- `cargo-ndk` 4.1.2
- JDK 17 or newer
- Android SDK 37.1, Build Tools 37.0.0, and NDK 27.1.12297006
- `adb` for an emulator or physical device

## Bootstrap

```sh
rustup component add rustfmt clippy
rustup target add aarch64-linux-android
cargo install cargo-ndk --version 4.1.2 --locked
./scripts/bootstrap.sh
```

Bootstrap clones the exact Rustra revision declared in `scripts/bootstrap.sh` into `.deps/rustra-main`, installs its packages, installs this repository's packages, generates bindings, and checks that the output is current. An existing Rustra checkout at another revision is never overwritten.

## Host verification

```sh
./scripts/check.sh
```

The gate runs:

1. Rust formatting, tests, and Clippy with warnings denied.
2. Bun tests for controllers, UI contracts, policies, and generated bindings.
3. Python geometry and acceptance-helper tests.
4. Theme contrast checks.
5. TypeScript type checking.
6. Generated-code consistency.

## Android tests

```sh
android/gradlew -p android \
  :app:testDebugUnitTest \
  --no-daemon \
  -PreactNativeArchitectures=arm64-v8a
```

This is a native/unit gate. It does not install the app or verify behavior against a particular Android device or external identity provider.

## Build profiles

| Command | Application | Purpose |
| --- | --- | --- |
| `./scripts/build-android.sh Debug` | `com.workspacebrowser` | Metro-connected development APK |
| `./scripts/build-android.sh LocalRelease` | `com.workspacebrowser` | Locally optimized test APK signed with the machine's Android debug key |
| `./scripts/build-android.sh Acceptance` | `com.workspacebrowser.acceptance` | Separate-data test slot for destructive acceptance cases |
| `./scripts/build-android.sh Release` | `com.workspacebrowser` | Distribution candidate requiring real signing and a higher version |

Build outputs are copied to `dist/`, which is ignored by Git. The repository does not contain a signing key. Android's normal per-machine debug key is used for Debug, LocalRelease, and Acceptance.

## Run on a device

Start Metro:

```sh
bun start
```

In another terminal, select the target explicitly:

```sh
adb devices
adb -s DEVICE_ID reverse tcp:8081 tcp:8081
adb -s DEVICE_ID install -r android/app/build/outputs/apk/debug/app-debug.apk
adb -s DEVICE_ID shell am start -n com.workspacebrowser/.MainActivity
```

Do not uninstall or clear app data as a routine update step. Existing tabs and settings may be valuable test data.

## Distribution signing

`Release` requires these environment variables:

- `YEORYU_STORE_FILE`
- `YEORYU_STORE_PASSWORD`
- `YEORYU_KEY_ALIAS`
- `YEORYU_KEY_PASSWORD`
- `YEORYU_VERSION_CODE`
- `YEORYU_PREVIOUS_VERSION_CODE`
- `YEORYU_VERSION_NAME`

The validator rejects missing or partial inputs, non-increasing versions, and the Android debug certificate. Never commit signing files or values. A locally assembled Release APK is still not a public release until its certificate, version, hash, installation/migration behavior, and distribution channel are independently verified.

## Pull request checklist

- Keep generated bindings in sync with `rustra.json`.
- Add focused tests for changed domain or browser behavior.
- Run `./scripts/check.sh`.
- Run Android JUnit when Android/native policy changes.
- State what was not tested, especially physical-device, provider, accessibility, performance, and long-duration behavior.
- Keep diagnostic artifacts out of Git unless they are intentionally sanitized public fixtures.
