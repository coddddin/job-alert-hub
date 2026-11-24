#!/usr/bin/env bash
# 사람인 수집 실패 원인 진단(1회성). 출처별로 DNS → TCP → TLS → HTTP 어디서 끊기는지 비교한다.
# 사이트당 요청은 몇 건뿐이고 3초 간격이다. 우회 시도는 하지 않는다(UA 비교는 curl 기본값과 우리 UA만).
set -u
UA='JobAlertHubValidation/0.2'
echo "== runner: $(uname -sm) $(. /etc/os-release 2>/dev/null; echo ${PRETTY_NAME:-$(sw_vers -productVersion 2>/dev/null)})"
echo "== egress ip: $(curl -s -m 10 https://api.ipify.org || echo unknown)"
probe() { # name url ua
  local out
  out=$(curl -sS -o /dev/null -A "$3" --connect-timeout 10 -m 20 \
    -w 'http=%{http_code} ip=%{remote_ip} dns=%{time_namelookup} tcp=%{time_connect} tls=%{time_appconnect} first=%{time_starttransfer} total=%{time_total}' "$2" 2>&1)
  echo "$1 | $out"
  sleep 3
}
for host in www.saramin.co.kr www.jobkorea.co.kr www.naver.com example.com; do
  echo "-- dns $host: $( (getent ahosts "$host" 2>/dev/null || dscacheutil -q host -a name "$host" 2>/dev/null) | awk '{print $1}' | sort -u | tr '\n' ' ')"
done
for host in www.saramin.co.kr www.jobkorea.co.kr; do
  for port in 443 80; do
    start=$(date +%s.%N)
    if (command -v nc >/dev/null && nc -z -w 10 "$host" "$port") 2>/dev/null; then r=open; else r=fail; fi
    echo "-- tcp $host:$port $r ($(echo "$(date +%s.%N) - $start" | bc 2>/dev/null)s)"
  done
done
probe 'saramin  /            ourUA ' 'https://www.saramin.co.kr/' "$UA"
probe 'saramin  /robots.txt  curlUA' 'https://www.saramin.co.kr/robots.txt' "curl/$(curl --version | head -1 | cut -d' ' -f2)"
probe 'saramin  search       ourUA ' 'https://www.saramin.co.kr/zf_user/search/recruit?searchword=%EA%B0%9C%EB%B0%9C%EC%9E%90' "$UA"
probe 'saramin  http:80      ourUA ' 'http://www.saramin.co.kr/' "$UA"
probe 'jobkorea /            ourUA ' 'https://www.jobkorea.co.kr/' "$UA"
probe 'naver    /            ourUA ' 'https://www.naver.com/' "$UA"
probe 'example  /            ourUA ' 'https://example.com/' "$UA"
if command -v tracepath >/dev/null; then
  echo "-- tracepath www.saramin.co.kr (last hops)"; timeout 60 tracepath -n -m 25 www.saramin.co.kr 2>&1 | tail -8
elif command -v traceroute >/dev/null; then
  echo "-- traceroute www.saramin.co.kr (last hops)"; timeout 60 traceroute -n -w 2 -q 1 -m 25 www.saramin.co.kr 2>&1 | tail -8
fi
