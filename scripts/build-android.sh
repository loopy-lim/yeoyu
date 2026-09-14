#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_ABIS="${ANDROID_ABIS:-aarch64-linux-android}"
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$HOME/.gradle}"
export CCACHE_DIR="${CCACHE_DIR:-$PWD/.cache/ccache}"
PROFILE="${1:-Debug}"
ARTIFACT_NAME="$(printf '%s' "$PROFILE" | tr '[:upper:]' '[:lower:]')"
case "$PROFILE" in
 Debug) ;;
 LocalRelease)
  export YEORYU_LOCAL_RELEASE=1
  PROFILE=Release
  ARTIFACT_NAME=local-release
  bun scripts/validate-release.ts local
  ;;
 Acceptance)
  export YEORYU_LOCAL_RELEASE=1
  ARTIFACT_NAME=acceptance
  bun scripts/validate-release.ts local
  ;;
 Release)
  export YEORYU_LOCAL_RELEASE=0
  bun scripts/validate-release.ts distribution
  ;;
 *) echo 'Usage: build-android.sh Debug|LocalRelease|Acceptance|Release'; exit 2;;
esac
# The generated Gradle task does not track the workspace lockfile or ABI
# selection. Cargo's own incremental dependency graph is authoritative.
if [ "$PROFILE" = Debug ]; then RUSTRA_PROFILE=debug; else RUSTRA_PROFILE=release; fi
export RUSTRA_PROFILE
sh modules/rustra-jsi/android/build-rust-android.sh
# The wrapper has already built the exact ABI/profile. The generated task only
# recognizes names containing 'release' and would rebuild Acceptance as debug.
android/gradlew -p android ":app:assemble$PROFILE" --no-daemon -PreactNativeArchitectures="${BROWSER_ARCHS:-arm64-v8a}" -x :rustra-jsi:buildRustAndroid

mkdir -p dist
case "$PROFILE" in Debug) ARTIFACT_PROFILE=debug;; Acceptance) ARTIFACT_PROFILE=acceptance;; *) ARTIFACT_PROFILE=release;; esac
cp "android/app/build/outputs/apk/$ARTIFACT_PROFILE/app-$ARTIFACT_PROFILE.apk" "dist/yeoyu-$ARTIFACT_NAME.apk"
