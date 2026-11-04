import { parseArgs } from 'node:util';
import { parseDeadline, type IsoDate } from '../deadline.js';
import { FIELD_NAMES, findField, type Field, type Outcome } from './fields.js';

/** 프로세스에 직접 손대지 않도록 입출력을 주입받는다. 테스트는 가짜 입출력으로 돌린다. */
export interface Io {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  /**
   * 파이프로 들어온 줄들을 여는 함수. 터미널에서 직접 실행해 입력이 없으면 `null`.
   * 원문을 인자로 받은 경우에는 열지 않는다. 열어 두면 입력이 끝나기를 기다리느라 프로세스가 끝나지 않는다.
   */
  readonly stdin: (() => AsyncIterable<string>) | null;
  readonly now: Date;
  readonly version: string;
}

export const EXIT = {
  ok: 0,
  /** `--strict`에서 해석하지 못한 줄이 있었다. */
  unresolved: 1,
  /** 사용법이 틀렸다. */
  usage: 2,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export const HELP = `kr-job-parser — 채용공고의 경력·근무지·마감 표기를 해석합니다

사용법
  kr-job-parser <필드> <원문>          원문 하나를 해석
  <명령> | kr-job-parser <필드>         한 줄에 원문 하나씩 해석하고 해석률을 요약

필드
  experience (exp, 경력)    예: "경력 3년↑", "신입·경력"
  location   (loc, 근무지)  예: "서울 강남구 외 2곳", "전남광주"
  deadline   (dl, 마감)     예: "~11/14(금)", "20261117", "채용시 마감"

옵션
  --json            결과를 JSON으로 출력 (여러 줄이면 JSON Lines)
  --strict          해석하지 못한 줄이 있으면 종료 코드 1
  --today <날짜>    마감 계산 기준일 YYYY-MM-DD (기본: 오늘, 한국 시간)
  -h, --help        도움말
  -v, --version     버전

예시
  npx kr-job-parser exp "경력 3년↑"
  cut -f3 jobs.tsv | npx kr-job-parser location --strict
`;

/** 기준일 기본값. 한국 채용공고이므로 실행 환경의 시간대와 상관없이 한국 날짜를 쓴다. */
export function koreanDate(now: Date): IsoDate {
  // en-CA 로캘은 YYYY-MM-DD 형식으로 출력하므로 템플릿 리터럴 타입과 모양이 같다.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now) as IsoDate;
}

function usage(io: Io, message: string): ExitCode {
  io.stderr(`오류: ${message}\n\n${HELP}`);
  return EXIT.usage;
}

/** 존재하지 않는 날짜까지 걸러내기 위해 파서의 검증을 그대로 쓴다. */
function readToday(value: string | undefined, now: Date): IsoDate | Error {
  if (value === undefined) return koreanDate(now);
  try {
    parseDeadline('', { today: value as IsoDate });
    return value as IsoDate;
  } catch (error) {
    return error instanceof RangeError ? error : new Error(String(error));
  }
}

function line(input: string, outcome: Outcome, json: boolean): string {
  if (json) return JSON.stringify({ input, resolved: outcome.resolved, result: outcome.result });
  return `${outcome.resolved ? '✓' : '✗'} ${input} → ${outcome.text}`;
}

function summary(field: Field, outcomes: readonly (readonly [string, Outcome])[]): string {
  const total = outcomes.length;
  const failures = new Map<string, number>();
  for (const [input, outcome] of outcomes) {
    if (!outcome.resolved) failures.set(input, (failures.get(input) ?? 0) + 1);
  }
  const failed = [...failures.values()].reduce((sum, count) => sum + count, 0);
  const percent = total === 0 ? '-' : `${(((total - failed) / total) * 100).toFixed(1)}%`;
  const top = [...failures]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([input, count]) => `  ✗ ${input} ×${String(count)}`);
  return [`${field.label} 해석 ${String(total - failed)}/${String(total)} (${percent})`, ...top].join('\n');
}

function readArgs(argv: readonly string[]) {
  return parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      json: { type: 'boolean', default: false },
      strict: { type: 'boolean', default: false },
      today: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
  });
}

export async function run(argv: readonly string[], io: Io): Promise<ExitCode> {
  let args: ReturnType<typeof readArgs>;
  try {
    args = readArgs(argv);
  } catch (error) {
    // 모르는 옵션 등. parseArgs는 TypeError를 던진다.
    return usage(io, error instanceof Error ? error.message : String(error));
  }
  const { values, positionals } = args;

  if (values.help) {
    io.stdout(HELP);
    return EXIT.ok;
  }
  if (values.version) {
    io.stdout(`${io.version}\n`);
    return EXIT.ok;
  }

  const [name, ...words] = positionals;
  if (name === undefined) return usage(io, '필드를 지정하세요');
  const field = findField(name);
  if (!field) return usage(io, `알 수 없는 필드 '${name}'. 다음 중 하나를 쓰세요: ${FIELD_NAMES.join(', ')}`);

  const today = readToday(values.today, io.now);
  if (today instanceof Error) return usage(io, today.message);

  // 원문을 인자로 받았으면 그 하나만 해석한다.
  if (words.length > 0) {
    const input = words.join(' ');
    const outcome = field.interpret(input, today);
    io.stdout(`${values.json ? JSON.stringify({ input, resolved: outcome.resolved, result: outcome.result }, null, 2) : line(input, outcome, false)}\n`);
    return values.strict && !outcome.resolved ? EXIT.unresolved : EXIT.ok;
  }

  if (!io.stdin) return usage(io, '해석할 원문을 인자로 주거나 표준 입력으로 넘기세요');

  const outcomes: (readonly [string, Outcome])[] = [];
  for await (const raw of io.stdin()) {
    const input = raw.trim();
    if (!input) continue;
    const outcome = field.interpret(input, today);
    outcomes.push([input, outcome]);
    io.stdout(`${line(input, outcome, values.json)}\n`);
  }
  // 요약은 표준 오류로 보내 JSON Lines 출력을 다른 도구로 바로 넘길 수 있게 한다.
  io.stderr(`${summary(field, outcomes)}\n`);
  return values.strict && outcomes.some(([, outcome]) => !outcome.resolved) ? EXIT.unresolved : EXIT.ok;
}
