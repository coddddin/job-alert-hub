# Scrapling isolated verification

This directory is an **experiment only**; it does not alter the existing
TypeScript collector, scheduler, production snapshot or website.

## Scope
- Installs `scrapling[fetchers]` in an isolated GitHub Actions Python 3.12 runner.
- Parses a fixed HTML fixture with Scrapling (two unit tests).
- Fetches **one** educational sample job board,
  https://realpython.github.io/fake-jobs/ (fictional vacancies intended for scraping practice).
- For JobKorea, reads only `/robots.txt` and reports a preliminary
  technical permission signal. It does **not** fetch its listings,
  bypass restrictions, use cookies, rotate proxies, or infer reuse rights.

## Local execution
```bash
python -m venv .venv
# Activate .venv for your shell, then:
python -m pip install -r tools/scrapling-probe/requirements.txt
python -m unittest discover -s tools/scrapling-probe -p "test_*.py" -v
python tools/scrapling-probe/probe.py --target demo
python tools/scrapling-probe/probe.py --target jobkorea
```
No browser installation is needed for the HTTP-only Fetcher used here.
Browser-based fetchers would require `scrapling install` separately.

## Integration decision
Do not integrate directly into `apps/collector` until the approved
source registry, policy status, normalized data contract, and failure
handling in the discovery plan are implemented. A successful demo fetch
does not prove live access to JobKorea or rights to reuse real listings.
