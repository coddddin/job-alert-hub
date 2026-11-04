# Job Alert Hub — 자동 수집처 발견·검증·확장 개발 계획 (2026-11-05)

> **상태:** 설계 제안 / 미구현. Claude, ChatGPT, Codex 등 후속 개발 에이전트를 위한 인수인계 문서.
> **변경 범위:** 이 문서만 추가. README, 현재 수집 코드, 배포 설정, 데이터 파일은 수정하지 않는다.
> **목표:** 기존 공공기관 채용공고 수집을 유지하면서, 민간 플랫폼의 공식 API에 의존하지 않고 허용된 공개 채용 페이지에서 최대한 폭넓게 공고를 자동 확보한다. 공통 데이터셋을 로그인 사용자별로 개인화한다.

## 0. 확정 요구사항 및 비목표

- 자동 발견 → 접근·재사용 조건 및 추출 검증 → 승인된 수집처 정기 수집 → 통합 아카이브 → 사용자별 검색·추천·알림.
- 수집은 사용자마다 따로 실행하지 않고 공통 데이터셋에 수행한다. 사용자별 조건은 저장·검색·추천·알림 계층에서 적용한다.
- 민간 잡코리아·사람인·원티드 등 **공식 API 연동은 이번 개발 범위에서 제외**한다. 이미 운영 중인 공공기관 API는 유지한다.
- 잡코리아·사람인 등의 자동화 차단을 우회하거나 비공개 API, CAPTCHA 우회, 세션·쿠키 탈취, 로그인 자동화로 접근하지 않는다.
- 외부 페이지의 공개 열람 가능성만으로 복제·장기 보관·재게시 권한이 확보되는 것은 아니다. 이용약관, robots 정책, 라이선스, 개인정보, 재사용 조건을 별도로 확인한다.
- 검색 색인·웹 아카이브는 발견/보조 검증 수단이지 전체 공고의 안정적 공급원이 아니다. 접근·이용 권한과 신선도 검증 없이 수집 데이터로 사용하지 않는다.
- 전체 민간 채용공고 100% 확보 또는 즉시 갱신을 보장하지 않는다.
- 사용자 승인 없이 main 병합, 기존 파일 삭제, 유료 서비스 활성화, 비밀키 추가/노출 금지.

## 1. 현재 프로젝트와 통합 지점

기존 저장소의 `apps/collector` 기반 공공 데이터 수집, `packages/kr-job-parser`, `apps/web`, `snapshot.json`, GitHub Actions 일일 실행 흐름을 유지한다. 실제 경로와 인터페이스는 구현 직전 최신 main에서 재확인한다. 기존 `docs/PROJECT_DESIGN.md`는 이전 설계로 남겨두고 이 문서를 신규 로드맵으로 활용한다. 기존 문서에 기재된 민간 API 우선순위는 이 계획에서는 적용하지 않는다.

권장 파이프라인:

```text
Discovery seeds / approved search sources / company career links
  -> Candidate registry (discovered, pending_review)
  -> Policy & extraction validation (approved / review / rejected)
  -> Site/ATS adapters + scheduler (rate-limited)
  -> Normalization -> duplicate resolution -> freshness/closure checks
  -> Archive database -> existing parser/web adapter
  -> Logged-in user's saved filters/ranking -> notifications
```

## 2. 핵심 설계: 자동 발견과 자동 검증 분리

### Discovery
- 초기 seed: 기업 공식 도메인, 공개 ATS 유형, 사이트맵, 공식 채용 링크, 허용된 공개 피드. 검색 서비스는 정식 제공 방식/이용조건 내에서만 사용.
- 후보 발견 시 URL canonicalization, 도메인 정규화, 중복 제거, 소스/발견 시각/발견 경로 기록.
- 링크 추적은 허용된 범위와 깊이·도메인 한도로 제한. 검색엔진 결과를 무단 대량 스크래핑하지 않는다.
- ATS 식별은 URL/공개 HTML 구조 등 근거 기반. 식별 불확실 시 `unknown`.
- 발견은 **승인과 별개**이며, 발견 즉시 수집 스케줄에 투입하지 않는다.

