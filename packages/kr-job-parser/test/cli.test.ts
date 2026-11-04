import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { describeDeadline, describeExperience, describeLocation } from '../src/cli/describe.js';
import { EXIT, HELP, koreanDate, run, type Io } from '../src/cli/run.js';

/** 출력을 모으는 가짜 입출력. `lines`를 주면 파이프 입력이 있는 것처럼 동작한다. */
function fakeIo(lines?: readonly string[]): Io & { out: string; err: string } {
  const io = {
    out: '',
    err: '',
    stdout: (text: string) => {
      io.out += text;
    },
    stderr: (text: string) => {
      io.err += text;
    },
    stdin: lines ? () => Readable.from(lines) : null,
    now: new Date('2026-11-03T03:00:00Z'),
    version: '9.9.9',
  };
  return io;
}

describe('run: 원문 하나', () => {
  it.each([
    [['exp', '경력 3년↑'], '✓ 경력 3년↑ → 경력 3년 이상\n'],
    [['경력', '신입', '가능'], '✓ 신입 가능 → 신입\n'],
    [['loc', '서울 강남구 외 2곳'], '✓ 서울 강남구 외 2곳 → 서울 강남구 · 외 2곳\n'],
    [['location', '전남광주'], '✓ 전남광주 → 광주 · 전남\n'],
    [['dl', '~11/14 18:00'], '✓ ~11/14 18:00 → 2026-11-14 (토) 18:00 마감\n'],
    [['마감', '20261117'], '✓ 20261117 → 2026-11-17 (화) 마감\n'],
  ])('%j', async (argv, expected) => {
    const io = fakeIo();
    expect(await run(argv, io)).toBe(EXIT.ok);
    expect(io.out).toBe(expected);
  });

  it('인자로 원문을 받으면 표준 입력을 열지 않는다', async () => {
    let opened = false;
    const io = {
      ...fakeIo(),
      stdin: () => {
        opened = true;
        return Readable.from(['x']);
      },
    };
    await run(['exp', '신입'], io);
    expect(opened).toBe(false);
  });

  it('--json은 파서 결과를 그대로 낸다', async () => {
    const io = fakeIo();
    await run(['exp', '경력 3년↑', '--json'], io);
    expect(JSON.parse(io.out)).toEqual({
      input: '경력 3년↑',
      resolved: true,
      result: { kind: 'experienced', range: { min: { years: 3, inclusive: true } } },
    });
  });

  it('--strict면 해석하지 못했을 때 종료 코드 1', async () => {
    expect(await run(['loc', '해외', '--strict'], fakeIo())).toBe(EXIT.unresolved);
    expect(await run(['loc', '해외'], fakeIo())).toBe(EXIT.ok);
  });

  it('--today로 기준일을 바꾼다', async () => {
    const io = fakeIo();
    await run(['dl', 'D-3', '--today', '2026-12-30'], io);
    expect(io.out).toContain('2027-01-02');
  });

  it('기본 기준일은 한국 날짜다', () => {
    expect(koreanDate(new Date('2026-11-03T15:00:00Z'))).toBe('2026-11-04');
  });
});

describe('run: 표준 입력', () => {
  it('줄마다 해석하고 요약은 표준 오류로 보낸다', async () => {
    const io = fakeIo(['서울,전남광주', '해외', '  ', '전국', '해외']);
    expect(await run(['loc'], io)).toBe(EXIT.ok);
    expect(io.out.trim().split('\n')).toEqual([
      '✓ 서울,전남광주 → 서울 · 광주 · 전남',
      '✗ 해외 → 근무지 없음 (해석하지 못함: 해외)',
      '✓ 전국 → 전국',
      '✗ 해외 → 근무지 없음 (해석하지 못함: 해외)',
    ]);
    expect(io.err).toBe('근무지 해석 2/4 (50.0%)\n  ✗ 해외 ×2\n');
  });

  it('--json이면 JSON Lines를 낸다', async () => {
    const io = fakeIo(['신입', '경력']);
    await run(['exp', '--json'], io);
    const rows = io.out.trim().split('\n').map((row) => JSON.parse(row) as { input: string; resolved: boolean });
    expect(rows.map(({ input, resolved }) => [input, resolved])).toEqual([
      ['신입', true],
      ['경력', true],
    ]);
  });

  it('--strict면 한 줄이라도 실패하면 종료 코드 1', async () => {
    expect(await run(['dl', '--strict'], fakeIo(['상시', '협의']))).toBe(EXIT.unresolved);
    expect(await run(['dl', '--strict'], fakeIo(['상시']))).toBe(EXIT.ok);
  });

  it('실패가 많은 순서로 최대 5개를 보여준다', async () => {
    const io = fakeIo(['a', 'b', 'b', 'c', 'd', 'e', 'f']);
    await run(['exp'], io);
    expect(io.err.split('\n').slice(1, 7)).toEqual(['  ✗ b ×2', '  ✗ a ×1', '  ✗ c ×1', '  ✗ d ×1', '  ✗ e ×1', '']);
  });

  it('빈 입력이면 해석률 대신 -', async () => {
    const io = fakeIo([]);
    await run(['exp'], io);
    expect(io.err).toBe('경력 해석 0/0 (-)\n');
  });
});

