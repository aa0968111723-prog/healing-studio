# =============================================================================
# AIDV / healing-studio — 開發便捷指令（在 repo 根目錄執行：make <target>）
# 需 GNU make（Windows 可用 Git Bash / WSL，或直接照 README 跑等價指令）
# =============================================================================
SHELL := /bin/bash

.PHONY: help up down install env migrate dev build check test e2e gates clean

help:            ## 列出所有指令
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-10s\033[0m %s\n",$$1,$$2}'

up:              ## 起本機 MySQL + Redis（docker compose）
	docker compose -f dev-environment/docker-compose.yml up -d

down:            ## 停本機服務（保留資料）
	docker compose -f dev-environment/docker-compose.yml down

install:         ## 安裝相依（legacy-peer-deps，repo 慣例）
	npm install --legacy-peer-deps

env:             ## 從範本建立 .env（若不存在）並產生 JWT_SECRET
	@if [ -f .env ]; then \
		echo ".env 已存在，略過（未覆蓋既有檔案）"; \
	else \
		cp dev-environment/.env.dev.example .env; \
		SECRET="$$( (openssl rand -base64 32 2>/dev/null) || node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))')"; \
		if sed --version >/dev/null 2>&1; then sed -i "s|__GENERATED_BY_SETUP__|$${SECRET}|" .env; \
		else sed -i '' "s|__GENERATED_BY_SETUP__|$${SECRET}|" .env; fi; \
		echo "已建立 .env 並產生 JWT_SECRET（其餘金鑰留空＝OARS 警告、不崩潰）"; \
	fi

migrate:         ## 套用 drizzle migration（需 DATABASE_URL）
	npm run db:push

dev:             ## 啟動開發伺服器（http://localhost:3000）
	npm run dev

build:           ## 生產建置（vite + esbuild）
	npm run build

check:           ## 驗證門：型別 + 路由/registry 對齊
	npx tsc --noEmit && npm run check:routes

gates:           ## 完整驗證門（tsc + routes + navigation + 單元測試）
	npx tsc --noEmit && npm run check:routes && npm run check:navigation && npm run test

test:            ## 單元測試（vitest）
	npm run test

e2e:             ## 端對端測試（playwright）
	npm run test:e2e

clean:           ## 清掉本機服務 + 資料卷
	docker compose -f dev-environment/docker-compose.yml down -v
