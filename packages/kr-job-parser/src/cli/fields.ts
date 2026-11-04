import { parseDeadline, type IsoDate } from '../deadline.js';
import { parseExperience } from '../experience.js';
import { parseLocation } from '../location.js';
import { describeDeadline, describeExperience, describeLocation } from './describe.js';

/** 원문 하나를 해석한 결과. 필드마다 결과 타입이 달라 출력 단계에서는 `unknown`으로 다룬다. */
export interface Outcome {
  readonly result: unknown;
  /** 끝까지 해석했는지. 근무지는 일부라도 남은 조각이 있으면 `false`다. */
  readonly resolved: boolean;
  readonly text: string;
}

export interface Field {
  readonly name: FieldName;
  readonly label: string;
  interpret(raw: string, today: IsoDate): Outcome;
}

interface FieldDefinition<T> {
  readonly label: string;
  parse(raw: string, today: IsoDate): T;
  resolved(result: T): boolean;
  describe(result: T): string;
}

/** 필드별 결과 타입 `T`는 정의 안에서만 쓰고, 밖으로는 같은 모양(`Field`)으로 내보낸다. */
function define<T>(name: FieldName, definition: FieldDefinition<T>): Field {
  return {
    name,
    label: definition.label,
    interpret(raw, today) {
      const result = definition.parse(raw, today);
      return { result, resolved: definition.resolved(result), text: definition.describe(result) };
    },
  };
}

export const FIELD_NAMES = ['experience', 'location', 'deadline'] as const;
export type FieldName = (typeof FIELD_NAMES)[number];

export const FIELDS: Readonly<Record<FieldName, Field>> = {
  experience: define('experience', {
    label: '경력',
    parse: (raw) => parseExperience(raw),
    resolved: (result) => result.kind !== 'unknown',
    describe: describeExperience,
  }),
  location: define('location', {
    label: '근무지',
    parse: (raw) => parseLocation(raw),
    resolved: (result) =>
      result.unparsed.length === 0 && (result.places.length > 0 || result.nationwide || result.remote === 'full'),
    describe: describeLocation,
  }),
  deadline: define('deadline', {
    label: '마감',
    parse: (raw, today) => parseDeadline(raw, { today }),
    resolved: (result) => result.kind !== 'unknown',
    describe: describeDeadline,
  }),
};

/**
 * 짧은 이름과 한국어 이름도 받는다.
 * 객체 대신 `Map`을 써서 `toString` 같은 프로토타입 속성이 필드 이름으로 잡히지 않게 한다.
 */
const ALIASES: ReadonlyMap<string, FieldName> = new Map([
  ['experience', 'experience'],
  ['exp', 'experience'],
  ['경력', 'experience'],
  ['location', 'location'],
  ['loc', 'location'],
  ['근무지', 'location'],
  ['deadline', 'deadline'],
  ['dl', 'deadline'],
  ['마감', 'deadline'],
]);

export function findField(name: string): Field | undefined {
  const key = ALIASES.get(name);
  return key === undefined ? undefined : FIELDS[key];
}
