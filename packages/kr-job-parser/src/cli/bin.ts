#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { run } from './run.js';

const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };

process.exitCode = await run(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  // 터미널에서 직접 실행하면 입력을 기다리지 않는다.
  stdin: process.stdin.isTTY ? null : () => createInterface({ input: process.stdin, crlfDelay: Infinity }),
  now: new Date(),
  version,
});
