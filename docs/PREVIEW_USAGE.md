# 공고 미리보기 사용법

현재 PC에서는 프로젝트 폴더의 **미리보기 실행.cmd**를 더블클릭한다.
주소는 `http://127.0.0.1:3001`이다. Node.js가 설치되어 있어야 한다.
이 실행 파일은 이미 준비된 검증 데이터를 보여주며 새 수집이나 운영 데이터 변경을 하지 않는다.

회사·제목·근무지 검색, 지역, 공고 출처, 경력, 마감 포함 여부로 목록을 좁힌다.
지역이 불명확한 공고는 확인 대상으로 남는다. 원문과 해석을 함께 보고 ‘원본 공고 보기’로
실제 조건을 확인한다. 모든 수집 직무를 표시하며 개발·신입 추천 목록이 아니다.

## 개발 환경에서 데이터 준비

빌드는 기존 저장소의 도구와 Python 가상환경을 사용한다.

```sh
python tools/public-jobs/batch_live.py --count 40 --out .scrapling-local/new-run
node tools/public-jobs/import.mjs --input .scrapling-local/new-run/batch.json --out .scrapling-local/preview
node tools/public-jobs/preview.mjs --snapshot .scrapling-local/preview/snapshot.json
```

출력 디렉터리/스냅샷은 기존 파일을 덮어쓰지 않는다. 이미 있으면 다른 출력 디렉터리를
지정하고 `preview.mjs --snapshot`에 그 파일을 전달한다. 더블클릭 진입점은 고정 경로
`.scrapling-local/preview/snapshot.json`을 읽는다.

다른 출처의 스냅샷과 통합 미리보기:

```sh
node tools/public-jobs/import.mjs --input public-batch.json --base alio-snapshot.json --out new-combined-preview
node tools/public-jobs/preview.mjs --snapshot new-combined-preview/snapshot.json --port 3002
```

기준일이 다르거나 ID가 중복되면 결합하지 않는다. 기존 ALIO 파일은 읽기만 한다.
실험용 데이터는 git에 포함되지 않으므로 새 PC에서는 데이터를 다시 준비해야 한다.
접근 실패는 개별 제외 또는 배치 중지로 남으며 자동 CI에서는 실제 사이트를 요청하지 않는다.

검토 기준: `docs/DEVELOPMENT_HARNESS.md`. 작업 결과·제한: `docs/VALIDATION_PREVIEW_LOG.md`.
