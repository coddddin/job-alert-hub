#!/usr/bin/env bash
# 2차 진단: 운영과 같은 수집기(scrapling/curl_cffi)로 2페이지, curl로 연결 시간 5회. 2~3초 간격.
set -u
echo "== egress ip: $(curl -s -m 10 https://api.ipify.org || echo unknown)"
for i in 1 2 3 4 5; do
  echo "curl #$i | $(curl -sS -o /dev/null -A 'JobAlertHubValidation/0.2' --connect-timeout 20 -m 30 -w 'http=%{http_code} tcp=%{time_connect} tls=%{time_appconnect} total=%{time_total}' 'https://www.saramin.co.kr/zf_user/search/recruit?searchword=%EA%B0%9C%EB%B0%9C%EC%9E%90' 2>&1)"
  sleep 3
done
python -m pip install -q -r tools/public-jobs/requirements.txt
echo "-- scrapling (production collector), 2 pages"
python tools/public-jobs/saramin_list.py --max-pages 2 --queries 개발자,백엔드 --offset 0 --out /tmp/saramin-diag 2>&1 | grep -E 'Fetched|ERROR|httpStatus' 
echo "exit=$? items=$(python -c "import json;print(len(json.load(open('/tmp/saramin-diag/batch.json'))['jobs']))" 2>/dev/null)"
