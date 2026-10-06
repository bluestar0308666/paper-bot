#!/data/data/com.termux/files/usr/bin/bash
set -eu

APP_DIR="${PAPER_BOT_DIR:-$HOME/pubmed}"
ARCHIVE_URL="https://raw.githubusercontent.com/bluestar0308666/paper-bot/main/paper-bot.tar.gz"
TMP_DIR="$(mktemp -d)"
UPDATE_ONLY="${1:-}"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "======================================"
echo " Paper Bot 一键安装 / 更新"
echo "======================================"

MISSING_PACKAGES=""
command -v node >/dev/null 2>&1 || MISSING_PACKAGES="$MISSING_PACKAGES nodejs-lts"
command -v curl >/dev/null 2>&1 || MISSING_PACKAGES="$MISSING_PACKAGES curl"
command -v ssh >/dev/null 2>&1 || MISSING_PACKAGES="$MISSING_PACKAGES openssh"
command -v tar >/dev/null 2>&1 || MISSING_PACKAGES="$MISSING_PACKAGES tar"
if [ -n "$MISSING_PACKAGES" ]; then
  echo "仅安装缺少的组件：$MISSING_PACKAGES"
  pkg install -y $MISSING_PACKAGES
else
  echo "Node/OpenSSH/curl/tar 已存在，跳过环境安装。Node: $(node -v)"
fi

echo "[1/5] 下载最新版..."
DOWNLOADED=0
for url in \
  "$ARCHIVE_URL" \
  "https://ghfast.top/$ARCHIVE_URL" \
  "https://gh-proxy.com/$ARCHIVE_URL" \
  "https://ghproxy.net/$ARCHIVE_URL"
do
  if curl -fL --connect-timeout 15 --retry 2 "$url" -o "$TMP_DIR/paper-bot.tar.gz"; then
    DOWNLOADED=1
    break
  fi
done
[ "$DOWNLOADED" -eq 1 ] || { echo "GitHub 及镜像下载均失败"; exit 1; }
mkdir -p "$TMP_DIR/package"
tar -xzf "$TMP_DIR/paper-bot.tar.gz" -C "$TMP_DIR/package"
SOURCE_DIR="$TMP_DIR/package"
[ -d "$TMP_DIR/package/pubmed" ] && SOURCE_DIR="$TMP_DIR/package/pubmed"

if [ -f "$APP_DIR/paper-bot" ]; then
  echo "[2/5] 备份现有数据库并停止服务..."
  bash "$APP_DIR/paper-bot" backup || true
  bash "$APP_DIR/paper-bot" stop || true
else
  echo "[2/5] 接管现有部署并清理已知测试进程..."
  if [ -f "$APP_DIR/data.db" ]; then
    mkdir -p "$APP_DIR/backups"
    DB_SOURCE="$APP_DIR/data.db" DB_TARGET="$APP_DIR/backups/pre-update-$(date +%Y%m%d-%H%M%S).db" node - <<'NODE' || true
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.env.DB_SOURCE);
db.exec("VACUUM INTO '" + process.env.DB_TARGET.replace(/'/g, "''") + "'");
NODE
  fi
  pkill -f 'pubmed/server\.js' 2>/dev/null || true
  pkill -f 'node server\.js' 2>/dev/null || true
  pkill -f 'listen\(3008\)' 2>/dev/null || true
  pkill -f 'tunnel-ok' 2>/dev/null || true
  sleep 1
fi

mkdir -p "$APP_DIR"
cp -R "$SOURCE_DIR/." "$APP_DIR/"
chmod +x "$APP_DIR/paper-bot" "$APP_DIR/bootstrap.sh" "$APP_DIR/tunnel.sh" 2>/dev/null || true
ln -sf "$APP_DIR/paper-bot" "$PREFIX/bin/paper-bot"

cd "$APP_DIR"
echo "[3/5] 安装 Node 依赖..."
npm install --omit=dev --no-audit --no-fund --registry=https://registry.npmmirror.com

if [ ! -f config.json ]; then
  echo "[4/5] 首次配置（输入内容不会上传到 GitHub）"
  printf "DeepSeek API Key: "
  IFS= read -r DEEPSEEK_KEY
  printf "网页访问密码: "
  IFS= read -r ACCESS_PASSWORD
  DEEPSEEK_KEY="$DEEPSEEK_KEY" ACCESS_PASSWORD="$ACCESS_PASSWORD" node - <<'NODE'
const fs = require('fs');
fs.writeFileSync('config.json', JSON.stringify({
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_KEY || '',
  DEEPSEEK_BASE_URL: 'https://api.deepseek.com',
  DEEPSEEK_MODEL: 'deepseek-chat',
  PORT: 3008,
  PASSWORD: process.env.ACCESS_PASSWORD || ''
}, null, 2));
NODE
else
  echo "[4/5] 保留现有 config.json"
fi

echo "[5/5] 配置 Termux:Boot 并启动..."
mkdir -p "$HOME/.termux/boot"
cat > "$HOME/.termux/boot/paper-bot.sh" <<'BOOT'
#!/data/data/com.termux/files/usr/bin/bash
termux-wake-lock 2>/dev/null || true
paper-bot start
paper-bot tunnel-start
BOOT
chmod +x "$HOME/.termux/boot/paper-bot.sh"
paper-bot restart

echo "======================================"
echo " 完成：http://localhost:3008"
echo " 常用命令："
echo "   paper-bot status"
echo "   paper-bot log"
echo "   paper-bot update"
echo "   paper-bot backup"
echo "   paper-bot tunnel-start"
echo "   paper-bot tunnel-url"
echo "======================================"
