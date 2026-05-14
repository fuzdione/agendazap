#!/bin/bash
# =============================================================
# AgendaZap — deploy / redeploy
# Execute a partir de /opt/agendazap após preencher o .env
# =============================================================
set -e

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "Erro: arquivo .env não encontrado. Copie .env.prod.example para .env e preencha os valores."
  exit 1
fi

echo "==> Atualizando código..."
git pull

echo "==> Lendo variáveis do .env..."
source .env 2>/dev/null || true
# Extrai só o hostname do SERVER_URL (remove scheme e path)
DOMAIN=$(echo "${SERVER_URL:-}" | sed 's|https\?://||' | cut -d/ -f1)

echo "==> Build do painel administrativo (React/Vite)..."
cd admin-panel
# Remove node_modules e lock para garantir binários nativos compatíveis com o SO atual
rm -rf node_modules package-lock.json
npm install --silent
npm run build
cd ..

echo "==> Build do painel do proprietário (React/Vite)..."
cd owner-panel
rm -rf node_modules package-lock.json
npm install --silent
npm run build
cd ..

echo "==> Build das imagens da aplicação..."
docker compose -f docker-compose.prod.yml build app migrate

echo "==> Subindo serviços de infraestrutura..."
docker compose -f docker-compose.prod.yml up -d postgres redis

echo "==> Aguardando banco de dados ficar pronto..."
sleep 5

echo "==> Rodando migrations..."
docker compose -f docker-compose.prod.yml run --rm migrate

echo "==> Subindo todos os serviços..."
docker compose -f docker-compose.prod.yml up -d

echo ""
echo "==> Status dos containers:"
docker compose -f docker-compose.prod.yml ps

echo ""
echo "==> Deploy concluído!"
echo "    Painel:       https://$DOMAIN/painel"
echo "    Health check: https://$DOMAIN/health"
echo "    Evolution:    https://api.$DOMAIN"
