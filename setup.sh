#!/bin/bash
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo "  💬 ChatMux 安装向导"
echo "  ─────────────────────"
echo ""

# 1. 检查 Node.js
if ! command -v node &>/dev/null; then
  error "未找到 Node.js，请先安装 Node.js >= 18"
  echo "  推荐: https://nodejs.org/ 或 curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs"
  exit 1
fi

NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt 18 ]; then
  error "Node.js 版本过低 ($(node -v))，需要 >= 18"
  exit 1
fi
info "Node.js $(node -v)"

# 2. 检查包管理器
PKG="npm"
PKG_INSTALL="$PKG install"
if command -v pnpm &>/dev/null; then
  PKG="pnpm"
  PKG_INSTALL="$PKG install"
  info "pnpm $(pnpm -v)"
elif command -v npm &>/dev/null; then
  info "npm $(npm -v)"
fi

# 支持通过环境变量 CHINA_MIRROR=1 启用国内镜像
if [ "${CHINA_MIRROR}" = "1" ]; then
  REGISTRY_OPT="--registry https://registry.npmmirror.com"
  info "使用国内镜像源"
else
  REGISTRY_OPT=""
fi

# 3. 安装根目录依赖（concurrently 等）
info "安装根目录依赖..."
cd "$SCRIPT_DIR"
$PKG_INSTALL $REGISTRY_OPT

# 4. 安装后端依赖
info "安装后端依赖..."
cd "$SCRIPT_DIR/server"
$PKG_INSTALL $REGISTRY_OPT
cd "$SCRIPT_DIR"

# 5. 安装前端依赖
info "安装前端依赖..."
cd "$SCRIPT_DIR/client"
$PKG_INSTALL $REGISTRY_OPT
cd "$SCRIPT_DIR"

# 6. 构建前端
info "构建前端..."
cd "$SCRIPT_DIR/client"
$PKG run build
cd "$SCRIPT_DIR"

echo ""
info "安装完成！"
echo ""
echo "  启动服务:"
echo "    cd $SCRIPT_DIR/server && node index.js"
echo ""
echo "  然后打开浏览器访问: http://localhost:9910"
echo ""

# 询问是否立即启动
read -p "  是否立即启动？[Y/n] " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Nn]$ ]]; then
  info "启动 ChatMux..."
  cd "$SCRIPT_DIR/server"
  exec node index.js
fi
