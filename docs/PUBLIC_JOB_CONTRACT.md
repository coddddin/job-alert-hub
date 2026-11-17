# 공개 공고 추출 계약과 선택형 통합

2026-11-14. 이 구현은 [PR #14](https://github.com/coddddin/job-alert-hub/pull/14)의
발견·검증·운영 수집 분리 방향과 [PR #17](https://github.com/coddddin/job-alert-hub/pull/17)의
Scrapling 실험을 바탕으로 한다. 두 PR은 main에 병합하지 않았다.

## 기존 실험과 이번 범위

PR #14는 구현되지 않은 로드맵이다. 후보 등록, 소스 상태 DB, 일정 실행, 아카이브,
로그인·알림은 이 PR에서도 구현 완료로 취급하지 않는다.
PR #17은 가상 공고 카드 파싱과 잡코리아 링크 개수·페이지 제목 진단이다.
123개 링크 발견은 123개 공고의 필드 정확도를 의미하지 않는다. Python 의존성도
`>=0.5.1,<1.0` 범위였다. 이번 독립 도구는 검증 버전 `0.5.1`을 고정한다.

기존 `CollectedJob`, `Snapshot` v1, `Provider`, ALIO 구현, 기본 CLI, 일일 워크플로,
웹 코드와 README는 변경하지 않는다. 새 Provider는 명시적으로 전달할 때만 작동한다.
Python 프로세스를 TypeScript 수집 중 실행하거나 네트워크를 호출하지 않는다.
PR #17 코드를 main에 복사하거나 해당 실험 워크플로를 활성화하지 않는다.

## 언어 간 계약 v1

Python `extract.py` → JSON 파일 → TypeScript `readPublicBatch(unknown)` →
`publicJobs()` → 기존 `collect()` → 기존 웹이 읽는 Snapshot v1.

최상위: `version: 1`, `source: "jobkorea"`, `jobs: PublicJobObservation[]`.
현재 지원 소스는 잡코리아 상세 페이지 하나다. 다른 사이트를 이 소스 이름으로
가장하지 않으며, 다른 소스는 별도 extractor와 경계 검증기를 추가해야 한다.
정식 타입과 런타임 검증은 `apps/collector/src/providers/public-jobs.ts`에 있다.

각 관측값의 필수 항목:

- `externalId`: 숫자로만 이루어진 원본 공고 ID.
- `url`: `https://www.jobkorea.co.kr/Recruit/GI_Read/<externalId>`.
  Python 입력의 추적 쿼리·fragment는 제거한다. 다른 호스트, 인증정보, HTTP, 다른 경로는 거부한다.
- `observedAt`: 실제 관측 시각, UTC ISO 8601. Snapshot 수집 시각과 구별된다.
- `extractorVersion`: `jobkorea-detail/1`.
- `fields`: `company`, `title`, `location`, `experience`, `deadline` 다섯 필드.
- `warnings`: DOM/구조화 데이터 차이, 잘못된 JSON-LD 등 진단 문자열 목록.

각 필드는 `{value, status, evidence}`다. `status: "extracted"`이면 값·근거가
비어 있지 않은 문자열(각 4,000자 이하)이어야 한다. `missing` 또는 `conflict`이면
값·근거는 모두 `null`이다. `extracted`는 추출했다는 뜻이며 정확도 검증 완료나
신뢰도 점수를 의미하지 않는다. 근거는 선택자/JSON-LD 경로이고 원문 전문은 저장하지 않는다.
출처의 진위나 재사용 허가를 인증하는 보안 서명은 아니다.

잘못된 envelope/버전/소스는 오류, 잘못된 개별 행은 `skipped`로 집계한다.
동일 ID가 여러 번 나오면 전체 그룹을 격리하여 입력 순서로 공고 내용을 결정하지 않는다.
회사명·제목 누락/충돌은 공고 제외. 선택 필드 누락/충돌은 기존 `raw`의 빈 문자열로
옮기고 파서에서 미상으로 처리한다. 빈 값을 경력무관·상시채용·전국으로 보정하지 않는다.
`total = jobs.length + skipped`이며 링크 발견 수와 다르다.

원문은 공백만 정리한다. 날짜 추론·경력 연차 해석은 `kr-job-parser`가 맡는다.
회사 홈페이지는 알 수 없으므로 `url`과 `applyUrl` 모두 원본 상세 주소다.
미검증 직무를 개발 직군으로 분류하지 않도록 `kind: "other"`, 나머지 미수집
분류/상세 정보는 빈 값 또는 `null`이다. 개발 직군 기본 필터에서는 제외될 수 있다.
관측 메타데이터와 경고는 staging JSON에 남으며 기존 Snapshot 계약에는 추가하지 않는다.
종료 공고도 관측 가능하며 공고 생애주기 확정이나 신규 공고 판정은 아직 구현하지 않았다.

## 추출 우선순위와 실패 처리

현재 URL에 일치하는 JSON-LD `JobPosting`만 사용한다. 배열·`@graph`를 지원하고
추천 공고/다른 URL의 메타데이터는 무시한다. 회사·제목은 JSON-LD와 h2/h1을
대조해 값이 충돌하면 격리한다. 구조화 데이터가 없을 때 일반 페이지 제목을 공고로 추측하지 않는다.

근무지·경력은 `RecruitmentItem` / `QualificationItem`의 명시적 항목 레이블을
우선한다. 지도보기 버튼은 제외한다. 상세에서 JSON-LD 경력 `경력`이 화면의
`경력 (3년이상)`을 생략하는 문제를 확인해 DOM 원문을 보존한다.
마감일은 항목 레이블로 찾으며 비활성 탭의 명시적 마감일도 읽는다.
선택자를 못 찾으면 JSON-LD로 돌아가므로 정보가 덜 상세할 수 있다. `evidence`로
구분하며 향후 DOM 변경 알림/소스 일시 정지 정책이 필요하다.
JSON-LD의 객체형 경력 요건은 아직 변환하지 않고 미상으로 둔다.

라이브 실행은 `--live`로만 요청한다. 자동 CI는 합성 HTML만 사용한다.
HTTP timeout 20초, 재시도 0, redirect 미추적이며 상태가 200이 아니면 실패한다.
샘플 명령은 검색 1회와 상세 최대 3회, 요청 사이 2초 간격으로 제한한다.
실패하면 이미 얻은 표본과 오류를 출력하고 종료 코드 1로 중지한다.
일반 Fetcher를 사용하며 로그인·유료 서비스·브라우저 설치는 필요하지 않다.
사이트 이용 조건 재검토는 사용자가 해당 제약을 철회해 이번 작업 범위에 포함하지 않았다.
재사용 권한 확인 완료를 주장하지 않으며 정기 수집·재게시도 활성화하지 않았다.

## 실행

가상환경에서 `python -m pip install -r tools/public-jobs/requirements.txt`를 실행한다.
Windows에서는 해당 가상환경의 Python 실행 파일을 사용한다.

```sh
python -m unittest discover -s tools/public-jobs -p 'test_*.py' -v
python tools/public-jobs/extract.py --html tools/public-jobs/fixtures/detail.html --url https://www.jobkorea.co.kr/Recruit/GI_Read/10000001 --out .scrapling-local/batch.json
pnpm --filter kr-job-parser exec tsc -p tsconfig.build.json
pnpm --filter @job-alert-hub/collector exec tsc -p tsconfig.build.json
node tools/public-jobs/import.mjs --input .scrapling-local/batch.json --out .scrapling-local/new-preview
node tools/public-jobs/verify-import.mjs .scrapling-local/new-preview/snapshot.json
```

`import.mjs`는 반드시 출력 디렉터리를 지정하고, 기존 `snapshot.json`이 있으면
`wx`로 실패해 덮어쓰지 않는다. 기본 ALIO 경로로 자동 저장하지 않는다.
ALIO와 결합할 때는 호출자가 검증된 `publicJobs(batch)`를 Provider 배열에 명시적으로
추가한다. 기본 운영 CLI는 이 선택을 하지 않는다. 배치 읽기 실패는 운영에 추가하기 전
격리해야 한다. 병행 수집 회귀 테스트는 기존 ALIO 출력이 동일함을 검증한다.

라이브 추출은 `--html ...` 대신 `--live`를 주고 실제 상세 URL을 지정한다.
`sample_live.py --count 2`는 표본과 별도의 DOM 대조 근거를 출력한다.
`inspect_live.py URL`은 한 상세의 레이블 근거를 확인하는 보조 명령이다.
`.scrapling-local/`, 가상환경과 Python 캐시는 git에서 제외한다.

`evaluate.py labels.json`의 입력은 `{expected, observation}` 목록이다.
expected는 추출 결과를 복사하지 않고 원문을 별도로 검토해 입력해야 한다.
필드 생략은 미검토, 명시적 null은 원문에 없음을 확인한 경우다.
완성도는 추출값 수/원문 존재 수, 정확도는 공백 정리 후 정확히 일치한 수/원문 존재 수다.
없는데 추출한 값은 false positive로 별도 집계한다. 분모가 0이면 비율은 null이다.

## 검증 결과와 한계 (2026-11-14 KST)

- Scrapling 0.5.1, 로컬 Python 3.13.1 / Node 24.14.1.
- [종료 공고 48683167](https://www.jobkorea.co.kr/Recruit/GI_Read/48683167),
  [상시 공고 49998092](https://www.jobkorea.co.kr/Recruit/GI_Read/49998092): HTTP 200.
  각각 회사·제목·근무지·경력·마감 5개를 별도 DOM 발췌와 수동 대조해 **10/10 일치**.
  코드 작성 에이전트의 대조이며 독립된 사람의 이중 검수는 아니다.
- 검색 화면에서는 121개 고유 상세 URL을 관측했다. PR #17의 123개와 시점이 다르다.
  이번 관측도 전체 사이트 공고 수나 성공 추출 수가 아니다.
- 추가 상세 50063965는 HTTP 307. 추적하지 않고 실패로 기록했으며 정확도 분모에서 제외했다.
  고유 상세 3건 시도 중 2건 평가 가능. 개발 중 같은 표본을 재요청한 횟수는 고유 공고 수와 다르다.
- 필드별 2/2 일치지만 표본이 매우 작고 대표성이 없다. 전체 사이트 정확도 100%를 주장하지 않는다.
  집계·대상 URL은 `tools/public-jobs/live-validation-2026-11-14.json`에 남긴다.
  실제 원문 전문과 대조용 지역 파일은 커밋하지 않는다. CI 재현은 합성 fixture로 한다.
- Python 테스트 14개 통과. collector 테스트 83개 및 ALIO 병행 회귀 통과.
  웹 테스트 39개 통과. Python → TypeScript → Snapshot의 5개 필드 왕복 검증 통과.
- TypeScript 빌드·린트·타입 검사와 publint 통과.
  로컬 파서 테스트는 230개 통과, 기존 CLI 테스트 3개가 Windows URL.pathname 경로 문제로 실패했다.
  기존 테스트 코드는 변경하지 않았고 Linux CI 결과를 별도로 확인한다.
  로컬 pnpm 11은 sandbox symlink 오류로 직접 설치된 도구를 실행했다.
  초기 웹 테스트는 localhost 권한/미빌드 문제였고 빌드와 실행 권한을 적용한 재실행에서 39개 통과했다.

미검증: 사이트별 다른 레이아웃, 이미지/iframe 안의 조건, DOM과 JSON-LD의 의미상 충돌,
다중 근무지 실표본, 경력무관/채용시마감 실표본, 대량·장기간 안정성, 개인정보/재게시 범위,
다른 사이트, 새 공고 식별, 실제 ALIO API 호출(회귀는 고정 응답), 운영 배포.
데이터 계약은 인증/신뢰도 보증이 아니며 외부 JSON 파일의 출처 검토가 필요하다.

다음 단계는 독립 검수된 다양한 표본 확대, 구조 변경 감지, 소스 상태/보관 정책과
운영 실패 격리다. 롤백은 새 Provider를 선택하지 않고 실험 명령/워크플로를 중지하는 것으로
가능하다. 기본 운영 경로는 이번 변경에 의존하지 않는다.
