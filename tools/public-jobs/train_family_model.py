"""직무군 추정 모델 학습(설계 8장). 출처가 직무를 확정한 공고(사람인 태그, ALIO NCS)로 배우고,
직무를 모르는 잡코리아 공고에 수집기(apps/collector/src/classify/model.ts)가 적용한다.

    python tools/public-jobs/train_family_model.py \
      --snapshot .scrapling-local/train-src.json [--snapshot more.json] \
      [--holdout .scrapling-local/model/holdout.jsonl] \
      --out apps/collector/src/classify/family-model.v1.json

- 입력은 배포 스냅샷(v1)이다. 학습 데이터와 원문은 커밋하지 않는다(.scrapling-local).
- 잡코리아 공고는 평가 대상이라 학습에 쓰지 않는다. --holdout(회사·제목 JSONL)과 겹치는 공고도 뺀다.
- ALIO는 꼬리표가 NCS 분류명 자체라 제목만 쓴다(정답 누설 방지).
- 특징: 제목 + 꼬리표의 글자 n-gram(char_wb 2~4) TF-IDF. 모델: 직무군마다 로지스틱 회귀(다중 라벨).
- 내보내기 형식은 수집기 추론 코드와 짝이다. 바꾸면 model.ts와 테스트를 함께 바꾼다.
"""
import argparse
import json
import re

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.multiclass import OneVsRestClassifier
from sklearn.preprocessing import MultiLabelBinarizer

VERSION = 'family-model/1'
NGRAM = (2, 4)
MAX_FEATURES = 6000
WEIGHT_FLOOR = 0.05  # 이보다 작은 가중치는 버린다(파일 크기). 버린 뒤의 결과로 평가한다.


def text(title, tags):
    return f"{title} | {' '.join(tags)}"


def norm(value):
    value = re.sub(r"[\s()㈜（）\[\]<>【】\"'·.,\-_/|]", '', value or '')
    return re.sub('주식회사|유한회사', '', value).lower()


def load_rows(snapshots, holdout):
    blocked_pairs = {norm(h.get('company')) + '|' + norm(h.get('title')) for h in holdout}
    blocked_titles = {norm(h.get('title')) for h in holdout}
    by_id = {}
    for path in snapshots:
        with open(path, encoding='utf-8') as file:
            for job in json.load(file)['jobs']:
                by_id[job['id']] = job  # 뒤 스냅샷이 이긴다
    rows = []
    for job in by_id.values():
        source = job['id'].split(':')[0]
        if source not in ('saramin', 'alio'):
            continue
        if (job.get('classification') or {}).get('nonHiring') or not job.get('families'):
            continue
        if norm(job['company']) + '|' + norm(job['title']) in blocked_pairs or norm(job['title']) in blocked_titles:
            continue
        rows.append({'title': job['title'], 'tags': [] if source == 'alio' else job.get('tags') or [], 'families': job['families']})
    return rows


def train(rows):
    X, Y = [], []
    for row in rows:
        X.append(text(row['title'], row['tags']))
        Y.append(row['families'])
        if row['tags']:  # 꼬리표가 없는 공고에도 쓰이게 제목만으로 한 벌 더
            X.append(text(row['title'], []))
            Y.append(row['families'])
    mlb = MultiLabelBinarizer()
    y = mlb.fit_transform(Y)
    vec = TfidfVectorizer(analyzer='char_wb', ngram_range=NGRAM, min_df=2, sublinear_tf=True, max_features=MAX_FEATURES)
    model = OneVsRestClassifier(LogisticRegression(C=4, max_iter=2000, class_weight='balanced')).fit(vec.fit_transform(X), y)
    return vec, mlb, model, len(X)


def export(vec, mlb, model):
    coef = np.vstack([est.coef_[0] for est in model.estimators_])  # (classes, features)
    features = []
    for gram, index in sorted(vec.vocabulary_.items(), key=lambda item: item[1]):
        weights = {str(c): round(float(coef[c, index]), 3) for c in range(coef.shape[0]) if abs(coef[c, index]) >= WEIGHT_FLOOR}
        features.append([gram, round(float(vec.idf_[index]), 4), weights])
    return {
        'version': VERSION,
        'note': '학습: tools/public-jobs/train_family_model.py. 사람인 태그·ALIO NCS로 확정된 공고의 제목·꼬리표 글자 n-gram.',
        'ngram': list(NGRAM),
        'classes': list(mlb.classes_),
        'intercepts': [round(float(est.intercept_[0]), 4) for est in model.estimators_],
        'features': features,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--snapshot', action='append', required=True)
    parser.add_argument('--holdout')
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    holdout = []
    if args.holdout:
        with open(args.holdout, encoding='utf-8') as file:
            holdout = [json.loads(line) for line in file if line.strip()]
    rows = load_rows(args.snapshot, holdout)
    vec, mlb, model, size = train(rows)
    data = export(vec, mlb, model)
    with open(args.out, 'w', encoding='utf-8') as file:
        json.dump(data, file, ensure_ascii=False, separators=(',', ':'))
        file.write('\n')
    print(json.dumps({'rows': len(rows), 'examples': size, 'features': len(data['features']), 'classes': data['classes']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
