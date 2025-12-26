# 🎬 Streaming API - Extracción Unificada de Streams

API profesional para extracción de streams de películas y series desde múltiples proveedores.

## ✨ Features

- ✅ **Extracción en paralelo** de 3 proveedores principales (Vidlink, Cuevana, Vidify)
- ✅ **Cache inteligente** (filesystem, 7 días TTL)
- ✅ **Pool de Puppeteer** (máx 10 workers, reutilizables)
- ✅ **Fallbacks automáticos** (Videasy, Vidking, 111movies)
- ✅ **Rate limiting** (100 req/min por IP)
- ✅ **Health checks** y métricas
- ✅ **Graceful shutdown**
- ✅ **PM2 Cluster mode** (2 instancias)

## 📦 Proveedores

| Provider | Idioma | Método | Velocidad | Subtítulos | Status |
|----------|--------|--------|-----------|------------|--------|
| **Vidlink** | Original | Puppeteer | ⚡ 1-3s | ✅ Múltiples | ✅ Habilitado |
| **Cuevana** | Latino | HTTP API | ⚡⚡ <1s | ❌ No | ✅ Habilitado |
| **Vidify** | English Dub | Crypto API | ⚡⚡ <1s | ❌ No | ✅ Habilitado |
| Videasy | Original | Puppeteer | 3-5s | ❌ No | 🚧 TODO |
| Vidking | Original | Puppeteer | 3-5s | ❌ No | 🚧 TODO |
| 111movies | Original | Puppeteer | 5-10s | ❌ No | 🚧 TODO |

**Todos los proveedores principales están completamente funcionales sin configuración adicional.**

## 🚀 Installation

### 1. Clonar/Copiar archivos al VPS

```bash
# En el VPS de scraping (srv1054546)
cd ~
mkdir -p streaming-api
cd streaming-api

# Copiar archivos desde tu PC (usa scp o FileZilla)
```

### 2. Instalar dependencias

```bash
npm install
```

### 3. Configurar environment variables

```bash
cp env.example .env
nano .env
```

Variables importantes:
```env
PORT=4000
CUEVANA_API_URL=https://api.cineparatodos.lat
TMDB_API_KEY=your_key_here
MAX_PUPPETEER_WORKERS=10
CACHE_TTL_DAYS=7
```

### 4. Crear directorio de logs

```bash
mkdir -p logs
mkdir -p .cache
```

### 5. Iniciar con PM2

```bash
# Desarrollo (con logs)
npm run dev

# Producción (cluster mode, 2 instancias)
npm run pm2:start

# Ver logs
npm run pm2:logs

# Reiniciar
npm run pm2:restart

# Detener
npm run pm2:stop

# Monitoreo
npm run pm2:monit
```

## 📡 API Endpoints

### 1. Extract Streams (Principal)

#### Opción A: GET (más simple, para testing)

```http
GET /api/streams/extract/movie/603
GET /api/streams/extract/tv/1396?season=1&episode=5
```

**Ejemplo con curl:**
```bash
# Película
curl http://localhost:4000/api/streams/extract/movie/603

# Serie
curl "http://localhost:4000/api/streams/extract/tv/1396?season=1&episode=5"
```

#### Opción B: POST (más flexible)

```http
POST /api/streams/extract
Content-Type: application/json

{
  "type": "movie",
  "tmdbId": "603",
  "imdbId": "tt0133093" (opcional)
}
```

Para series:
```json
{
  "type": "tv",
  "tmdbId": "1396",
  "season": 1,
  "episode": 5
}
```

**Response:**
```json
{
  "success": true,
  "sources": {
    "original": {
      "streamUrl": "https://...",
      "subtitles": [
        { "url": "...", "language": "eng", "label": "English" }
      ],
      "provider": "vidlink",
      "extractionTimeMs": 1234
    },
    "latino": {
      "streamUrl": "https://...",
      "provider": "cuevana",
      "player": "streamwish",
      "extractionTimeMs": 456
    },
    "englishDub": {
      "streamUrl": "https://...",
      "provider": "vidify",
      "server": "server1",
      "extractionTimeMs": 789
    }
  },
  "metadata": {
    "identifier": "Movie 603",
    "extractedAt": "2025-12-26T...",
    "totalTimeMs": 1500,
    "cached": {
      "original": false,
      "latino": true,
      "englishDub": false
    },
    "successCount": 3,
    "totalProviders": 3
  }
}
```

### 2. Health Check

```http
GET /health
```

**Response:**
```json
{
  "status": "ok",
  "uptime": 12345,
  "timestamp": "2025-12-26T...",
  "browser": {
    "active": true,
    "activePages": 2,
    "maxWorkers": 10,
    "totalPagesCreated": 156,
    "uptimeSeconds": 3600,
    "availableSlots": 8
  },
  "memory": {
    "used": 450,
    "total": 512,
    "rss": 520
  }
}
```

