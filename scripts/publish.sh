#!/bin/zsh
# 공개 노트만으로 사이트를 만들어 gh-pages 브랜치에 올린다 (GitHub Pages 가 이 브랜치를 배포한다).
# 로컬 전용 노트(web/catalog.local.json 에 등록된 것)와 원본/ 은 빠진다.
set -e
cd "$(dirname "$0")/.."
SITE=$(mktemp -d)
.venv/bin/python scripts/build.py --public --out "$SITE/index.html"
cp -R web "$SITE/web"
rm -f "$SITE/web/catalog.local.json" "$SITE/web/settings.json"
cp -R companies "$SITE/companies"
mkdir -p "$SITE/notes"
for f in notes/*.md notes/*.pdf; do
  git check-ignore -q "$f" && continue
  cp "$f" "$SITE/notes/"
done
touch "$SITE/.nojekyll"
cd "$SITE"
git init -q -b gh-pages
git add -A
git commit -q -m "publish $(date '+%Y-%m-%d %H:%M')"
git push -q -f "$(git -C "$OLDPWD" remote get-url origin)" gh-pages
echo "배포: https://inwoo-jang.github.io/insight-library/"
