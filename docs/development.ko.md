[English](development.md)

# 개발과 검증

## Toolchain

이 저장소는 Node, Bun, Rust, GeckoView, Android SDK, Build Tools, NDK 버전을 고정합니다. Generated JSI와 Android native build는 toolchain 차이에 민감하므로 고정 버전을 권장합니다.

필요한 도구:

- Node.js 22, Bun 1.4.1
- `rustfmt`, `clippy`, `aarch64-linux-android`가 포함된 Rust 1.98
- `cargo-ndk` 4.1.2
- JDK 17 이상
- Android SDK 37.1, Build Tools 37.0.0, NDK 27.1.12297006
- emulator 또는 실기기용 `adb`

## Bootstrap

```sh
rustup component add rustfmt clippy
rustup target add aarch64-linux-android
cargo install cargo-ndk --version 4.1.2 --locked
./scripts/bootstrap.sh
```

Bootstrap은 `scripts/bootstrap.sh`에 선언된 정확한 Rustra revision을 `.deps/rustra-main`에 clone하고, Rustra와 이 저장소의 package를 설치한 뒤 binding을 생성·검사합니다. 이미 다른 revision인 Rustra checkout은 덮어쓰지 않습니다.

## Host 검증

```sh
./scripts/check.sh
```

다음 gate를 순서대로 실행합니다.

1. Rust formatting, test, warning을 허용하지 않는 Clippy.
2. Controller, UI contract, policy, generated binding용 Bun test.
3. Python geometry·acceptance-helper test.
4. Theme contrast check.
5. TypeScript type check.
6. Generated-code consistency.

## Android test

```sh
android/gradlew -p android \
  :app:testDebugUnitTest \
  --no-daemon \
  -PreactNativeArchitectures=arm64-v8a
```

Native/unit gate이며 앱을 설치하거나 특정 Android 기기·외부 identity provider 동작을 검증하지 않습니다.

## Build profile

| 명령 | Application | 용도 |
| --- | --- | --- |
| `./scripts/build-android.sh Debug` | `com.workspacebrowser` | Metro에 연결되는 개발 APK |
| `./scripts/build-android.sh LocalRelease` | `com.workspacebrowser` | 이 기기의 Android debug key로 서명한 optimized test APK |
| `./scripts/build-android.sh Acceptance` | `com.workspacebrowser.acceptance` | destructive acceptance를 위한 별도 data slot |
| `./scripts/build-android.sh Release` | `com.workspacebrowser` | 실제 서명과 증가한 version이 필요한 distribution candidate |

Build output은 Git에서 제외된 `dist/`로 복사됩니다. 저장소에는 signing key를 포함하지 않습니다. Debug, LocalRelease, Acceptance는 Android의 일반적인 기기별 debug key를 사용합니다.

## 기기에서 실행

Metro를 시작합니다.

```sh
bun start
```

다른 terminal에서 대상을 명시합니다.

```sh
adb devices
adb -s DEVICE_ID reverse tcp:8081 tcp:8081
adb -s DEVICE_ID install -r android/app/build/outputs/apk/debug/app-debug.apk
adb -s DEVICE_ID shell am start -n com.workspacebrowser/.MainActivity
```

일반 업데이트 과정에서 uninstall이나 app data 초기화를 사용하지 마세요. 기존 tab과 setting은 중요한 test data일 수 있습니다.

## Distribution signing

`Release`에는 다음 environment variable이 필요합니다.

- `YEORYU_STORE_FILE`
- `YEORYU_STORE_PASSWORD`
- `YEORYU_KEY_ALIAS`
- `YEORYU_KEY_PASSWORD`
- `YEORYU_VERSION_CODE`
- `YEORYU_PREVIOUS_VERSION_CODE`
- `YEORYU_VERSION_NAME`

Validator는 누락·부분 입력, 증가하지 않은 version, Android debug certificate를 거부합니다. Signing file이나 값을 commit하지 마세요. 로컬에서 Release APK를 만들었더라도 certificate, version, hash, 설치·migration, distribution channel을 별도로 확인하기 전에는 public release가 아닙니다.

## Pull request checklist

- `rustra.json`과 generated binding을 일치시킵니다.
- 바뀐 domain·browser 동작에 focused test를 추가합니다.
- `./scripts/check.sh`를 실행합니다.
- Android/native policy가 바뀌면 Android JUnit을 실행합니다.
- 실기기, provider, accessibility, performance, long-duration 등 실행하지 않은 범위를 밝힙니다.
- 의도적으로 sanitize한 public fixture가 아니면 진단 artifact를 Git에 넣지 않습니다.
