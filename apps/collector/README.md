# @job-alert-hub/collector

채용공고를 모아 [`apps/web`](../web)이 읽는 스냅샷을 만들고, [kr-job-parser](../../packages/kr-job-parser)가 원문 표기를 얼마나 해석하는지 리포트를 냅니다. GitHub Actions에서 매일 06:17 KST에 실행됩니다 ([워크플로](../../.github/workflows/collect.yml)).

## 실행

```sh
pnpm build
DATA_GO_KR_KEY=발급받은_일반_인증키 pnpm --filter @job-alert-hub/collector collect [--out <폴더>]
```

| 출력 | 내용 |
| --- | --- |
| `snapshot.json` | 공고 목록. 경력·근무지·마감은 해석하지 않은 원문 그대로입니다. |
| `report.json` | 필드별 해석 성공 수와, 해석하지 못한 원문 상위 10개 |
| 표준 출력·`$GITHUB_STEP_SUMMARY` | 위 리포트를 마크다운 표로 |

기본 출력 폴더는 `apps/web/data/live/`이며 Git에는 올리지 않습니다. 인증키는 [공공데이터포털](https://www.data.go.kr/data/15125273/openapi.do)에서 활용 신청하면 자동 승인됩니다. 일반 인증키(Decoding)를 쓰고, 앞뒤 공백·줄바꿈은 수집기가 잘라냅니다.

## 구조

```
src/
├─ providers/
│  ├─ provider.ts   # Provider 인터페이스, ProviderError
│  └─ alio.ts       # 공공데이터포털 · 잡알리오 어댑터
├─ job.ts           # 수집처와 무관한 공고 형식(CollectedJob), 스냅샷 형식
├─ collect.ts       # 수집처를 돌려 스냅샷으로 묶기, 한국 날짜 계산
├─ report.ts        # 해석률 리포트
└─ cli.ts           # 실행 진입점 (파일 쓰기, 종료 코드)
```

새 수집처는 `Provider`를 구현해 `cli.ts`의 목록에 추가합니다. 파서·리포트·웹 코드는 바꾸지 않습니다.

## 설계 결정

- **원문만 저장합니다.** 해석을 수집 단계에서 하면 파서 규칙을 고칠 때마다 다시 수집해야 합니다. 웹이 화면을 그릴 때 해석하므로 규칙 수정이 바로 반영됩니다.
- **응답은 런타임에 검증합니다.** 외부 API 응답에 `as`로 타입을 단언하지 않고 `isAlioItem` 타입 가드로 확인합니다. 형식이 틀린 항목은 건너뛰고 수를 세어 스냅샷에 남깁니다. 한 건 때문에 수집 전체가 멈추지 않게 하기 위해서입니다.
- **키 오류는 코드로 구분합니다.** `SERVICE_KEY_IS_NOT_REGISTERED_ERROR`처럼 다시 시도해도 소용없는 오류는 `ProviderError`의 `code`로 알립니다. 요청 URL에는 인증키가 들어 있어 오류 메시지에 넣지 않습니다.
- **`fetch`를 주입받습니다.** 테스트는 실제 응답을 저장한 fixture와 가짜 `fetch`로 네트워크 없이 페이지 나눔, 오류 봉투, 잘못된 항목 처리를 확인합니다.
- **마감 계산은 한국 날짜로 합니다.** Actions 실행기는 UTC 기준이라, 06:17 KST 실행이 전날 날짜로 계산되지 않도록 `Asia/Seoul` 날짜를 씁니다.

## 개발

```sh
pnpm --filter @job-alert-hub/collector lint
pnpm --filter @job-alert-hub/collector typecheck
pnpm --filter @job-alert-hub/collector test:coverage
```
