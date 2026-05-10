#!/usr/bin/env bash
set -euo pipefail

PACKAGE="@openai/codex"

install_with_proxy() {
  echo "[1/3] Trying npm install with current proxy settings..."
  if npm install -g "$PACKAGE"; then
    echo "✅ Installed $PACKAGE with proxy settings."
    return 0
  fi
  return 1
}

install_without_proxy() {
  echo "[2/3] Retrying without proxy env vars..."
  if env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u npm_config_http_proxy -u npm_config_https_proxy -u YARN_HTTP_PROXY -u YARN_HTTPS_PROXY npm install -g "$PACKAGE"; then
    echo "✅ Installed $PACKAGE without proxy env vars."
    return 0
  fi
  return 1
}

show_diagnostics() {
  echo "[3/3] Installation failed. Diagnostics:"
  echo "- npm registry: $(npm config get registry)"
  echo "- Tip: your network proxy may block npm scoped packages."
  echo "- Ask admin to allow: https://registry.npmjs.org/@openai%2fcodex"
  echo "- Or use an internal npm mirror that contains $PACKAGE."
}

install_with_proxy || install_without_proxy || { show_diagnostics; exit 1; }
