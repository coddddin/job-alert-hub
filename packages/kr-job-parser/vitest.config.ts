import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src'],
      // 진입점은 프로세스 입출력을 연결만 한다. 동작은 run.ts 단위 테스트와 빌드 결과물 테스트로 확인한다.
      exclude: ['src/cli/bin.ts'],
      thresholds: { lines: 95, branches: 90, functions: 100, statements: 95 },
    },
  },
});
