# Changelog

이 파일은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/) 형식을 따르고, 버전은 [유의적 버전](https://semver.org/lang/ko/)을 따릅니다.

## [0.4.0] - 2026-11-05

### Added

- CLI `kr-job-parser <experience|location|deadline> [원문]`. 원문을 인자로 하나 받거나, 표준 입력으로 한 줄에 하나씩 받아 해석 성공률과 실패 원문 상위 5개를 요약합니다. `--json`(JSON Lines), `--strict`(실패 시 종료 코드 1), `--today` 옵션을 지원합니다.

## [0.3.0] - 2026-11-03

실제 공공기관 공고 519건으로 처음 검증하면서 드러난 표기를 추가했습니다. 해석 성공률이 63.3%에서 99.9%로 올랐습니다.

### Added

- `parseLocation`: `전남광주`, `전남광주통합특별시`, `전남광주특별시`를 `광주`·`전남` 두 곳으로 해석합니다. 뒤에 시·군·구가 오면 옛 행정구역으로 되짚습니다 (광산구 → 광주, 화순군 → 전남).
- `parseDeadline`: 구분자 없는 `YYYYMMDD` 날짜 (`20261117`). 19xx·20xx년으로 시작하는 8자리만 인식합니다.

## [0.2.0] - 2026-11-03

### Added

- `parseLocation`, `matchesRegion`, `SIDO`: 근무지 표기 해석. 시·도 17곳 정규화, 시·군·구, `외 N곳`, `전국`, 재택 여부.
- `parseDeadline`, `isOpen`: 마감 표기 해석. 연도가 있거나 없는 날짜, 시각, `오늘마감`·`D-3` 같은 상대 표기, 상시채용, 채용 시 마감.
- `IsoDate`, `Time` 템플릿 리터럴 타입.

### Changed

- `Fit` 타입을 공통 모듈로 옮겼습니다. 공개 API에는 변화가 없습니다.

## [0.1.0] - 2026-11-03

### Added

- `parseExperience`, `fitsYears`, `acceptsNewcomer`: 경력 요건 해석과 판단.
- `normalize`: 표기 정규화.
