#!/bin/bash
# 部署脚本 - 在阿里云 Ubuntu/Debian 服务器上执行

set -e

# 日常 2 GB 升级使用 docs/RELEASE.md 与 DEPLOY.md §8.1 的本地预构建路径。
if [ "${1:-}" != "--bootstrap" ]; then
  printf '%s\n' '拒绝执行旧服务器安装流程；仅首次安装/明确资源例外使用 --bootstrap，且须已有对应授权。' >&2
  exit 64
fi

echo "=== 智能日程表部署脚本 ==="

# 1. 安装 Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. 安装 PM2（进程管理器）
sudo npm install -g pm2

# 3. 创建应用目录
mkdir -p ~/smart-schedule-agent
cd ~/smart-schedule-agent

# 4. 克隆/上传代码（手动上传或用 git）
# git clone https://your-repo.git . || echo "请手动上传代码到 ~/smart-schedule-agent"

echo "请把代码上传到 ~/smart-schedule-agent 目录后，继续执行："
echo "  cd ~/smart-schedule-agent && bash deploy-continue.sh --server-install"
