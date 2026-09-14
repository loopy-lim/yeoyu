[English](README.md)

# 여유 문서

공개 문서는 작고 최신인 상태를 유지합니다. 원시 기기 캡처, 로컬 경로, credential과 인접한 빌드 기록, 날짜별 내부 세션 로그는 공개하지 않습니다.

## 여기서 시작하세요

| 문서 | 용도 |
| --- | --- |
| [아키텍처](architecture.ko.md) | 소유권 경계, runtime 구성요소, 저장, privacy, generated code |
| [개발](development.ko.md) | toolchain 설정, 검사, Android 빌드, 기기 실행, release 입력 |
| [프로젝트 상태](project-status.ko.md) | 구현 범위, 검증 경계, 한계, roadmap |
| [기여](../CONTRIBUTING.md) | pull request 기준과 검증 |
| [보안](../SECURITY.md) | 취약점 신고와 민감 정보 취급 |

## 문서 원칙

- 과거 APK나 비공개 기기 세션이 아니라 현재 공개 소스를 설명합니다.
- source, unit test, build, emulator, physical device, public release 근거를 구분합니다.
- 브라우징 기록, 계정 데이터, 기기 식별자, 로컬 파일 경로, 서명 자료, 원시 진단 캡처를 공개하지 않습니다.
- 경계·의존성·빌드 프로필·알려진 한계가 바뀌면 관련 문서를 함께 갱신합니다.

구현 세부사항은 코드 가까이에 남깁니다. 공개 문서는 매 작업 세션을 보존하는 대신 안정적인 경계와 지원 workflow를 설명합니다.
