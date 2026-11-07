# Arc 패리티 — 전수 재판정 + 트렌치 2 (탭 이름 변경·멀티 셀렉트·DoH·캡처·문서 갱신)

- 날짜: 2026-11-06
- 요청: "현재 여기에 arc브라우저를 100% 와 같지 않는 부분을 모두 찾아보고 진행해줄래?"
- 기준 리비전: main @ 4259add (worktree clean)
- 선행: docs/plans/2026-11-03-arc-parity-daily-use.md (저장 split 그룹·Site Search 구현 완료, V-1 잔여 구간 BLOCKED — 이번에 종료)

## 목표와 범위

**사용자에게 달라지는 결과**

1. 갭 문서가 2026-10-11 판정에서 현재 소스 기준으로 전면 갱신된다 — 판정 변경(저장 split 그룹 없음→부분, Boosts 없음→부분, Site Search 없음→부분), GeckoView 157 AAR 근거로 해소된 조건부 항목(DoH·번역·원격 디버깅·Passkey·DRM), 인터랙션 차이(스페이스 이름 변경·삭제 부재, 폴더·스페이스 드래그 불가, 날짜 그룹핑 부재)까지 기록.
2. 재판정된 갭 중 실행 가능 트렌치가 구현됨: 탭 이름 변경, 탭 멀티 셀렉트(일괄 닫기·스페이스 이동), 저장 split 그룹 이름 변경, Secure DNS(DoH) 설정, 전체페이지 캡처·공유(PDF).
3. 이전 슬라이스의 BLOCKED V-1(저장 split 그룹 저장→재시작→복원→삭제 실측)이 에뮬레이터 실측으로 종료됨.

**이번 실행에서 제외 (후속 SDD 분리 — 갭 문서에 난이도·근거와 함께 기록)**

- 자동 tab archive — project-status.ko.md:62가 safe-restoration signal을 선행 조건으로 명시(저장소 자체 roadmap 게이트)
- 번역·Secure DNS 외 보안 항목(비밀번호 관리), 원격 DevTools, 통합 Library, 4-pane split, 독립 PiP/미니 플레이어, Little Arc 자동화, ATC, Space 이름 변경·삭제, Instant Links, Arc Max 전체 — 난이도 상이거나 기기 검증·별도 설계 필요
- Backlog(철학 충돌): AI 전체, Live Folders/Calendars, Boosts JS 주입 확장, Easel, 위젯, Group Policy

**벤치마크 근거**: docs/arc-gap-analysis.ko.md + docs/research/2026-10-11-version-upgrade-arc-gap.md §6 (Arc 기능 전수). 조사 방법: 독립 조사 에이전트 6섹션(2섹션은 2회 교차 검증, 판정 불일치 0) + 오케스트레이터의 file:line 직접 대조 4건.

## 확인한 근거 (조사 요약)

