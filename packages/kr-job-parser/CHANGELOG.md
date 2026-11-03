# Changelog

이 파일은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/) 형식을 따르고, 버전은 [유의적 버전](https://semver.org/lang/ko/)을 따릅니다.

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
