# Contributing to Yeoyu

Yeoyu is experimental, but focused issues and pull requests are welcome.

## Before opening a change

1. Check the existing issues and describe the user-visible problem or design goal.
2. Keep browser-engine, durable-domain, and React Native UI responsibilities within the boundaries in [Architecture](docs/architecture.md).
3. Avoid unrelated generated files, build outputs, device captures, browsing data, and signing material.

## Validate the change

Run the host gate:

```sh
./scripts/bootstrap.sh
./scripts/check.sh
```

For Android/native changes, also run:

```sh
android/gradlew -p android \
  :app:testDebugUnitTest \
  --no-daemon \
  -PreactNativeArchitectures=arm64-v8a
```

See [Development](docs/development.md) for toolchain and build details.

## Pull requests

Include:

- what changed and why;
- the exact checks that passed;
- tests added or updated;
- any behavior not tested on a physical device, external provider, or long-duration run;
- screenshots only when they contain sanitized fixture data.

Generated contracts must match `rustra.json`. If a generated file changes, include the source/schema change that produced it.

By submitting a contribution, you agree that it is licensed under the [Apache License 2.0](LICENSE) unless you explicitly state otherwise.

## Public-data rule

Do not commit secrets, signing keys, account identifiers, browsing history, private URLs, local filesystem paths, device serials, raw device dumps, or unsanitized logs. Use `example.com` or repository-owned fixtures in screenshots and tests.
