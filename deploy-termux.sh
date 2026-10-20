#!/bin/bash
# ============================================
#  Paper Bot 部署/更新脚本 (Termux)
#  用法: bash ~/deploy-paper.sh
# ============================================
set -e
APP_DIR="$HOME/pubmed"
PORT=3008
NPM_REG="https://registry.npmmirror.com"

echo "======================================"
echo "  Paper Bot 部署 (端口 $PORT)"
echo "======================================"

if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 node，正在安装..."
  pkg install -y nodejs-lts
fi
echo "Node: $(node -v)"

if [ ! -d "$APP_DIR" ]; then
  echo "[错误] 代码目录不存在: $APP_DIR"
  echo "请先把 paper-bot 里的文件放到 $APP_DIR"
  exit 1
fi

cd "$APP_DIR"

if [ ! -f config.json ]; then
  cp config.example.json config.json
  echo "已生成 config.json，请填入 DEEPSEEK_API_KEY 后再启动"
fi

echo "[1/3] 安装依赖..."
npm install --omit=dev --no-audit --no-fund --registry="$NPM_REG" >/dev/null 2>&1 && echo "    完成" || echo "    有问题(继续)"

echo "[2/3] 停止旧服务..."
pkill -f "pubmed/server.js" 2>/dev/null || true
sleep 1

echo "[3/3] 启动服务..."
nohup node server.js > server.log 2>&1 &
sleep 2

AUTOSTART='if ! pgrep -f "pubmed/server.js" >/dev/null 2>&1; then cd ~/pubmed && nohup node server.js > server.log 2>&1 & fi'
if grep -q "pubmed/server.js" "$HOME/.bashrc" 2>/dev/null; then
  echo "自启已存在，跳过"
else
  echo "$AUTOSTART" | tee -a "$HOME/.bashrc" "$HOME/.bash_profile" >/dev/null
  echo "已添加开机自启"
fi

echo "======================================"
echo "  完成"
echo "  本机访问: http://localhost:$PORT"
echo "  外网访问: 需另配端口映射或隧道(见说明)"
echo "======================================"
