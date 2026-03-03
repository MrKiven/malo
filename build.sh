#!/bin/bash
# 打包 Chrome 扩展为 zip 文件
# 构建产物在 dist/（Vite 构建时已自动复制 manifest.json 和 assets/）

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="$SCRIPT_DIR/dist"
RELEASE_DIR="$SCRIPT_DIR/release"
NAME="rss-chrome-extension"
VERSION=$(node -p "require('./package.json').version")
TIMESTAMP=$(date +%Y%m%d%H%M%S)

mkdir -p "$RELEASE_DIR"
OUTPUT="$RELEASE_DIR/${NAME}-${VERSION}-${TIMESTAMP}.zip"

# 检查 dist 目录是否存在
if [ ! -d "$DIST_DIR" ]; then
  echo "❌ dist 目录不存在，请先运行 npm run build"
  exit 1
fi

# 打包 dist 目录内容
cd "$DIST_DIR"
zip -r "$OUTPUT" \
  . \
  -x "**/.DS_Store" "**/__MACOSX/*" "*.zip"

echo "✅ 打包完成: $OUTPUT"
echo "   大小: $(du -h "$OUTPUT" | cut -f1)"
