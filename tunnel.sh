#!/bin/bash
# 外网隧道（断线自动重连）。前台运行会实时显示公网网址。
cd ~/pubmed || exit 1
while true; do
  ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes \
      -R 80:localhost:3008 nokey@localhost.run
  echo "[$(date)] 隧道断开，5 秒后重连...（当前网址已失效）"
  sleep 5
done
