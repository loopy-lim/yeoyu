# 표준 브라우저 자연스러움 정렬 — 트렌치 1 (정지 버튼·콘텐츠 메뉴 다운로드·"+" 메뉴 페이지 액션)

- 날짜: 2026-11-07
- 요청: "현재 다른 사람들의 화면 공유와 점점 거리가 멀어지는거 같아. 그런 자연스러움들도 모두 같이 따라가게 해줄래?"
- 기준 상태: main @ 4259add + 미커밋 tranche2 변경 34파일(+2,853/−819, docs/plans/2026-11-06-arc-parity-tranche2.md T-1~T-6 완료·T-7 실측 pending). 이번 작업은 그 위에 얹고 보존한다.
- 해석: 화면 공유로 관찰되는 일반 브라우저(Chrome/Safari/Firefox 계열)에서 "당연한" 조작을 여유에서 동일하게 수행할 수 있어야 한다. 확정된 디자인 방향(파스텔 팔레트, Arc식 사이드바, 중앙 주소 편집기 — [[yeoyu-visual-preference]], [[yeoyu-design-direction]])은 유지하고, 관행 어긋남만 좁힌다.

## 어긋남 감사 (전수 조사 기준)

조사: 읽기 전용 조사 에이전트(크롬 표면 전수, file:line 첨부) + 오케스트레이터 직접 대조(시스템 뒤로 가기, 다운로드 인프라, codegen 경로, 아이콘 세트, 설정 저장 API).

### 이미 표준과 일치 — 변경 없음

| 관행 | 근거 |
|---|---|
| 시스템 뒤로 가기 = 모달 닫기 → 페이지 히스토리 뒤로 → 앱 종료 | src/App.tsx:2097-2108 BackHandler, BrowserWindow.kt:210-218(보조 창) |
| 로딩 진행 표시기 | PaneLoadBar App.tsx:4175-4179, BrowserProgress 이벤트 |
| 로드 실패 배너 + 재시도 | App.tsx:3074-3104 |
| 주소 pill에 호스트+자물쇠/경고 표시 | AddressTrigger.tsx:16-27(Safari와 동일한 요약 수준) |
| 새 탭 페이지(검색 상자+즐겨찾기 타일) | NewTabPage App.tsx:4181-4216 |
| 탭별 닫기 버튼·탭 수 표시 | renderSidebarTab App.tsx:2681-2785, "Tabs N" 헤더 3577-3586 |
| 확대축소: 엔진 기본 핀치 줌 + 설정 텍스트 크기 | (JS/Kotlin에 별도 줌 UI 불필요) |

### 이번에 고침 (실행 가능·자연스러움 효과 큰 순)

| # | 표준 관행 | 여유 현재 | 근거 |
|---|---|---|---|
| 1 | 로딩 중 주소창 영역 새로고침 버튼이 ✕(정지)로 전환 | 정지 없음. reload뿐, 네이티브에 stop 커맨드 자체가 없음 | BrowserSurfaceNativeComponent.ts:22-37(커맨드 목록), BrowserSurfaceManager.kt:19-21, src에 stopLoad 0건 |
| 2 | 축소 모드에서도 새로고침/정지에 항상 접근 | 컴팩트 툴바는 back/forward/주소/split뿐, reload 없음 | App.tsx:3931-3964 |
| 3 | 링크 길게 누르기: 새 탭·**새 비공개 탭**·**링크 다운로드**·복사·공유 | open/copy/share 3종만 | BrowserContentMenu.tsx:31-33, useBrowserWorkflows.ts:131-152 |
| 4 | 이미지 길게 누르기: **이미지 저장**(다운로드) 부재 | 상동 | ExternalNavigationCoordinator.kt:68-87(imageUri는 이미 상신됨) |
| 5 | 페이지 메뉴(⋮ 상당)에서 페이지 내 찾기·페이지 공유·다운로드·데스크톱 사이트 | find는 ⌘F/팔레트만(touch 진입 없음), 페이지 링크 공유·다운로드 목록·데스크톱 전환은 "+" 메뉴에 없음(설정 깊숙이) | sidebarActions App.tsx:2816-2905, BrowserToolsPanel.tsx:474-488, 785-862 |
| 6 | 보조 창에서도 정지 | YeoyuWindow reload만 | YeoyuWindow.tsx:437-440 |

