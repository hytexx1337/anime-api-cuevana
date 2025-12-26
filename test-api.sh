#!/bin/bash

# 🧪 Script de pruebas rápidas para Streaming API

API_URL=${1:-"http://localhost:4000"}

echo "🎬 ========== STREAMING API TESTS =========="
echo "API URL: $API_URL"
echo ""

# Test 1: Health Check
echo "1️⃣  Health Check..."
curl -s "$API_URL/health" | jq '.' || echo "❌ Failed"
echo ""

# Test 2: Cache Stats
echo "2️⃣  Cache Stats..."
curl -s "$API_URL/api/cache/stats" | jq '.' || echo "❌ Failed"
echo ""

# Test 3: Extract Movie (The Matrix)
echo "3️⃣  Extract Movie (The Matrix - TMDB 603)..."
curl -s "$API_URL/api/streams/extract/movie/603" | jq '.sources | keys' || echo "❌ Failed"
echo ""

# Test 4: Extract TV Show (Breaking Bad S01E01)
echo "4️⃣  Extract TV Show (Breaking Bad S01E01 - TMDB 1396)..."
curl -s "$API_URL/api/streams/extract/tv/1396?season=1&episode=1" | jq '.sources | keys' || echo "❌ Failed"
echo ""

# Test 5: Extract Movie with POST
echo "5️⃣  Extract Movie with POST (Avatar - TMDB 19995)..."
curl -s -X POST "$API_URL/api/streams/extract" \
  -H 'Content-Type: application/json' \
  -d '{"type":"movie","tmdbId":"19995"}' | jq '.sources | keys' || echo "❌ Failed"
echo ""

# Test 6: Cleanup Zombie Pages
echo "6️⃣  Cleanup Zombie Pages..."
curl -s -X POST "$API_URL/api/browser/cleanup" | jq '.cleaned' || echo "❌ Failed"
echo ""

echo "✅ ========== TESTS COMPLETE =========="
echo ""
echo "💡 Tip: Install jq for better JSON output"
echo "   sudo apt install jq"
echo ""