### Validation
- 단계 A: DNS/HTTPS/접근성, robots.txt, 명시적 이용조건/라이선스 및 재게시 권한 확인. 자동 판단이 불가능하면 `needs_human_review`.
- 단계 B: 실제 채용 목록/상세 여부, 구조화 데이터(JSON-LD JobPosting 등), 제목·회사·원문 URL 등 필수 필드 추출 검증.
- 단계 C: 날짜·마감·근무지·경력 필드 품질, 중복/광고/교육생 모집 구별, 안정적인 공고 식별자 유무.
- 단계 D: 소량 샘플을 이용한 반복 검증, 오류·변경 감지, 도메인별 속도 제한 및 backoff.
- **자동 승인 조건:** 수집 및 해당 활용 범위에 대한 허용 근거가 기록되고, 기술 검증을 통과한 경우에 한정. 단순히 200 OK 또는 robots 허용만으로 승인하지 않는다.
- 조건 불명확, 로그인 필요, 자동화 금지, 차단 응답 등은 수집 제외 또는 수동 검토. 차단 회피 시도 금지.

### 상태 모델
`discovered -> validating -> approved | needs_human_review | rejected`
`approved -> active -> degraded | paused -> validating`

상태 전환 사유, 근거 URL, 검사 시각, 검사 버전, 담당자 승인 기록을 남긴다. 검증 실패 시 기존 데이터를 임의 삭제하지 말고 신선도 경고를 부여한다.

## 3. 최소 데이터 모델 (초안)

`source_candidates`: id, canonical_url, domain, discovery_method, discovered_at, state, evidence_urls, notes.

`sources`: id, canonical_url, source_type, adapter_type, policy_status, reuse_scope, review_evidence, approved_at, last_checked_at, last_success_at, next_check_at, health_status, error_count, rate_limit_config.

`jobs`: id, source_id, external_id(nullable), canonical_job_url, company, title, location, experience, employment_type, posted_at(nullable), deadline_at(nullable), first_seen_at, last_seen_at, content_hash, lifecycle_status, raw_reference, parsed_reference.

`job_observations`: job_id, observed_at, content_hash, extraction_version, changed_fields, source_response_metadata (민감정보 제외).

`user_profiles`: user_id, saved_filter_json, notification_preferences, updated_at.

필수 제약: `(source_id, external_id)` 또는 canonical URL 기반 유니크 키, 소스 간 동일 공고는 별도 cross-source 연결. 회사·제목 유사도만으로 자동 병합하지 않는다. 저장/보관 기간과 원문 재게시 범위는 공급원별 정책으로 제한.

## 4. 구현 방식

- 공통 `SourceAdapter` 인터페이스: `discover()`, `validate()`, `fetchListings()`, `fetchDetails()`(선택), `normalize()`; 기능 미지원 시 명시적 결과 반환.
- 일반적인 ATS 유형을 먼저 구현하고 기업별 예외는 작은 어댑터로 분리. JSON-LD JobPosting/공개 사이트맵/허용된 피드를 우선 사용.
- HTML 파싱은 명시적 선택자·구조화 데이터 우선; DOM 변화 감지 시 자동 중지 및 재검증.
- 스케줄러는 도메인별 concurrency, 간격, 재시도, 지수 backoff, ETag/Last-Modified 활용(지원 시), 실패 격리 적용.
- 원본 보관은 필요한 최소 범위로 제한. 재배포 권한이 불명확한 전문을 저장하거나 사용자에게 재게시하지 않는다.
- 최초에는 SQLite 등 소규모 영속 저장소와 기존 GitHub Actions 실행 가능성을 비교한다. 사용자 계정/다중 사용자 운영 시 서버 DB·인증·권한분리가 필요할 수 있으며 GitHub Pages 단독으로 비밀 데이터/인증을 처리하지 않는다.
- 인증은 검증된 공급자 기반, 사용자별 데이터 접근 통제, 최소 개인정보, 삭제·내보내기 정책 포함. 알림은 중복 방지 및 명시적 동의 후 활성화.

## 5. 단계별 PR 계획 및 완료 기준

