[English](development.md)

# 개발과 검증

## Toolchain

이 저장소는 Node, Bun, Rust, GeckoView, Android SDK, Build Tools, NDK 버전을 고정합니다. Generated JSI와 Android native build는 toolchain 차이에 민감하므로 고정 버전을 권장합니다.

필요한 도구:

- Node.js 26, Bun 1.4.3
- `rustfmt`, `clippy`, `aarch64-linux-android`가 포함된 Rust 1.99.0
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

## UI style과 import

React Native UI에는 Uniwind/Tailwind class, 공통 variant에는 CVA, 조건부 class에는 `cn`을 사용합니다. 전역 theme을 변경하는 대신 각 root 또는 중첩 Space를 `ThemeScope`로 감쌉니다. Animation 값, 측정한 geometry, 키보드 bounds, native adapter 속성은 runtime style에 유지합니다. Metro의 Uniwind wrapper가 `global.css`를 컴파일하고 `src/uniwind-types.d.ts`를 관리합니다.

TypeScript와 Metro는 다음 application import alias를 공유합니다.

| Import | 대상 |
| --- | --- |
| `@/*` | `src/*` |
| `@modules/*` | `modules/*` |
| `@generated/*` | `generated/*` |
| `@styles/global.css` | `global.css` (정확히 일치하는 import) |

Metro는 dependency의 namespace를 분리하고 Rustra가 생성한 `.js` specifier를 TypeScript source로 해석합니다. `tsconfig.json`과 `metro.config.js`의 alias를 일치시킵니다.

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
| `./scripts/build-android.sh Debug` | `ll3.kr.yeoyu` | Metro에 연결되는 개발 APK |
| `./scripts/build-android.sh LocalRelease` | `ll3.kr.yeoyu` | 이 기기의 Android debug key로 서명한 optimized test APK |
| `./scripts/build-android.sh Acceptance` | `ll3.kr.yeoyu.acceptance` | destructive acceptance를 위한 별도 data slot |
| `./scripts/build-android.sh Release` | `ll3.kr.yeoyu` | 실제 서명과 증가한 version이 필요한 distribution candidate |

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
adb -s DEVICE_ID shell am start -n ll3.kr.yeoyu/.MainActivity
```

일반 업데이트 과정에서 uninstall이나 app data 초기화를 사용하지 마세요. 기존 tab과 setting은 중요한 test data일 수 있습니다.

## 데이터 마이그레이션

앱 ID 변경(`com.workspacebrowser` → `ll3.kr.yeoyu`)이나 재설치 시 데이터는 슬롯별로 분리됩니다. `uninstall`과 `pm clear`는 앱 데이터를 함께 지웁니다. 이동 경로는 두 가지입니다.

**작업 보관 파일 경로(권장, 모든 빌드 가능)** — 앱 내 설정 → 브라우저 데이터에서 제공합니다.

1. 이전 설치에서 "작업 보관 파일 내보내기"(또는 "북마크를 HTML로 내보내기")로 파일을 저장합니다. 보관 파일에는 Space·탭·북마크·키맵이 담기고 비공개 탭·쿠키·입력 상태는 제외됩니다.
2. 새 설치에서 "북마크 또는 작업 보관 파일 가져오기"로 파일을 열고 미리 보기로 개수를 확인한 뒤 가져옵니다. 중복 URL은 카운트되고 keymap·즐겨찾기 추가는 토글로 선택합니다.

**전체 슬롯 복사(Debug 빌드 전용)** — `scripts/migrate-app-data.py`가 run-as로 데이터 디렉터리(files, shared_prefs, databases)를 tar로 옮깁니다. Acceptance·Release는 debuggable이 아니라 run-as를 거부합니다.

```sh
python3 scripts/migrate-app-data.py dump -s DEVICE_ID --from OLD_PKG -o old.tar
python3 scripts/migrate-app-data.py restore -s DEVICE_ID --to NEW_PKG -i old.tar
```

restore 전에 대상 앱을 한 번 실행해 데이터 디렉터리를 초기화해 둡니다(스크립트가 없으면 자동 실행). 같은 패키지 복구는 dump → `pm clear` → restore 순서로 씁니다.

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
