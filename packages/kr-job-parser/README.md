# kr-job-parser

**한국 채용공고의 제각각인 표기를 타입이 있는 구조화 데이터로 바꿉니다.**

```ts
import { parseExperience, acceptsNewcomer } from 'kr-job-parser';

parseExperience('경력 3년↑');
// { kind: 'experienced', range: { min: { years: 3, inclusive: true } } }

acceptsNewcomer(parseExperience('신입·경력')); // 'yes'
```

> 현재 버전(v0.1)은 **경력 요건**만 해석합니다. 근무지와 마감일은 [로드맵](#로드맵)에 있습니다.

## 왜 만들었나요?

[Job Alert Hub](../../README.md)에서 여러 채용 사이트의 공고를 모아 "신입이 지원할 수 있는 공고"만 알림으로 보내려고 했습니다. 그런데 같은 의미가 사이트마다, 공고마다 다르게 적혀 있었습니다.

| 의미 | 실제 표기 예시 |
| --- | --- |
| 경력 3년 이상 | `경력 3년 이상`, `경력3년↑`, `경력 3년+`, `3년차 이상`, `경력(3년 이상)` |
| 경력 2~5년 | `경력 2~5년`, `2-5년`, `2년~5년`, `경력 2년 이상 5년 이하` |
| 신입과 경력 모두 | `신입·경력`, `신입/경력`, `경력 1년 이상 (신입 가능)` |
| 경력을 묻지 않음 | `경력무관`, `경력 불문`, `경력 상관없음` |

문자열 비교로는 이 차이를 감당할 수 없어서, 표기를 해석하는 부분을 서비스에서 분리해 독립된 라이브러리로 만들었습니다.

## 설치

```sh
pnpm add kr-job-parser
# npm install kr-job-parser
```

Node.js 22 이상, ESM 전용입니다. 런타임 의존성은 없습니다.

## 사용법

### 경력 요건 해석

```ts
import { parseExperience, type Experience } from 'kr-job-parser';

function describe(experience: Experience): string {
  switch (experience.kind) {
    case 'new':
      return '신입';
    case 'any':
      return '경력무관';
    case 'experienced':
    case 'new-or-experienced':
      return experience.range.min ? `${experience.range.min.years}년 이상` : '경력';
    case 'unknown':
      return `확인 필요: ${experience.raw}`;
  }
}
```

`Experience`는 `kind`로 구분되는 유니온 타입입니다. 새로운 `kind`가 추가되면 위와 같은 `switch`에서 처리하지 않은 경우를 컴파일러가 알려줍니다.

### 지원 가능 여부 판단

```ts
import { fitsYears, acceptsNewcomer, parseExperience } from 'kr-job-parser';

fitsYears(parseExperience('경력 2~5년'), 3); // 'yes'
fitsYears(parseExperience('경력 3년 미만'), 3); // 'no'
acceptsNewcomer(parseExperience('협의')); // 'unknown'
```

결과는 `'yes' | 'no' | 'unknown'` 세 가지입니다. 해석하지 못한 공고를 `false`로 처리하면 지원 가능한 공고를 조용히 놓치게 되므로, 사람이 확인할 수 있게 `unknown`으로 따로 둡니다.

## API

| 함수 | 설명 |
| --- | --- |
| `parseExperience(raw: string): Experience` | 경력 표기를 해석합니다. 예외를 던지지 않으며, 해석하지 못하면 `{ kind: 'unknown', raw }`를 돌려줍니다. |
| `fitsYears(experience, years): Fit` | `years`년 경력의 지원자가 요건에 맞는지 판단합니다. 신입은 1년 미만으로 봅니다. |
| `acceptsNewcomer(experience): Fit` | `fitsYears(experience, 0)`과 같습니다. |
| `normalize(raw: string): string` | 해석 전에 쓰는 정규화 함수입니다. 전각 문자 정리, 공백 제거, 범위·방향 기호 통일을 합니다. |

### 타입

```ts
type Experience =
  | { kind: 'new' }
  | { kind: 'experienced'; range: YearRange }
  | { kind: 'new-or-experienced'; range: YearRange }
  | { kind: 'any' }
  | { kind: 'unknown'; raw: string };

interface YearRange { min?: YearBound; max?: YearBound }
interface YearBound { years: number; inclusive: boolean } // 미만·초과는 inclusive: false

type Fit = 'yes' | 'no' | 'unknown';
```

## 해석 규칙

| 입력 | 결과 |
| --- | --- |
| `신입`, `신입 가능`, `중고신입` | `new` |
| `경력무관`, `경력불문`, `신입/경력무관` | `any` |
| `경력`, `경력직` | `experienced` (연차 조건 없음) |
| `경력 3년` | `experienced`, 3년 이상 (방향 표시가 없으면 이상으로 읽음) |
| `경력 6개월 이상` | `experienced`, 0.5년 이상 |
| `경력 2년 초과`, `경력 3년 미만` | 경계값을 포함하지 않음 (`inclusive: false`) |
| `신입·경력 3년 이상` | `new-or-experienced`, 경력 지원자는 3년 이상 |
| `경력 3년 이상 (신입 지원 불가)` | `experienced` (신입 제외 표기를 인식) |
| `학력무관, 신입` | `new` (`학력무관`을 경력무관으로 오해하지 않음) |
| `인턴`, `협의`, 빈 문자열 | `unknown` |

전체 사례는 [테스트 파일](./test/experience.test.ts)에 표 형태로 정리되어 있습니다.

## 설계 결정

- **예외 대신 `unknown`**: 공고 수천 건을 처리하다가 한 건 때문에 전체가 멈추면 안 됩니다. 해석 실패도 정상적인 결과로 다루고, 원문을 남겨 나중에 규칙을 추가할 근거로 씁니다.
- **경계에 `inclusive`를 둔 이유**: `3년 미만`을 `2년 이하`로 바꾸면 2.5년 경력자가 잘못 제외됩니다. 원문의 의미를 손실 없이 담으려고 경계의 포함 여부를 따로 기록합니다.
- **3단계 판단 결과**: `boolean` 대신 `'yes' | 'no' | 'unknown'`을 써서, "아니다"와 "모르겠다"를 호출하는 쪽이 반드시 구분하게 했습니다.
- **ESM 전용, 의존성 없음**: Node.js 22.12부터 CommonJS에서도 `require(esm)`이 가능해 이중 빌드의 복잡도를 감수할 이유가 줄었습니다. 패키지 설정은 CI에서 [publint](https://publint.dev)와 [Are the types wrong?](https://arethetypeswrong.github.io)로 검사합니다.
- **TypeScript 6.0 고정**: TypeScript 7이 나왔지만 린터(typescript-eslint)가 아직 6.0까지만 지원해 6.0.x에 맞췄습니다.

## 로드맵

- [x] 경력 요건 (`parseExperience`)
- [ ] 근무지: `서울 강남구 외 2곳`, `전국`, `재택 가능` → 시·도/시·군·구 목록
- [ ] 마감일: `상시채용`, `채용시 마감`, `~11/14(금)` → 날짜 또는 마감 유형
- [ ] 원문을 넣어 바로 결과를 보는 CLI

## 개발

```sh
pnpm install
pnpm --filter kr-job-parser test        # 테스트
pnpm --filter kr-job-parser test:coverage
pnpm --filter kr-job-parser lint
pnpm --filter kr-job-parser build
```
