#!/data/data/com.termux/files/usr/bin/bash
set -eu

APP_DIR="${PAPER_BOT_DIR:-$HOME/pubmed}"
cd "$APP_DIR" || { echo "代码目录不存在：$APP_DIR"; exit 1; }

MISSING_PACKAGES=""
command -v node >/dev/null 2>&1 || MISSING_PACKAGES="$MISSING_PACKAGES nodejs-lts"
command -v curl >/dev/null 2>&1 || MISSING_PACKAGES="$MISSING_PACKAGES curl"
command -v ssh >/dev/null 2>&1 || MISSING_PACKAGES="$MISSING_PACKAGES openssh"
command -v tar >/dev/null 2>&1 || MISSING_PACKAGES="$MISSING_PACKAGES tar"
[ -z "$MISSING_PACKAGES" ] || pkg install -y $MISSING_PACKAGES
npm install --omit=dev --no-audit --no-fund --registry=https://registry.npmmirror.com
chmod +x paper-bot bootstrap.sh tunnel.sh
ln -sf "$APP_DIR/paper-bot" "$PREFIX/bin/paper-bot"

if [ ! -f config.json ]; then
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
fi

mkdir -p "$HOME/.termux/boot"
cat > "$HOME/.termux/boot/paper-bot.sh" <<'BOOT'
#!/data/data/com.termux/files/usr/bin/bash
termux-wake-lock 2>/dev/null || true
paper-bot start
paper-bot tunnel-start
BOOT
chmod +x "$HOME/.termux/boot/paper-bot.sh"
paper-bot restart
echo "安装完成：http://localhost:3008"
