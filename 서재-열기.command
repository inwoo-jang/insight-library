#!/bin/zsh
# 인사이트 서재를 로컬 서버로 연다. 이 창을 닫으면 서버도 꺼진다.
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv && .venv/bin/pip -q install -r requirements.txt
fi
.venv/bin/python scripts/build.py
(sleep 1; open "http://127.0.0.1:8000/index.html") &
.venv/bin/python scripts/serve.py 8000
