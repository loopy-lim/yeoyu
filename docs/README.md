[한국어](README.ko.md)

# Yeoyu documentation

The public documentation is intentionally small and current. Raw device captures, local paths, credentials-adjacent build records, and dated internal session logs are not published here.

## Start here

| Document | Use it for |
| --- | --- |
| [Architecture](architecture.md) | Ownership boundaries, runtime components, persistence, privacy, and generated code |
| [Development](development.md) | Toolchain setup, checks, Android builds, device runs, and release inputs |
| [Project status](project-status.md) | Implemented scope, verification boundaries, limitations, and roadmap |
| [Contributing](../CONTRIBUTING.md) | Pull request expectations and validation |
| [Security](../SECURITY.md) | Reporting vulnerabilities and handling sensitive data |

## Documentation principles

- Describe the current public source, not an earlier APK or a private device session.
- Keep source, unit-test, build, emulator, physical-device, and public-release evidence distinct.
- Do not publish browsing history, account data, device identifiers, local filesystem paths, signing material, or raw diagnostic captures.
- Update the relevant document when a boundary, dependency, build profile, or known limitation changes.

Implementation details remain discoverable next to the code. Public docs explain stable boundaries and supported workflows rather than preserving every implementation session.