### 3. Cache Stats

```http
GET /api/cache/stats
```

**Response:**
```json
{
  "total": 150,
  "valid": 145,
  "expired": 5,
  "totalSizeMB": "2.34",
  "byProvider": {
    "vidlink": 50,
    "cuevana": 48,
    "vidify": 47
  }
}
```

### 4. Invalidate Cache

```http
DELETE /api/cache/movie/603
DELETE /api/cache/tv/1396?season=1&episode=5
```

**Response:**
```json
{
  "success": true,
  "invalidated": 3,
  "message": "3 cache entries invalidated"
}
```

### 5. Cleanup Zombie Pages

```http
POST /api/browser/cleanup
```

Limpia páginas de Puppeteer que no se cerraron correctamente (zombie pages).

**Response:**
```json
{
  "success": true,
  "cleaned": 2,
  "message": "2 zombie pages cleaned",
  "currentStats": {
    "active": true,
    "activePages": 3,
    "actualActivePages": 3,
    "maxWorkers": 10
  }
}
```

## 🔧 Integration con Next.js

### En tu Next.js app, reemplaza las llamadas actuales:

**Antes (múltiples endpoints):**
```typescript
// Llamadas separadas a vidlink-puppeteer, cuevana, vidify-unified
const vidlink = await fetch('/api/vidlink-puppeteer?...');
const cuevana = await fetch('https://api.cineparatodos.lat/fast/...');
const vidify = await fetch('/api/streams/vidify-unified?...');
```

**Después (un solo endpoint):**
```typescript
// Llamada unificada a la Streaming API
const response = await fetch('http://SCRAPING_VPS_IP:4000/api/streams/extract', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    type: 'movie',
    tmdbId: '603',
    imdbId: 'tt0133093'
  })
});

const { sources } = await response.json();

// sources.original → Vidlink (Original + subs)
// sources.latino → Cuevana (Latino)
// sources.englishDub → Vidify (English Dub)
```

## 📊 Monitoring

### Logs

```bash
# PM2 logs en tiempo real
pm2 logs streaming-api

# Logs de archivos
tail -f logs/combined.log
tail -f logs/error.log
```

### Métricas de Puppeteer

```bash
# Cuántas páginas activas
curl http://localhost:4000/health | jq '.browser'

# Stats de cache
curl http://localhost:4000/api/cache/stats
```

### PM2 Monitoring

```bash
pm2 monit
pm2 list
pm2 info streaming-api
```

## 🐛 Troubleshooting

### Puppeteer no encuentra Chrome

```bash
# Instalar Chrome para Puppeteer
npx puppeteer browsers install chrome
```

### Error "Maximum workers reached"

Aumenta el límite en `.env`:
```env
MAX_PUPPETEER_WORKERS=15
```

### Memory leaks

El browser se reinicia automáticamente cada 1 hora. Si hay problemas:
```bash
pm2 restart streaming-api
```

### Cache corrupto

```bash
# Limpiar todo el cache
rm -rf .cache
mkdir .cache
```

## 🔐 Security

### Rate Limiting

Por defecto: 100 requests/min por IP. Cambiar en `.env`:
```env
RATE_LIMIT_MAX_REQUESTS=200
RATE_LIMIT_WINDOW_MS=60000
```

### CORS

Por defecto permite todos los orígenes. Para restringir, modifica `server.js`:
```javascript
app.use(cors({
  origin: ['https://tudominio.com']
}));
```

## 📈 Performance

### Benchmarks típicos:

- **Cache hit**: <50ms
- **Vidlink (Puppeteer)**: 1-3s
- **Cuevana (HTTP)**: <500ms
- **Vidify (HTTP)**: <500ms
- **Total (paralelo)**: 1.5-3s
- **Total (todo desde cache)**: <100ms

### Capacidad:

- **Max workers**: 10 páginas de Puppeteer simultáneas
- **Cluster mode**: 2 instancias PM2
- **Cache**: Ilimitado (filesystem)
- **Rate limit**: 100 req/min por IP (configurable)

## 📝 TODO / Roadmap

- [ ] Implementar fallbacks (Videasy, Vidking, 111movies)
- [ ] Migrar lógica de vidify-crypto directamente a este servicio
- [ ] Agregar Redis para cache distribuido (opcional)
- [ ] Agregar Prometheus metrics
- [ ] Implementar circuit breaker para providers fallidos
- [ ] Agregar webhooks para notificar cuando cache expira
- [ ] Agregar soporte para anime-api (AniList/MAL IDs)

## 📄 License

MIT