### 연기 (사유와 함께 — 이번 범위 밖, 후속 SDD 분리)

| 항목 | 사유 |
|---|---|
| Pull-to-refresh | 컴포지터 위 터치 중재(nested scroll 협상) 네이티브 신규 개발 + 기기 검증 필요. 기존 코드에 overscroll 계층 없음(전수 0건) |
| 엣지 스와이프 뒤로 | 동일한 제스처 중재 계층 필요. 시스템 뒤로 가기는 이미 표준 동작이라 공백이 작음 |
| 텍스트 선택 메뉴(복사 후 웹 검색·공유) | GV 텍스트 선택 델리게이트 + 페이지 JS 주입 설계 필요 |
| 가로 탭 스트립 | 확정된 Arc 사이드바 방향과 충돌(사용자 확정 디자인) — 의도된 어긋남 |
| 항상 보이는 전체 URL 편집 필드 | 중앙 주소 편집기가 확정 인터랙션(Arc). pill은 Safari 요약 수준과 동일 |
| 줌 +/- 버튼 | 엔진 핀치 줌 동작 + 설정 텍스트 크기로 기능 충족, UI 우선순위 낮음 |

## 설계

### D1. 정지 커맨드와 버튼 전환 (AC-1·2·6)

- **codegen 표면**: `modules/browser-surface/src/BrowserSurfaceNativeComponent.ts` NativeCommands에 `stop` 추가 → `bun run codegen`(generated/* 재생성, 수동 편집 금지). `BrowserSurfaceManager`에 `override fun stop(view)` → `GeckoSessionRegistry.navigate(context, tabId, "stop")` — navigate의 기존 back/forward/reload 분기에 "stop"→`session.stop()` 추가.
- **버튼 전환**: `Navigation.loading`(이미 이벤트에 존재) 기준으로 nav 행/컴팩트 툴바/보조 창의 reload 버튼이 ✕로 전환. 아이콘은 기존 `close` 글리프 재사용(신규 글리프 불필요). 접근성 라벨 교체(chrome.stop "Stop loading").
- **컴팩트 툴바**: back/forward 뒤에 reload/stop 버튼 1개 추가(44dp 행 규격 유지, address pill은 flex-1이라 폭 흡수 — 실측 확인).

### D2. 링크/이미지 다운로드·비공개 열기 (AC-3·4)

- **네이티브**: `GeckoWebExecutor(runtime).fetch(WebRequest(uri))` → WebResponse → 기존 `DownloadCoordinator.save(app, response, emit)` 재사용(GeckoSessionRegistry.kt:1027 onDownload와 동일 경로 — 파일명·알림·목록·취소 인프라 그대로). BrowserModule에 `downloadUrl(url, promise)` 노출, platform.ts `downloadUrl(url): Promise<void>`. 실패는 promise 거부 → JS onError.
- **콘텐츠 메뉴**: ContentAction에 `download`·`privateOpen` 추가. 항목: 링크 = 새 탭 열기/새 비공개 탭에서 열기/다운로드/복사/공유, 이미지 = 새 탭에서 열기/이미지 저장(=다운로드)/복사/공유. i18n en/ko. `download` 글리프 신규 추가(스트로크 아이콘 1종, 토큰 무관).
- **비공개**: 비공개 탭에서도 다운로드 허용(표준 관행). WebExecutor는 Gecko 네트워크 스택(쿠키 포함) 사용 — 프로필 분리 한계는 문서화.

### D3. "+" 메뉴 페이지 액션 (AC-5)

- sidebarActions(create)에 4항목 추가: 페이지 내 찾기(`registry.execute("find.open")`), 페이지 링크 공유(`platform.shareUrl(targetUrl)` — newtab/비공개 조건은 capture-share와 동일 게이트), 다운로드(설정 data 섹션의 다운로드 목록 직접 오픈), 데스크톱 사이트(현재 오리진 `updateSitePreference(origin, {desktop: !current})`(browserWorkflows.ts:186) 저장 후 `platform.retryTab` 자동 재로드 — 즉시 피드백).
- 순서: 생성 3종 → 즐겨찾기 → history·downloads → find·share·desktop → capture·PiP → extensions·settings. ActionMenu 스크롤 지원으로 항목 수 무관.
- disabled 조건: find/share/desktop은 NEW_TAB_URL·오리진 없음·(share는 비공개 제외 아님 — 링크 공유는 비공개에서도 자연) 등 명시.

## 태스크

| ID | 목적·AC | 수정 경계 | 선행 | 검증 | 상태 |
|---|---|---|---|---|---|
| T-1 | AC-1·2 stop 커맨드(표면+Kotlin)·codegen | modules/browser-surface/src/BrowserSurfaceNativeComponent.ts, generated/*(codegen), android/.../BrowserSurfaceManager.kt, GeckoSessionRegistry.kt(navigate "stop") | 없음 | V-2, V-3, V-5 | done(호스트) |
| T-2 | AC-1·2·6 버튼 전환 UI(사이드바 nav·컴팩트 툴바·보조 창) | src/App.tsx, src/YeoyuWindow.tsx, src/i18n.ts | T-1 | V-2, V-5 | done(호스트) |
| T-3 | AC-3·4 네이티브 downloadUrl(WebExecutor→DownloadCoordinator) | android/.../BrowserModule.kt, GeckoSessionRegistry.kt(downloadUrl), src/platform.ts | 없음 | V-3, V-5 | done(호스트) |
| T-4 | AC-3·4 콘텐츠 메뉴 액션 확장 + 테스트 | src/hooks/useBrowserWorkflows.ts, src/components/BrowserContentMenu.tsx, src/chrome/ChromeIcon.tsx(download 글리프), src/i18n.ts, tests/fixtures/browser-content-menu.tsx·browser-workflows-context.tsx, tests/browserContentMenu.test.tsx·browserWorkflowsContext.test.tsx | T-3 | V-1, V-5 | done(호스트) |
| T-5 | AC-5 "+" 메뉴 4항목 | src/App.tsx, src/i18n.ts | T-2(App.tsx 순차) | V-1, V-5 | done(호스트) |
| T-6 | AC-6 게이트·문서 갱신 | docs/project-status.md·.ko.md, 본 문서, tests/fixtures/content-menu.html·content-image.png, scripts/browser-fixture-server.py(/slow-page) | T-1~T-5 | V-4, V-6 | done |
| T-7 | G4 실측·G3/G4 독립 평가 | 없음(검증) | T-1~T-6 | V-5, V-7 | done(V-5·V-7, G3 결함 3건 수정 후 재검증) |

App.tsx는 T-2→T-5 순차 소유. GeckoSessionRegistry.kt는 T-1→T-3 순차.

## 검증 계획

| ID | 방법·정의 | 환경 | 기대 | 상태 |
|---|---|---|---|---|
| V-1 | `bun test tests`(package.json "test") | repo root | 신규(콘텐츠 메뉴 액션)+기존 전부 통과 | PASS: 587 pass / 0 fail(신규 browserContentMenu·browserWorkflowsContext 2종 포함) |
| V-2 | `bun run codegen` 후 generated 일관성(check.sh codegen --check) | repo root | 재생성물 일치 | PASS: codegen 실행 후 check.sh 내 --check 통과 |
| V-3 | `android/gradlew -p android :app:testDebugUnitTest`(CONTRIBUTING.md) | repo root | Kotlin 컴파일+단위테스트 통과 | PASS: exit 0(stop 오버라이드·downloadUrl 브리지 컴파일 포함) |
| V-4 | `./scripts/check.sh` 전체 | repo root | exit 0 | PASS: exit 0(cargo fmt/test/clippy, bun 587, python, contrast, tsc, codegen --check) |
| V-5 | 에뮬레이터 실측: 정지 버튼 전환·링크/이미지 다운로드·"+" 메뉴 4항목·컴팩트 툴바 (스크립트 scripts/browser-fixture-server.py 로컬 페이지) | emulator(parity-verify AVD), 수용 빌드 | 관찰된 동작+스크린샷 | PASS: AC-1~5 전 구간 관찰(아래 실측 기록), 클린 빌드(계측 제거 후)에서 AC-1 재확인 |
| V-6 | 문서 대조: 본 감사 표의 file:line 실재·project-status 갱신 | repo root | 불일치 0 | PASS: 근거 12 경로 실재 확인, project-status en/ko 기능 목록 갱신 |
| V-7 | G3 독립 코드 리뷰(원 요청·계획·diff·검증기록 전달, PASS 주장 미포함) | repo root | 결함 처리 완료 | 1차 FAIL(결함 4건: blocker 1·major 1·minor 2) → 3건 수정·1건 기록(capturePagePdf는 tranche2 F-12로 이관) → 기기 재검증·전 게이트 재실행으로 PASS |

## V-5 실측 기록 (2026-11-07, emulator-5554 · parity-verify AVD, 수용 빌드)

환경: `build-android.sh Acceptance`(x86_64), fixture 서버 8765 + `adb reverse`. 증거 스크린샷: `docs/plans/evidence-2026-11-07/`.

- **AC-1 정지 전환(사이드바 nav)**: `/slow-page?ms=15000&x=ac1` 로드 중 덤프 — 세 번째 nav 버튼 content-desc `Stop loading`(X 글리프) + 진행 바 표시. 정지 버튼 탭 1.5초 후 `Reload` 복귀(로드 취소). 증거: `ac1-stop-midload.png`, `ac1-after-stop.png`.
- **AC-2 컴팩트 툴바**: 사이드바 축소 상태에서 컴팩트 툴바에 reload/stop 버튼 신규 배치(`[282,34][346,98]`) 확인, 슬로우 로드 중 `Stop loading` 전환. 증거: `ac2-compact-stop.png`.
- **AC-3 링크 메뉴**: content-menu.html "Ordinary page link" 길게 누르기 → 열기/새 비공개 탭에서 열기/다운로드/복사/공유 5종 표시. "Download link" → 서버 `GET /next.html` + 시스템 Download 저장 확인(MediaProvider 로그) → "+" 메뉴 Downloads → 목록에 `next.html · Completed · 132 B / 132 B`. "Open in new private tab" → PRIVATE TABS 섹션 + 비공개 탭 생성. 증거: `ac3-link-menu.png`, `ac3-download-list.png`, `ac3-download-entry.png`, `ac3-private-open.png`.
- **AC-4 이미지 메뉴**: plain image 길게 누르기 → 새 탭에서 열기/이미지 다운로드/복사/공유 표시 → "Download image" → `GET /content-image.png` + Download 저장. 증거: `ac4-image-menu.png`.
- **AC-5 "+" 메뉴 4항목**: 메뉴에 Downloads·Find in page·Share page link·Desktop site 배치 확인(`ac5-plus-menu.png` — G4 수정 후 상태 접미 포함해 재캡처). Find in page → 찾기 바 + `link` 검색 `1/2`(`ac5-find-result.png`). Share page link → 시스템 공유 시트(`ChooserActivity`, URL 표시, `ac5-share-sheet.png`). Desktop site → 저장 후 자동 재로드(서버 로그 GET) + `/ua` 에코 페이지에서 UA가 `X11; Linux x86_64` → `Android 16; Mobile` 로 전환(`ac5-desktop-toggled.png`). 단, localhost:8765 오리진은 이 전환으로 mobile 프리퍼런스가 저장되어 이후 세션에도 유지됨(설정 지속성의 부수 증거).
- **보조 창(YeoyuWindow) 정지**: 에뮬레이터에서 보조 창(팝업 Activity)을 안정적으로 여는 경로가 이번 자동화 범위 밖 — 코드 패턴·컴파일·단위테스트(V-3)로만 검증. 실측은 별도 세션 과제로 남김(AC-1 부분, 하위 항목).

### 실측 중 발견한 두 가지 사항

1. **스킴 없는 주소 입력의 HTTPS-First 업그레이드**(동작, 결함 아님): 주소 편집기에 `localhost:8765/...` 처럼 스킴 없이 입력하면 Gecko가 `https://` 로 업그레이드해 요청하고, 로컬 HTTP fixture는 즉시 실패(OnLoadError). 표준 브라우저 동작과 일치하며 실패 시 기존 페이지가 유지된다. 실측에서는 `http://` 명시로 회피.
2. **첫 실측 세션의 미해석 관찰**: 긴 세션(구 번들 → 재설치 → 재개)에서만 슬로우 로드 중 Navigation 이벤트(loading=true)가 JS 상태에 반영되지 않는 현상을 2회 관찰. 신규 설치 상태에서 동일 시나리오(https 실패 → 복원 → 반복 로드 → 재시작 복원)를 재현 시 전 구간 정상(임시 NAVDBG 계측으로 전 이벤트 수락 확인, 계측은 제거 후 클린 빌드 재검증). 원인 특정 실패 — 재설치 전후 지속 상태(구 번들이 쓴 저장 상태)와의 상호작용 가설을 남기고, 코드 결함 증거는 없음. 재발 시 YeoyuBootstrap(traceBootstrap) + NAVDBG 계측 방법론으로 추적.

## G4 사용성·디자인 평가 (구현 모드, 2026-11-07)

1차 실측(V-5) 관찰 후 사용성 갭 1건을 발견해 수정(Desktop site 행 상태 접미)하고, 수정 빌드를 재설치해 해당 화면만 재관찰했다(그 외 화면은 변경 없음 — 재캡처 생략). 관찰 근거와 소스-only 근거를 구분해 기록.

**수정 사항(1차 평가 발견 → 재실측 확인)**: 1차 `ac5-plus-menu.png` 에서 Desktop site 행이 켜짐/꺼짐 구분 없이 항상 같은 라벨이었다(표준 브라우저의 checked 관례와 어긋남). `common.on`/`common.off` 기존 i18n 키로 상태 접미를 추가(`src/App.tsx` desktop-site 라벨). 최종 빌드 재설치 후 관찰: 현재 사이트 프리퍼런스가 Off인 상태에서 `Desktop site · Off` 표시 → 행 탭 → UA `Android 16; Mobile` → `X11; Linux x86_64` 전환 + 자동 재로드 → 메뉴 재오픈 시 `Desktop site · On` → 재탭으로 복원. 증거: `ac5-plus-menu.png`(재캡처), `ac5-desktop-on-label.png`.

- **흐름 완전성 — 관찰됨**: 정지(X) 전환·취소·복귀(사이드바·컴팩트), 링크/이미지 메뉴 5종·4종 액션, 다운로드 저장 + 목록 Completed, 비공개 탭 열기, 찾기 1/2 카운트, 시스템 공유 시트, 데스크톱 전환(UA 전환 + 자동 재로드 + 상태 접미 왕복). 오류 경로(다운로드 실패 배너, 비공개 탭에서 desktop-site 비활성화)는 소스 + 호스트 테스트로만 확인 — 기기 관찰 아님(한계).
- **시각 일관성 — 관찰됨**: 메뉴 시트 아이콘·라벨 정렬·간격이 기존 ActionMenu 체계와 동일(스크린샷), 파스텔 톤 유지, X↔재생 글리프 전환이 진행 바와 함께 자연스럽게 이동. 컴팩트 툴바 버튼 추가 후에도 address pill·Split 버튼 배치 유지(잘림 없음, `ac2-compact-stop.png`).
- **접근성·입력 — 관찰 + 소스**: 신규 버튼 전부 content-desc로 노출(`Stop loading`, `Reload`, 메뉴 행 텍스트 덤프에서 확인 — 관찰). 라벨 i18n(en/ko) 완비, Desktop site 상태 접미도 `common.on/off` 번역 재사용(소스). 탭 타깃 크기는 기존 nav 버튼 규격과 동일하게 유지(소스-only).
- **반응형 — 관찰(델타 한정)**: 이번 변경은 버튼 1개·메뉴 행 추가가 전부라 델타만 관찰 — 컴팩트 모드 배치 유지 확인(위 항). 협소 창·회전 전체는 기존 반응형 체계에 위임, 이번 범위에서 새로 유입된 문제 없음.

판정: **PASS**(수정 1건 반영 완료). 잔여 한계 — 오류 경로 기기 관찰 없음, 보조 창 실측 미실시(위 V-5 기록), 타깃 크기 소스-only.

### G4 추기(2026-11-07, G3 수정 후 재실측)

G3 리뷰가 AC-1의 정상 완료 경로와 비공개 다운로드 확인 플로우의 미관찰을 지적→ 수정(아래 G3 리뷰 결함 참조) 후 두 경로를 재실측해 G4 관찰 범위를 보강했다.

- **정상 로드 완료 후 버튼 복귀(관찰됨)**: 같은 탭 2회 연속 탐색(우발적 canGoBack/Forward 콜백 없는 경로)에서 로드 중 `Stop loading` → 완료 후 `Reload` 복귀. 증거: `g3f1-midload.png`, `g3f1-complete.png`, `g3f1-second-nav.png`.
- **비공개 다운로드 확인 플로우(관찰됨)**: 비공개 탭에서 링크 다운로드 → "Save a private download?" 확인 다이얼로그 표시(메인 스레드) → SAVE FILE → 시스템 Download에 `next (4).html` 저장(MediaProvider/파일 타임스탬프 16:13). 증거: `g3f2-dialog-shown.png`, `g3f2-saved.png`, `g3f2-download-list.png`.

## G3 독립 코드 리뷰 결과와 결함 처리 (2026-11-07)

평가자(Agent, 원 요청·계획·diff·검증기록 전달, 작성자 판정 미포함) 1차 판정 **FAIL** — 재현·분석으로 4건 확인, 3건 수정·1건 기록. 수정 후 관련 게이트 재실행(아래)으로 V-7 PASS.

- **G3-1 (blocker, 수정)** `GeckoSessionRegistry.onPageStop`이 `loading=false`를 BrowserProgress(reportProgress)에만 반영하고 Navigation 채널(`changed()`)로 발신하지 않음 — JS `navigation[tab].loading`이 유일 소비원이라 정상 로드 완료 후 정지 ✕ 버튼이 고정(취소 경로는 롤백 onLocationChange가 우발적으로 changed()를 호출해 작동한 것처럼 보임). 평가자가 작성자의 1차 스크린샷(ac5-find-result.png 등)에서 고정 ✕를 포착. 수정: onPageStop에 `changed(id)` 추가(진행 채널과 동일한 순서). 재검증: g3f1 시리즈(위 G4 추기).
- **G3-2 (major, 수정)** `downloadUrl`의 확인 다이얼로그가 GeckoResult 디스패치에 따라 NativeModules 브리지 스레드에서 create/show — 평가자가 geckoview 157 바이트코드로 GeckoResult 생성-스레드 디스패치를 실증. 추가 실측에서 시트 닫힘 직후 `activity.hasWindowFocus()`가 false인 기각 경로도 확인(임시 계측 로그 `fetch status=200 private=true … focus=false`). 수정: `PrivateDownloadConfirmation.request`를 메인 스레드로 게시 + 포커스 미회복 시 250ms×3 재시도(백그라운드 앱은 재시도 후 기각 유지). 재검증: g3f2 시리즈(위 G4 추기).
- **G3-3 (minor, 수정)** `downloadUrl` 프로미스가 저장 *개시* 시점에 이행(비공개 확인 응답 전 포함), 전송 실패는 목록·알림 이벤트로만 표면화 — `src/platform.ts` 인터페이스 주석에 명시.
- **G3-4 (minor, 기록)** `entries`/`documentGeneration`의 비UI 스레드 읽기는 기존 패턴(`releaseInactive`/`retry` 무랩 호출)의 연장 — 이번 범위에서 추가 수정 없음. `capturePagePdf` 브리지 스레드 블로킹은 트렌치2 소관으로 이관(tranche2 문서 F-12).

수정 후 최종 게이트: `bun test tests` 587 pass / 0 fail, `bunx tsc --noEmit` exit 0, `:app:testDebugUnitTest` BUILD SUCCESSFUL, `./scripts/check.sh` exit 0, 수용 빌드 재설치 후 기기 재검증(g3f1·g3f2).

## G5 완료 평가 (2026-11-07, self-review — 독립 평가는 G3에서 수행)

| AC | 판정 | 근거 |
|---|---|---|
| AC-1 정지 전환·취소·복귀 | PASS(사이드바 관찰; 보조 창은 소스+V-3 한계) | V-5(ac1 시리즈: 로드 중 ✕ → 정지 탭 → 취소 → Reload) + G3-1 수정 후 정상 완료 경로(g3f1-second-nav: 우발 콜백 없는 2회 연속 탐색에서 Reload 복귀). 보조 창(YeoyuWindow)은 동일 stop 커맨드·loading 상태 소비 — 실측 별도 과제로 V-5 기록 |
| AC-2 컴팩트 툴바 | PASS | V-5(ac2-compact-stop: 컴팩트 버튼 신규 배치 + 로드 중 Stop loading). 완료 후 복귀는 AC-1과 동일 상태(navigation[tab].loading)를 소비 — g3f1로 동일 메커니즘 관찰 |
| AC-3 링크 메뉴(비공개 열기·다운로드) | PASS | V-5(ac3 시리즈: 5종 메뉴·저장·목록 Completed·비공개 탭 생성) + G3-2 수정 후 비공개 확인 다이얼로그→SAVE FILE→시스템 저장(g3f2-dialog-shown·next (4).html) |
| AC-4 이미지 메뉴 | PASS | V-5(ac4-image-menu + GET /content-image.png + Download 저장) |
| AC-5 "+" 메뉴 4항목 | PASS | V-5(ac5 시리즈) + 상태 접미(켜짐/꺼짐) 재검증(ac5-plus-menu 재캡처·ac5-desktop-on-label: 토글 왕복 + UA 전환) |
| AC-6 게이트 | PASS | check.sh exit 0, :app:testDebugUnitTest BUILD SUCCESSFUL, bun 587/0, tsc exit 0(최종 상태 재실행) |
| AC-7 연기 항목 기록 | PASS | 상단 연기 섹션 6항목(pull-to-refresh·엣지 스와이프·텍스트 선택 메뉴·탭 스트립·전체 URL 필드·줄 버튼 각 사유) |

**판정: PASS.** 원 요청(표준 브라우저의 자연스러운 관행 전반 추종, 확정 디자인 유지, 연기 항목 사유 기록) 대비 차단 결함·필수 BLOCKED 없음. 잔여 한계(모두 본문 기록): 보조 창 실측 미실시, 다운로드 오류 경로 소스-only 관찰, G3-4 스레드 패턴 기록-only, tranche2 V-1 에뮬레이터 실측 pending(트렌치2 문서), capturePagePdf 브리지 블로킹(tranche2 F-12).

## 수용 기준

| ID | 관찰할 결과 | 태스크 | 검증 |
|---|---|---|---|
| AC-1 | 페이지 로딩 중 확장 사이드바 nav·보조 창의 새로고침 버튼이 ✕(정지)로 바뀌고 누르면 로드가 취소되며 버튼이 복귀한다 | T-1, T-2 | V-3, V-5 |
| AC-2 | 축소 모드 컴팩트 툴바에 새로고침/정지 버튼이 있고 AC-1과 같이 전환한다 | T-1, T-2 | V-5 |
| AC-3 | 링크 길게 누르기 메뉴에 "새 비공개 탭에서 열기"·"링크 다운로드"가 있고, 다운로드는 다운로드 목록에서 완료로 나타난다 | T-3, T-4 | V-1, V-5 |
| AC-4 | 이미지 길게 누르기 메뉴에 "이미지 저장"이 있고 저장 결과가 다운로드 목록에 나타난다 | T-3, T-4 | V-1, V-5 |
| AC-5 | "+" 메뉴에서 페이지 내 찾기·페이지 링크 공유·다운로드 목록·데스크톱 사이트 전환이 동작한다(데스크톱 전환은 저장 후 자동 재로드) | T-5 | V-5 |
| AC-6 | ./scripts/check.sh exit 0 + :app:testDebugUnitTest 통과 | 전체 | V-2, V-3, V-4 |
| AC-7 | 연기 항목(pull-to-refresh·엣지 스와이프·텍스트 선택 메뉴·탭 스트립·전체 URL 필드·줌 버튼)이 사유와 함께 본 문서에 기록됨(위 표) | T-6 | V-6 |

## 위험·한계

- WebExecutor 페치는 기본 프로필 네트워크 스택 사용 — 비공개 탭의 격리 쿠키 보장은 한계로 문서화(표준 브라우저도 파일 자체는 공유 다운로드 저장소에 저장).
- 컴팩트 툴바 폭: 버튼 1개 증가 폭을 실측 확인(AC-2), 좁은 창에서 address pill이 먼저 수축.
- 대용량 다운로드의 취소·재개는 기존 DownloadCoordinator 동작을 그대로 상속(이번에 새로 만들지 않음).
- 직전 tranche2 T-7(에뮬레이터 실측)은 별도 pending — 이번 실측 세션에서 기회적으로 종료 시도, 결과는 tranche2 문서에 기록.

## 도구·환경

- 호스트: bun test, tsc, cargo, ./scripts/check.sh, bun run codegen
- 에뮬레이터: AVD parity-verify/loop-test, 부트 후 `ANDROID_ABIS="x86_64-linux-android" BROWSER_ARCHS=x86 JAVA_HOME=~/.local/share/mise/installs/java/openjdk-17 ANDROID_HOME=/home/loopy/android-sdk PATH=~/.cargo/bin:$PATH ./scripts/build-android.sh Acceptance`
- 평가자: Agent 위임 가능