- **탭 이름 변경**: `Tab.title`이 유일 필드(native/src/domain.rs:44), `navigate_tab`이 무조건 덮음(domain.rs:664 — 직접 확인). 메뉴의 `onEdit` prop과 렌더 분기·i18n 키 `chrome.editSaved`가 이미 존재하나 App.tsx가 전달하지 않음(src/components/Dialogs.tsx:199-218 — 직접 확인). rename 커맨드 선례: bookmark_folder_rename(lib.rs:341, domain.rs:988-1003), register! 말미 추가+codegen.
- **탭 멀티 셀렉트**: selection 컬렉션 0건. 일괄 닫기 선례 "다른 탭 닫기"(Dialogs.tsx:273-278 → App.tsx:4225-4240, favorite·pinned·suspended 제외 필터). 일괄 이동 = `controller.setTabWorkspace`(BrowserController.ts:702-711). 행 long-press는 메뉴·드래그와 바인딩 중 — 진입은 메뉴 항목으로.
- **저장 split 그룹**: Rust upsert 완성(domain.rs:913-937, id 바인딩 유지). UI는 `splitGroupId: null` 고정으로 이름 변경 미노출(App.tsx:1195-1211 — 직접 확인).
- **DoH**: `GeckoRuntimeSettings`에 TRR mode/URI/제외도메인 typed setter 존재(GV157 AAR 2회 독립 확인). 삽입점 `applyRuntimeSettings`(GeckoSessionRegistry.kt:390-401 — 직접 확인). persist는 Kotlin toolsConfig 패턴.
- **캡처·공유**: GV157 `GeckoSession`에 saveAsPdf/PdfFileSaver 계열 존재(상수 풀 확인, 정확 시그니처 미확인 — **구현 전 컴파일 프로브 필수**). shareUrl·FileProvider·chooser 선례 완비(ExternalNavigationCoordinator.kt:98-103, DownloadCoordinator.kt:231-248, AndroidManifest.xml:27-33). captureRendering은 뷰포트 전용·JS 반환 없음(platform.ts:103, GeckoSessionRegistry.kt:1414-1435).
- **V-1 잔여**: emulator-5554 부팅 완료, 런처 포그라운드(경합 없음), 수용 빌드 `ll3.kr.yeoyu.acceptance` 설치됨. 재실측에는 신규 빌드 필요(아래 V-5).
- **게이트**: `./scripts/check.sh` (cargo fmt/test/clippy, bun test, python 2종, contrast, tsc, codegen --check), `android/gradlew :app:testDebugUnitTest`.

## 설계

### D1. 탭 이름 변경 (T-1)

- **모델**: `Tab.custom_title: String` `#[serde(default)]`(버전 무변경 선례: bookmarkFolders, SplitGroup). **규칙**: `navigate_tab`은 `new_url != tab.url`일 때 `custom_title`을 지우고, 같은 URL이면 유지 — 사용자가 이름 붙인 탭의 재로딩·제목 변동에서 이름이 살아남고, 다른 곳으로 이동하면 자연 해제(스테일 방지, 사용성 우선). `tab.title`은 페이지 제목 그대로 유지(검색·내부 로직 호환).
- **커맨드**: `tabRename(tabId, title)` — trim·빈 값 거부, 존재 검사, active workspace 한정(bookmark_folder_rename 선례). register! 말미 + `bun run codegen`. 컨트롤러 thin 메서드.
- **표시**: `tabLabel`(App.tsx:789-790)을 `custom_title || title || url` 우선으로. 사이드바·퀵오픈·탭 카운트 등 전 표면 자동 반영.
- **UI**: 메뉴 `onEdit` 배선(App.tsx 탭 메뉴 호출부) → 이름 변경 다이얼로그(autofocus TextInput+저장/취소, split group 저장 다이얼로그 선례 App.tsx:4456-4477). 빈 입력은 저장 비활성. 비공개 탭도 세션 수명 내 이름 변경 허용(snapshot 제거 규칙상 재시작 시 소멸 — 다이얼로그에 문구 불필요, 메뉴 라벨만).
- **상태**: 초기(빈 입력 비활성)/편집중/저장(다이얼로그 닫힘)/취소. 오류(존재하지 않는 탭)는 run setError 경로 재사용.

### D2. 탭 멀티 셀렉트 (T-2)

- **진입**: 탭 컨텍스트 메뉴에 "탭 선택" 항목(선택 모드 진입). 모드 중 행은 leading 체크 표시로 전환, 탭=선택 토글(활성화·전환 동작 대체), long-press는 기존 유지.
- **툴바**: 선택 모드 중 사이드바 하단 바 대체 — "N 선택됨 · 닫기 · 스페이스로 이동 · 취소". 닫기는 favorite·pinned·suspended 제외("다른 탭 닫기" 필터 확장, App.tsx:4226-4239), 이동은 controller.setTabWorkspace 루프(큐 직렬화 선례). 모든 선택 대상이 제외 규칙에 걸리면 닫기 비활성.
- **이탈**: 취소 버튼·모드 외 영역 상호작용(split 생성·스페이스 전환)·빈 선택에서 닫기 후 자동 종료. 복원 스택 12개 상한 부수 효과는 그대로(문서화).
- **상태**: `selectionMode: boolean` + `selectedTabIds: Set<string>` (App.tsx). 행 렌더 `renderSidebarTab`에 선택 표시 분기. 순수 헬퍼(닫기 대상 필터)는 sidebarModel.ts에 추출해 단위 테스트.
- 접근성: 체크 상태 accessibilityLabel에 선택 여부 포함, 툴바 버튼 라벨 명시.

