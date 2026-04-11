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

echo "==> Substituindo SEU_DOMINIO no nginx.conf..."
source .env 2>/dev/null || true
DOMAIN="${DOMAIN:-$(grep ADMIN_URL .env | cut -d= -f2 | sed 's|https\?://||')}"
sed -i "s/SEU_DOMINIO/$DOMAIN/g" nginx/nginx.conf 2>/dev/null || true

echo "==> Build do painel administrativo (React/Vite)..."
cd admin-panel
# Remove node_modules e lock para garantir binários nativos compatíveis com o SO atual
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
echo "    API:          http://api.$DOMAIN"
echo "    Painel:       http://admin.$DOMAIN"
echo "    Evolution:    http://evolution.$DOMAIN"
echo "    Health check: http://api.$DOMAIN/health"
echo ""
echo "    Para SSL, instale certbot e execute:"
echo "    certbot --nginx -d $DOMAIN -d evolution.$DOMAIN"
