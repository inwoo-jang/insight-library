@echo off
rem 인사이트 서재를 로컬 서버로 연다 (Windows). 이 창을 닫으면 서버도 꺼진다.
chcp 65001 >nul
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  py -3 -m venv .venv || python -m venv .venv
  .venv\Scripts\python.exe -m pip install -q -r requirements.txt
)
.venv\Scripts\python.exe scripts\build.py
start "" http://127.0.0.1:8000/index.html
.venv\Scripts\python.exe scripts\serve.py 8000