describe('run: 사용법', () => {
  it.each([
    [[], '필드를 지정하세요'],
    [['toString', 'x'], "알 수 없는 필드 'toString'"],
    [['exp', '--unknown'], 'Unknown option'],
    [['dl', 'x', '--today', '2026-02-30'], '올바른 날짜'],
    [['exp'], '표준 입력으로 넘기세요'],
  ])('%j', async (argv, message) => {
    const io = fakeIo();
    expect(await run(argv, io)).toBe(EXIT.usage);
    expect(io.err).toContain(message);
    expect(io.err).toContain('사용법');
    expect(io.out).toBe('');
  });

  it.each([['-h'], ['--help']])('%s', async (flag) => {
    const io = fakeIo();
    expect(await run([flag], io)).toBe(EXIT.ok);
    expect(io.out).toBe(HELP);
  });

  it('-v', async () => {
    const io = fakeIo();
    await run(['-v'], io);
    expect(io.out).toBe('9.9.9\n');
  });
});

describe('describe', () => {
  it.each([
    [{ kind: 'new' }, '신입'],
    [{ kind: 'any' }, '경력무관'],
    [{ kind: 'experienced', range: {} }, '경력'],
    [{ kind: 'experienced', range: { min: { years: 2, inclusive: false } } }, '경력 2년 초과'],
    [{ kind: 'experienced', range: { max: { years: 5, inclusive: true } } }, '경력 5년 이하'],
    [{ kind: 'new-or-experienced', range: { min: { years: 0.5, inclusive: true }, max: { years: 3, inclusive: false } } }, '신입 또는 경력 6개월 이상 3년 미만'],
    [{ kind: 'unknown', raw: '?' }, '해석하지 못함'],
  ] as const)('경력 %j → %s', (experience, text) => {
    expect(describeExperience(experience)).toBe(text);
  });

  it.each([
    [{ places: [], nationwide: false, remote: 'full', others: 0, unparsed: [] }, '재택'],
    [{ places: [{ sido: '서울' }], nationwide: false, remote: 'partial', others: 'unknown', unparsed: [] }, '서울 · 외 다수 · 재택 병행'],
    [{ places: [], nationwide: false, remote: 'none', others: 0, unparsed: [] }, '근무지 없음'],
  ] as const)('근무지 %j → %s', (location, text) => {
    expect(describeLocation(location)).toBe(text);
  });

  it.each([
    [{ kind: 'date', date: '2026-11-14' }, '2026-11-14 (토) 마감'],
    [{ kind: 'rolling' }, '상시 채용'],
    [{ kind: 'until-filled' }, '채용 시 마감'],
    [{ kind: 'unknown', raw: '?' }, '해석하지 못함'],
  ] as const)('마감 %j → %s', (deadline, text) => {
    expect(describeDeadline(deadline)).toBe(text);
  });
});

/** 빌드 결과물을 실제 프로세스로 실행해 본다. CI는 build 다음에 test를 돌린다. */
describe.skipIf(!existsSync(new URL('../dist/cli/bin.js', import.meta.url)))('bin (빌드 결과물)', () => {
  const bin = new URL('../dist/cli/bin.js', import.meta.url).pathname;

  it('원문 하나를 해석하고 끝난다', () => {
    expect(execFileSync('node', [bin, 'exp', '경력 3년↑'], { encoding: 'utf8', timeout: 10_000 })).toBe('✓ 경력 3년↑ → 경력 3년 이상\n');
  });

  it('파이프 입력을 읽고 종료 코드를 돌려준다', () => {
    const result = spawnSync('node', [bin, 'loc', '--strict'], { input: '서울\n해외\n', encoding: 'utf8', timeout: 10_000 });
    expect(result.status).toBe(EXIT.unresolved);
    expect(result.stderr).toContain('근무지 해석 1/2 (50.0%)');
  });

  it('package.json의 버전을 출력한다', () => {
    expect(execFileSync('node', [bin, '--version'], { encoding: 'utf8', timeout: 10_000 })).toMatch(/^\d+\.\d+\.\d+\n$/);
  });
});
