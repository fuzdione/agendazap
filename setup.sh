#!/bin/bash
# =============================================================
# AgendaZap — setup inicial no servidor Hetzner (Ubuntu 24.04)
# Execute como root: bash setup.sh
# =============================================================
set -e

echo "==> Atualizando pacotes..."
apt-get update -qq && apt-get upgrade -y -qq

echo "==> Instalando Docker..."
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker

echo "==> Instalando Docker Compose plugin..."
apt-get install -y docker-compose-plugin

echo "==> Instalando utilitários..."
apt-get install -y git curl ufw

echo "==> Configurando firewall (UFW)..."
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "==> Clonando repositório..."
# Ajuste a URL abaixo para o seu repositório
read -p "URL do repositório git (ex: git@github.com:user/agendazap.git): " REPO_URL
git clone "$REPO_URL" /opt/agendazap
cd /opt/agendazap

echo "==> Configurando variáveis de ambiente..."
cp .env.prod.example .env
echo ""
echo "ATENÇÃO: Edite o arquivo /opt/agendazap/.env com seus valores reais."
echo "         Depois execute: cd /opt/agendazap && bash deploy.sh"
echo ""
echo "         Use: nano /opt/agendazap/.env"