| PR | 범위 | 완료 기준 |
| --- | --- | --- |
| PR-01 | 소스 상태 모델, 데이터 계약, 테스트 픽스처 | 기존 공공 수집 회귀 테스트 통과; 후보/승인/거절 상태 저장 |
| PR-02 | 자동 발견 MVP (공식 기업 채용 링크/사이트맵/ATS seed) | 알려진 테스트 사이트에서 후보 자동 등록; URL 중복 방지; 범위 제한 |
| PR-03 | 정책·추출 검증 MVP | 승인 근거/검토 필요 구분; 필수 필드 테스트; 차단·불명확 사이트는 자동 수집 금지 |
| PR-04 | 첫 종단간 수집 | 허용된 실제 소스 5~10개를 목표로 후보 조사, 확보 가능한 곳만 연결; 신규 공고가 기존 웹에 표시됨 |
| PR-05 | 정기 수집·품질 관리 | 변경·마감·중복·오류·재검증 처리; 소스별 상태 및 로그 |
| PR-06 | 데이터 확대·운영 지표 | 수집처 추가, 수집 성공률·유효 신규 공고·중복률·최신성 측정 |
| PR-07 | 사용자 로그인·개인화 | 저장 조건별 검색/추천, 사용자 데이터 격리, 비로그인 전체 검색 유지 |
| PR-08 | 알림·운영 자동화 | 사용자 동의 기반 맞춤 알림, 중복 방지, 실패 재시도 |

번호는 작업 순서를 나타내며 실제 GitHub PR 번호를 예약한 것은 아니다. 각 PR은 별도 브랜치, 테스트, 변경 파일 목록, 리스크와 롤백 방법을 포함한다. README 변경은 별도 사용자 승인 전 금지.

## 6. MVP 실험과 평가

초기에는 **발견 → 검증 → 실제 수집 → 웹 표시**를 한 번에 검증한다. 5~10개는 목표치이지 권한이 없는 사이트를 억지로 채우는 할당량이 아니다.

측정:
- 발견 후보 수 / 중복 제거 후 고유 후보 수
- 자동 검증 통과 / 수동 검토 / 거절 비율
- 실제 수집 가능한 소스 수 및 소스별 유효 신규 공고 수
- 추출 필수 필드 완성도 / 중복률 / 마감 오판율
- 마지막 정상 수집 시각 / 신규 공고 발견 지연 / 장애 복구 시간
- 사용자별 필터 정확도 / 잘못된 알림 비율

테스트: 고정 HTML/JSON-LD 픽스처, robots/정책 불명확 사례, 403/429/5xx, 리다이렉트, 중복 URL, 구조 변경, 공고 삭제와 일시 오류 구분, 네트워크 timeout, 기존 ALIO 수집 회귀. 외부 사이트에 대한 테스트는 허용된 범위에서만 수행.

## 7. 에이전트 인수인계 지침

1. 이 문서와 `README.md`, `docs/PROJECT_DESIGN.md`, 현재 소스/워크플로/열린 PR을 읽고 실제 구현 상태를 검증한다. 문서의 계획을 구현 완료로 취급하지 않는다.
2. main의 미병합 작업과 기존 PR을 보호한다. README 수정 금지, 삭제·유료 서비스·main 병합 금지.
3. 가장 작은 수직 기능(후보 발견→검증→1개 허용된 소스 수집→웹 표시)을 우선한다. 프레임워크 전면 교체를 피한다.
4. 정책상 불확실한 소스는 자동 승인하지 말고 사용자에게 확인할 항목을 보고한다.
5. PR마다 변경 파일, 테스트 결과, 수집 권한 근거, 신규 공고 실측, 잔여 위험, 다음 단계 및 롤백을 보고한다.
6. 외부 검색/ATS 제공 방식은 시점에 따라 달라질 수 있으므로 구현 시 공식 사이트 정책을 새로 확인한다.

## 8. 즉시 다음 작업

- 현재 main 및 열린 PR과 충돌 분석.
- 기존 수집 파이프라인과 정규화 계약 파악.
- PR-01 데이터 모델/픽스처/회귀 테스트부터 시작.
- 동시에 허용된 공개 ATS/기업 채용 페이지를 소수 조사하여 PR-04의 실측 대상을 확보.
- 실제 코드 구현은 별도 작업 PR에서 수행하며 이 문서 PR은 설계 검토용으로 유지한다.
