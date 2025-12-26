# 🎬 Streaming API - Unified Multi-Provider

API unificada de alto rendimiento para extraer streams de películas y series desde múltiples proveedores.

## 🚀 Características

- **Múltiples Proveedores**: Vidlink, Cuevana (Latino), Vidify (English Dub), Kenjitsu (Anime)
- **Soporte para Anime**: Detección automática de anime japonés con providers especializados (HiAnime, AllAnime, Animepahe, Kaido)
- **Extracción en Paralelo**: Obtiene streams de todos los proveedores simultáneamente
- **Caching Multinivel**: Almacenamiento en memoria y filesystem con TTL de 7 días
- **Pool de Puppeteer**: Gestión eficiente de sesiones del navegador
- **Optimizado para Escala**: Diseñado para miles de usuarios concurrentes con PM2 cluster mode
- **Fallbacks Inteligentes**: Múltiples proveedores de respaldo por idioma

## 📋 Requisitos

- Node.js 18+
- Chrome/Chromium (instalado automáticamente por Puppeteer)
- PM2 (para producción)
- 2GB+ RAM recomendado

## 🔧 Instalación Rápida

```bash
# Clonar repo
git clone https://github.com/hytexx1337/anime-api-cuevana.git
cd anime-api-cuevana

# Instalar dependencias
npm install

# Configurar variables de entorno
cp env.example .env
nano .env

# Iniciar con PM2
npm run deploy
```

## 🌐 Endpoints

### GET/POST `/api/streams/extract`

Extrae streams de películas o series.

**Parámetros:**
- `type`: "movie" o "tv"
- `tmdbId`: ID de TMDB
- `season`: Temporada (solo TV)
- `episode`: Episodio (solo TV)

**Ejemplo:**
```bash
# Anime (Dan Da Dan)
curl "http://localhost:4000/api/streams/extract/tv/240411?season=1&episode=1"

# Película
curl "http://localhost:4000/api/streams/extract/movie/603"
```

**Respuesta:**
```json
{
  "success": true,
  "sources": {
    "original": {
      "streamUrl": "https://...",
      "subtitles": [...],
      "provider": "HiAnime"
    },
    "englishDub": {
      "streamUrl": "https://...",
      "provider": "HiAnime"
    },
    "latino": {
      "streamUrl": "https://...",
      "provider": "cuevana"
    }
  },
  "metadata": {
    "isAnime": true,
    "totalTimeMs": 3245,
    "cached": {...}
  }
}
```

## 🎌 Soporte para Anime

La API detecta automáticamente anime japonés (género Animation + país JP) y usa providers especializados:

- **Original (SUB)**: Japonés con subtítulos
- **English Dub (DUB)**: Doblaje en inglés
- **Latino**: Español latino (Cuevana)

Providers de anime: HiAnime, AllAnime, Animepahe, Kaido (todos en paralelo con race para velocidad).

## 🛠️ Arquitectura

```
streaming-api/
├── src/
│   ├── server.js              # Express server principal
│   ├── providers/             # Extractores por provider
│   │   ├── vidlink.provider.js
│   │   ├── cuevana.provider.js
│   │   ├── vidify-native.provider.js
│   │   └── anime.provider.js  # Kenjitsu + anime providers
│   ├── services/
│   │   ├── browser.service.js # Pool de Puppeteer
│   │   └── cache.service.js   # Sistema de caching
│   └── utils/
│       └── logger.js          # Winston logger
├── ecosystem.config.cjs       # PM2 cluster config
└── deploy.sh                  # Script de deployment
```

## 📊 Monitoreo

```bash
# Ver logs en tiempo real
pm2 logs streaming-api

# Ver métricas
curl http://localhost:4000/metrics

# Limpiar páginas zombie de Puppeteer
curl -X POST http://localhost:4000/api/browser/cleanup
```

## 🔐 Variables de Entorno

Ver `env.example` para todas las opciones. Las más importantes:

```env
PORT=4000
MAX_PUPPETEER_WORKERS=3
CACHE_TTL_DAYS=7
TMDB_BEARER=tu_token_aqui
KENJITSU_API_URL=https://tu-instancia.koyeb.app
CUEVANA_API_URL=https://api.cineparatodos.lat
```

## 📈 Performance

- **Extracción paralela**: ~3-5 segundos para obtener 3 proveedores
- **Cache hit**: <100ms
- **Soporte concurrente**: 1000+ usuarios con 2 instancias PM2
- **Cleanup automático**: Puppeteer pages se limpian cada 2 minutos

## 🤝 Contribuir

Pull requests son bienvenidos. Para cambios mayores, abre un issue primero.

## 📝 Licencia

MIT

## 🔗 Links

- [TMDB API](https://www.themoviedb.org/documentation/api)
- [Kenjitsu Docs](https://kenjitsu-docs.vercel.app/)
- [Cuevana API](https://api.cineparatodos.lat)

---

**Desarrollado con ❤️ para la comunidad de streaming**

