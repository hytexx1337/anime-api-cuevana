#!/bin/bash

# 🚀 Deployment script para Streaming API
set -e

echo "🎬 ========== STREAMING API DEPLOYMENT =========="
echo ""

# Verificar que estamos en el directorio correcto
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found. Run this script from streaming-api directory."
    exit 1
fi

# 1. Instalar/actualizar dependencias
echo "1️⃣  Installing dependencies..."
npm install --production
echo "✅ Dependencies installed"

# 2. Crear directorios necesarios
echo ""
echo "2️⃣  Creating directories..."
mkdir -p logs
mkdir -p .cache/m3u8
echo "✅ Directories created"

# 3. Verificar .env
echo ""
echo "3️⃣  Checking .env file..."
if [ ! -f ".env" ]; then
    echo "⚠️  No .env file found. Copying from env.example..."
    cp env.example .env
    echo "⚠️  IMPORTANT: Edit .env file with your configuration!"
    echo "   nano .env"
    exit 1
else
    echo "✅ .env file exists"
fi

# 4. Verificar Chrome para Puppeteer
echo ""
echo "4️⃣  Checking Chrome installation for Puppeteer..."
if ! npx puppeteer browsers list 2>/dev/null | grep -q "chrome"; then
    echo "⚠️  Chrome not found. Installing..."
    npx puppeteer browsers install chrome
    echo "✅ Chrome installed"
else
    echo "✅ Chrome already installed"
fi

# 5. Detener PM2 si está corriendo
echo ""
echo "5️⃣  Stopping PM2 (if running)..."
pm2 stop streaming-api 2>/dev/null || echo "   (not running)"
pm2 delete streaming-api 2>/dev/null || echo "   (not registered)"

# 6. Iniciar con PM2
echo ""
echo "6️⃣  Starting with PM2..."
pm2 start ecosystem.config.cjs
pm2 save

echo ""
echo "✅ ========== DEPLOYMENT COMPLETE =========="
echo ""
echo "📊 Check status:"
echo "   pm2 status"
echo "   pm2 logs streaming-api"
echo "   pm2 monit"
echo ""
echo "🧪 Test API:"
echo "   curl http://localhost:4000/health"
echo ""
echo "📡 Extract streams (GET - simple):"
echo "   curl http://localhost:4000/api/streams/extract/movie/603"
echo ""
echo "📡 Extract streams (POST - flexible):"
echo "   curl -X POST http://localhost:4000/api/streams/extract \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"type\":\"movie\",\"tmdbId\":\"603\"}'"
echo ""