### D3. 저장 split 그룹 이름 변경 (T-3)

- 관리 다이얼로그 행에 이름 변경 동작 추가(행 탭=복원은 유지, 행 long-press 또는 편집 아이콘) → 기존 저장 다이얼로그 재사용(이름 프리필, 제출 시 `splitGroupSave({splitGroupId: id, ...})` — pendingSplitSave에 기존 그룹 필드 보관). Space 귀속·바인딩은 Rust upsert가 유지(domain.rs:900-902 명시 동작).

### D4. Secure DNS (DoH) 설정 (T-4)

- **persist**: Kotlin toolsConfig에 `secureDnsMode: "auto"|"off"|"custom"`, `secureDnsUri: String`(custom일 때만 사용) 추가 — BrowserToolsConfig 기존 패턴(textScale/trackingProtection) 따름.
- **적용**: `applyRuntimeSettings`(GeckoSessionRegistry.kt:390)에 typed setter — auto=기본(Gecko 자동 선택), off=`TRR_MODE_OFF`, custom=`TRR_MODE_FIRST`+URI(https:// 스킴 검증, 아닐 경우 기본으로 폴백). 커스텀 URI는 설정 저장 시점에 검증.
- **UI**: 설정의 보안 영역(trackingProtection UI 근처)에 선택 행 + custom URI 입력. i18n en/ko 쌍. 재시작 후 toolsConfig에서 복원.
- 상태: 초기/auto 기본, 저장 즉시 적용은 다음 런타임 생성 시(현재 applyRuntimeSettings가 런타임 생성 1회 호출인 구조 유지 — 즉시 적용 요구는 후속).

### D5. 전체페이지 캡처·공유 PDF (T-5)

- **프로브 게이트**: GV157 `GeckoSession.saveAsPdf`/`PdfFileSaver` 시그니처를 컴파일로 확인. 시그니처가 현실과 어긋나면 이 태스크는 BLOCKED→후속 분리(계획에 증거 기록), AC-6은 미충족으로 남김 — 뷰포트 캡처로 대체하지 않음(Arc의 Capture는 전체페이지이므로).
- **브리지**: BrowserModule에 `capturePagePdf(tabId, promise)` — 세션의 PdfFileSaver로 cacheDir에 PDF 생성 → 절대 경로 반환. `sharePagePdf(path)` — FileProvider URI + `ACTION_SEND application/pdf` + EXTRA_STREAM + chooser(DownloadCoordinator grant/clipData 패턴).
- **JS·UI**: platform.ts `capturePagePdf/sharePagePdf`, 커맨드 팔레트 `browser.captureShare` + 메뉴 항목(사이드바 "+" 메뉴 또는 탭 메뉴 — 구현 시 최소 diff 위치 선택), i18n en/ko.
- 상태: 캡처 진행(비동기)/성공(공유 시트)/실패(setError 문구). 비공개 탭은 대상 제외.

### D6. 문서 갱신 (T-6)

- `docs/arc-gap-analysis.ko.md` + `.md`: 전 행 재판정 반영(위 목표 1), 이번 실행으로 해소된 행 갱신, 난이도 재평가, "검증 필요" 절의 Passkey(wiring 완료)/DRM(명시적 auto-deny) 수준 갱신. 근거 file:line.
- `docs/project-status.ko.md` + `.md`: "저장되는 split group 미구현" 스테일 문구 수정(39행) + 이번 트렌치 반영.

## 태스크

| ID | 목적·AC | 수정할 파일/경계 | 선행 | 검증 | 상태 |
|---|---|---|---|---|---|
| T-1 | AC-2 탭 이름 변경 (Rust→codegen→Controller→UI) | native/src/domain.rs, native/src/lib.rs, native/tests/domain.rs, generated/*, src/BrowserController.ts, src/App.tsx, src/components/Dialogs.tsx(호출부만), src/i18n.ts, tests/controller.test.ts | 없음 | V-2, V-3, V-5 | done |
| T-2 | AC-3 탭 멀티 셀렉트 (JS-only) | src/App.tsx, src/sidebarModel.ts, src/components/Dialogs.tsx, src/i18n.ts, tests/sidebarModel.test.ts | T-1(App.tsx·Dialogs.tsx 순차) | V-2, V-5 | done |
| T-3 | AC-4 split 그룹 이름 변경 UI | src/App.tsx | T-1 | V-2, V-5 | done |
| T-4 | AC-5 Secure DNS 설정 | android/.../BrowserToolsConfig.kt, android/.../GeckoSessionRegistry.kt, src/components/BrowserToolsPanel.tsx, src/browserWorkflows.ts, src/i18n.ts, android 단위테스트 | T-3 | V-4, V-5 | done |
| T-5 | AC-6 전체페이지 캡처·공유 PDF (프로브 게이트) | android/.../GeckoSessionRegistry.kt(capturePagePdf), android/.../BrowserModule.kt, src/platform.ts, src/App.tsx, src/commandRegistry.ts, src/i18n.ts | T-4 | V-4, V-5 | done |
| T-6 | AC-1 갭 문서·project-status 갱신 (ko/en) | docs/arc-gap-analysis.ko.md·.md, docs/project-status.ko.md·.md | T-1~T-5 | V-6 | done |
| T-7 | AC-7·8 통합 검증·실측·V-1 종료 | 없음(검증만) | T-1~T-6 | V-5, V-1, V-7 | in progress |

App.tsx는 T-1→T-2→T-3→T-5 순차 편집(공유 파일 소유 순서). T-4는 Kotlin·설정 패널로 충돌 없음.

## 검증 계획과 결과

| ID | 방법·정의 근거 | cwd·환경 | 기대 결과 | 실제 결과·증거 | 판정 |
|---|---|---|---|---|---|
| V-1 | 에뮬레이터 실측: split 생성→저장→앱 종료·재시작→복원→삭제 (docs/plans/2026-11-03 V-1 잔여) | emulator-5554, 수용 빌드 | 배치 유지 복원, 재시작 존속, 삭제 동작 | 2026-11-07 시도: split 탭 준비까지 도달했으나 uiautomator stale dump 반복 + 레이아웃 변경 좌표 드리프트로 픽커~저장 구간 자동화 불가 — 종료 못함. 도구 함정 상세 [[yeoyu-emulator-automation-pitfalls]]. 전용 세션(또는 수동) 재실측 필요 | pending |
| V-2 | bun test tests (repo 정의 package.json/check.sh) | repo root | 신규+기존 전부 통과 | 585 pass / 0 fail (탭 이름 변경 controller·sidebarModel batch·DoH parse·i18n 포함, T-5 후 재실행) | PASS |
| V-3 | cargo test --manifest-path native/Cargo.toml + fmt + clippy (check.sh 정의) | repo root | 신규 domain 테스트 통과, fmt·clippy 클린 | domain 61 pass(신규 rename 3: override 설정·해제, URL 유지·변경 규칙, snapshot round-trip+레거시 폴백), fmt·clippy 클린 | PASS |
| V-4 | android/gradlew -p android :app:testDebugUnitTest (CONTRIBUTING.md 정의) | repo root | Kotlin 변경 단위테스트 통과 | BUILD SUCCESSFUL 2회(DoH applyRuntimeSettings 컴파일·BrowserToolsConfig DNS 3테스트, capturePagePdf 브리지 컴파일 포함) | PASS |
| V-5 | ./scripts/check.sh 전체 + 에뮬레이터 실측(G4) | repo root + emulator-5554 | exit 0 + 관찰된 동작 | check.sh **exit 0**(cargo fmt/test/clippy, bun 585, python, contrast, tsc, codegen --check). 에뮬레이터 실측은 빌드 후 진행 | PASS(호스트)·실측 pending |
| V-6 | 문서 대조: 갭 문서 각 행 vs 조사 근거 file:line | repo root | 근거 불일치 0 | ko/en 갭 문서·project-status ko/en 갱신. 근거 경로 8종 실재 확인(BrowserWindow.kt, CredentialActivityCoordinator.kt, VideoPipViewport.kt, ExternalPictureInPicture.kt, policy.ts miniPlayerTabs, appStyles.ts minis, PromptValues.kt 등). 구현 행의 근거는 직접 구현·컴파일로 확인 | PASS |
| V-7 | G3 독립 코드 리뷰 (Agent 위임, 원 요청·계획·diff·검증기록 전달) | repo root | 결함 처리 완료 | 미실행 | pending |

## 수락 기준

| ID | 관찰할 결과와 적용 조건 | 담당 태스크 | 검증 ID |
|---|---|---|---|
| AC-1 | 갭 문서(ko/en)·project-status(ko/en)가 현재 소스 기준 판정과 이번 변경을 근거 file:line과 함께 반영 | T-6 | V-6 |
| AC-2 | 탭 메뉴에서 이름 변경 가능; 변경명은 같은 사이트(오리진) 내 이동 후 유지·다른 사이트 이동 시 해제·재시작 존속 규칙 준수 | T-1 | V-2, V-3, V-5 |
| AC-3 | 여러 탭 선택→일괄 닫기·스페이스 이동 동작; favorite·pinned·suspended는 일괄 닫기 제외 | T-2 | V-2, V-5 |
| AC-4 | 저장 split 그룹의 이름을 목록에서 변경 가능(바인딩·Space 귀속 유지) | T-3 | V-2, V-5 |
| AC-5 | 설정에서 DoH 모드(auto/off/custom URI) 선택·저장·재시작 후 유지, Gecko 런타임에 적용 | T-4 | V-4, V-5 |
| AC-6 | 현재 페이지를 PDF로 저장해 Android 공유 시트로 보낼 수 있다 (프로브 실패 시 명시적 후속 분리) | T-5 | V-4, V-5 |
| AC-7 | 전체 게이트(check.sh, gradle unit test) 통과 | 전체 | V-3, V-4, V-5 |
| AC-8 | 이전 슬라이스 V-1 잔여 구간(저장→재시작→복원→삭제) 실측 증거 확정 | T-7 | V-1 |

## 평가와 인계

- G3 코드 리뷰: 독립 평가자(Agent) 위임 — 원 요청·계획·diff·검증 기록 전달, 작성자 PASS 주장 미포함. **판정: PASS(조건부 권고)** — 평가자가 5개 게이트를 직접 재실행(bun 585/0, tsc, cargo 74/0, gradle BUILD SUCCESSFUL, codegen --check).
- G4 디자인: review-design 구현 모드 — 에뮬레이터 실측 관찰 필수(스크린샷 없는 시각 PASS 없음). 함정 체크리스트: uiautomator dump 신선도 가드(덤프 전 rm→재생성 확인), Gboard가 시트를 가리면 BACK 선행, 실측 전 topResumedActivity 확인.
- 위험: App.tsx·Dialogs.tsx·i18n.ts는 이번 run 내 순차 소유. codegen 재생성물 수동 편집 금지. T-5 프로브 실패 시 AC-6 후속 분리는 결함이 아니라 계획된 분기.

### 리뷰 결함과 처리 (F-*)

- **F-1 (P2, 수정)** DoH 커스텀 리졸버의 JS·Kotlin 검증 비대칭 — JS가 수용한 URI(userinfo·underscore 호스트·대문자 스킴)를 Kotlin이 거부하면 기동 시 toolsConfig 전체가 조용히 기본값으로 리셋. 수정: JS 검증을 Kotlin(java.net.URI) 의미론에 정렬 + 테스트 4케이스 추가. Kotlin catch-폴백 자체는 기존 패턴 유지(후속: last-good 보존)
- **F-2 (P2, 수정)** 저장된 커스텀 DoH URI가 설정 화면에서 빈 필드로 표시 — useEffect로 config 시딩
- **F-3 (P2, 수정)** 퀵오픈 favorite 타일 가시 라벨만 customTitle 미반영(회귀 아닌 누락 표면) — 수정
- **F-4 (P3, 수정)** 이름 변경 다이얼로그 빈 입력 저장 가능(계획 D1 편차) — disabled 추가. 해제는 도메인 계약으로 남김(빈 rename은 더 이상 UI에서 불가)
- **F-5 (P3, 완화)** SPA pushState에서 custom_title 조기 해제 가능성 — 해제 규칙을 URL 변경→**오리진 변경**으로 강화, 테스트·문서 갱신
- **F-6 (P3, 수정)** selection 이탈 지점 부족 — toggleSidebar·goHome·split 진입에 exitSelectionMode 추가
- **F-7 (P3, 수정)** 일괄 이동 부분 실패가 조용히 흡수 — 실패 카운트 후 flashNotice(신규 i18n 키 chrome.selectionMoveFailed)
- **F-8 (P3, 기각)** 캡처 PDF 파일 누적·네이티브 chooser 문자열 하드코딩 — 사유: 파일은 app-scoped external dir(사용자 노출 없음), 네이티브 계층엔 i18n 인프라가 없음(기존 DownloadCoordinator도 영문 chooser 제목). 후속 과제로 기록
- **F-9 (P3, 기각)** 탭 삭제 후 rename 시 영문 도메인 에러 노출 — 기존 run() 오류 표시 패턴과 동급, 이번 범위 밖
- **F-10 (P3, 수정)** ko 문서 오탈자("조산"→"조사")·계획 문서 상태 미갱신 — 수정
- **F-11 (P3, 수정)** suspend 탭의 캡처 게이트 부재 — 핸들러·메뉴 disabled에 suspended 검사 추가
- **F-12 (P2, 미처리 — 2026-11-07 자연스러움 트렌치 G3 리뷰에서 교차 발견)** `capturePagePdf`(GeckoSessionRegistry.kt)의 `saveAsPdf().accept` 소비자가 GeckoResult 디스패치에 따라 NativeModules 브리지 스레드에서 실행되고, `input.copyTo(output)` 파일 I/O가 브리지 전체를 PDF 기록 시간만큼 정지시킴(@ReactMethod가 `onUi` 없이 브리지 스레드에서 진입 → GeckoResult가 생성 스레드 루퍼로 완료 디스패치). 워커 실행 필요 — 다음 트렌치2 리뷰/수정 사이클에서 처리.

## 사용 가능한 도구·환경

- 호스트: bun test, tsc, cargo, scripts/check.sh, bun scripts/contrast-check.ts, codegen
- 에뮬레이터: emulator-5554 부팅 완료·경합 없음. 신규 수용 빌드: `ANDROID_ABIS="x86_64-linux-android" BROWSER_ARCHS=x86 JAVA_HOME=~/.local/share/mise/installs/java/openjdk-17 ANDROID_HOME=/home/loopy/android-sdk PATH=~/.cargo/bin:$PATH ./scripts/build-android.sh Acceptance`
- 평가자: Agent 위임 가능
