import express from 'express';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

import logger from './utils/logger.js';
import browserService from './services/browser.service.js';
import cacheService from './services/cache.service.js';

import { extractVidlink } from './providers/vidlink.provider.js';
import { extractCuevana } from './providers/cuevana.provider.js';
import { extractVidify } from './providers/vidify-native.provider.js';
import { extractAnimeStream } from './providers/anime.provider.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(compression());
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000, // 1 minuto
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: 'Too many requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api/', limiter);

// ============================================================================
// HEALTH CHECK
// ============================================================================
app.get('/health', async (req, res) => {
  const browserStats = browserService.getStats();
  
  // Verificar si hay páginas zombie
  const hasZombies = browserStats.activePages !== browserStats.actualActivePages;
  
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    browser: browserStats,
    warnings: hasZombies ? ['Zombie pages detected'] : [],
    memory: {
      used: Math.floor(process.memoryUsage().heapUsed / 1024 / 1024),
      total: Math.floor(process.memoryUsage().heapTotal / 1024 / 1024),
      rss: Math.floor(process.memoryUsage().rss / 1024 / 1024)
    }
  });
});

// ============================================================================
// CLEANUP ZOMBIE PAGES
// ============================================================================
app.post('/api/browser/cleanup', async (req, res) => {
  try {
    const cleaned = await browserService.cleanupZombiePages();
    const stats = browserService.getStats();
    
    res.json({
      success: true,
      cleaned,
      message: `${cleaned} zombie pages cleaned`,
      currentStats: stats
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// CACHE STATS
// ============================================================================
app.get('/api/cache/stats', async (req, res) => {
  try {
    const stats = await cacheService.getStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// INVALIDATE CACHE
// ============================================================================
app.delete('/api/cache/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;
    const { season, episode } = req.query;
    
    const invalidated = await cacheService.invalidate(type, id, season, episode);
    
    res.json({
      success: true,
      invalidated,
      message: `${invalidated} cache entries invalidated`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// MAIN ENDPOINTS: EXTRACT STREAMS
// ============================================================================
/**
 * GET /api/streams/extract/:type/:tmdbId (alternativo, para testing)
 * GET /api/streams/extract/movie/603
 * GET /api/streams/extract/tv/1396?season=1&episode=5
 */
app.get('/api/streams/extract/:type/:tmdbId', async (req, res) => {
  const startTime = Date.now();
  const { type, tmdbId } = req.params;
  const { season, episode, imdbId } = req.query;

  // Validación
  if (!type || !tmdbId) {
    return res.status(400).json({ 
      error: 'Missing required params: type, tmdbId' 
    });
  }

  if (type === 'tv' && (!season || !episode)) {
    return res.status(400).json({
      error: 'For TV, season and episode query params are required'
    });
  }

  const identifier = type === 'tv'
    ? `TV ${tmdbId} S${season}E${episode}`
    : `Movie ${tmdbId}`;

  logger.info(`\n🎬 [EXTRACT-GET] Request: ${identifier}`);

  try {
    // STEP 1: Intentar con anime provider primero
    logger.info(`🔍 [EXTRACT-GET] Checking if anime...`);
    const animeResult = await extractAnimeStream(tmdbId, type, season, episode);
    
    // Si ES ANIME, usar solo el anime provider
    if (animeResult.success) {
      logger.info(`🎌 [EXTRACT-GET] Confirmed ANIME: Using Kenjitsu providers`);
      
      const sources = {
        original: null,
        latino: null,
        englishDub: null
      };

      const cached = {
        original: false,
        latino: false,
        englishDub: false
      };

      // Procesar streams de anime
      if (animeResult.streams.original) {
        const stream = animeResult.streams.original;
        sources.original = {
          streamUrl: stream.sources[0]?.url,
          subtitles: stream.subtitles || [],
          provider: stream.provider,
          quality: stream.sources.map(s => s.quality).join(', '),
          extractionTimeMs: stream.extractionTimeMs
        };
        cached.original = animeResult.cached || false;
      }

      if (animeResult.streams.dub) {
        const stream = animeResult.streams.dub;
        sources.englishDub = {
          streamUrl: stream.sources[0]?.url,
          subtitles: stream.subtitles || [],
          provider: stream.provider,
          quality: stream.sources.map(s => s.quality).join(', '),
          extractionTimeMs: stream.extractionTimeMs
        };
        cached.englishDub = animeResult.cached || false;
      }

      if (animeResult.streams.latino) {
        const stream = animeResult.streams.latino;
        sources.latino = {
          streamUrl: stream.sources[0]?.url,
          provider: stream.provider,
          extractionTimeMs: stream.extractionTimeMs
        };
        cached.latino = animeResult.cached || false;
      }

      const totalTime = Date.now() - startTime;
      const successCount = [sources.original, sources.latino, sources.englishDub].filter(s => s !== null).length;

      logger.info(`🎉 [EXTRACT-GET] ANIME Completed: ${successCount} sources in ${totalTime}ms`);

      return res.json({
        success: successCount > 0,
        sources,
        metadata: {
          identifier,
          isAnime: true,
          animeTitle: animeResult.title,
          extractedAt: new Date().toISOString(),
          totalTimeMs: totalTime,
          cached,
          successCount,
          totalProviders: 'kenjitsu+cuevana'
        }
      });
    }

    // NO ES ANIME: usar providers normales
    logger.info(`🚀 [EXTRACT-GET] Not anime, using standard providers: Vidlink, Cuevana, Vidify...`);
    
    const [vidlinkResult, cuevanaResult, vidifyResult] = await Promise.allSettled([
      extractVidlink(type, tmdbId, season, episode),
      extractCuevana(type, tmdbId, season, episode),
      extractVidify(type, tmdbId, season, episode)
    ]);

    // Procesar resultados (mismo código que POST)
    const sources = {
      original: null,
      latino: null,
      englishDub: null
    };

    const cached = {
      original: false,
      latino: false,
      englishDub: false
    };

    // 1. ORIGINAL (Vidlink)
    if (vidlinkResult.status === 'fulfilled' && vidlinkResult.value.success) {
      sources.original = {
        streamUrl: vidlinkResult.value.streamUrl,
        subtitles: vidlinkResult.value.subtitles || [],
        provider: 'vidlink',
        sourceUrl: vidlinkResult.value.sourceUrl,
        extractionTimeMs: vidlinkResult.value.extractionTimeMs
      };
      cached.original = vidlinkResult.value.cached;
      logger.info(`✅ [EXTRACT-GET] Vidlink (Original): SUCCESS (${vidlinkResult.value.extractionTimeMs}ms, cached: ${vidlinkResult.value.cached})`);
    } else {
      const error = vidlinkResult.status === 'fulfilled' 
        ? vidlinkResult.value.error 
        : vidlinkResult.reason?.message;
      logger.warn(`⚠️  [EXTRACT-GET] Vidlink (Original): FAILED - ${error}`);
    }

    // 2. LATINO (Cuevana)
    if (cuevanaResult.status === 'fulfilled' && cuevanaResult.value.success) {
      sources.latino = {
        streamUrl: cuevanaResult.value.streamUrl,
        provider: 'cuevana',
        player: cuevanaResult.value.player,
        sourceUrl: cuevanaResult.value.sourceUrl,
        extractionTimeMs: cuevanaResult.value.extractionTimeMs
      };
      cached.latino = cuevanaResult.value.cached;
      logger.info(`✅ [EXTRACT-GET] Cuevana (Latino): SUCCESS (${cuevanaResult.value.extractionTimeMs}ms, cached: ${cuevanaResult.value.cached})`);
    } else {
      const error = cuevanaResult.status === 'fulfilled'
        ? cuevanaResult.value.error
        : cuevanaResult.reason?.message;
      logger.warn(`⚠️  [EXTRACT-GET] Cuevana (Latino): FAILED - ${error}`);
    }

    // 3. ENGLISH DUB (Vidify)
    if (vidifyResult.status === 'fulfilled' && vidifyResult.value.success) {
      sources.englishDub = {
        streamUrl: vidifyResult.value.streamUrl,
        provider: 'vidify',
        server: vidifyResult.value.server,
        extractionTimeMs: vidifyResult.value.extractionTimeMs
      };
      cached.englishDub = vidifyResult.value.cached;
      logger.info(`✅ [EXTRACT-GET] Vidify (English Dub): SUCCESS (${vidifyResult.value.extractionTimeMs}ms, cached: ${vidifyResult.value.cached})`);
    } else {
      const error = vidifyResult.status === 'fulfilled'
        ? vidifyResult.value.error
        : vidifyResult.reason?.message;
      
      // Solo logear warning si NO está deshabilitado
      if (vidifyResult.status === 'fulfilled' && vidifyResult.value.disabled) {
        logger.debug(`ℹ️  [EXTRACT-GET] Vidify (English Dub): DISABLED`);
      } else {
        logger.warn(`⚠️  [EXTRACT-GET] Vidify (English Dub): FAILED - ${error}`);
      }
    }

    const totalTime = Date.now() - startTime;
    const successCount = [sources.original, sources.latino, sources.englishDub].filter(s => s !== null).length;

    logger.info(`🎉 [EXTRACT-GET] Completed: ${successCount}/3 sources extracted in ${totalTime}ms`);

    // Respuesta
    res.json({
      success: successCount > 0,
      sources,
      metadata: {
        identifier,
        extractedAt: new Date().toISOString(),
        totalTimeMs: totalTime,
        cached,
        successCount,
        totalProviders: 3
      }
    });

  } catch (error) {
    logger.error(`❌ [EXTRACT-GET] Error:`, error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * POST /api/streams/extract
 * 
 * Body:
 * {
 *   "type": "movie" | "tv",
 *   "tmdbId": "603",
 *   "imdbId": "tt0133093" (opcional),
 *   "season": 1 (requerido si type=tv),
 *   "episode": 5 (requerido si type=tv)
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "sources": {
 *     "original": { streamUrl, subtitles, ... },
 *     "latino": { streamUrl, ... },
 *     "englishDub": { streamUrl, ... }
 *   },
 *   "metadata": {
 *     "extractedAt": "...",
 *     "totalTimeMs": 1234,
 *     "cached": { ... }
 *   }
 * }
 */
app.post('/api/streams/extract', async (req, res) => {
  const startTime = Date.now();
  const { type, tmdbId, imdbId, season, episode } = req.body;

  // Validación
  if (!type || !tmdbId) {
    return res.status(400).json({ 
      error: 'Missing required fields: type, tmdbId' 
    });
  }

  if (type === 'tv' && (!season || !episode)) {
    return res.status(400).json({
      error: 'For TV, season and episode are required'
    });
  }

  const identifier = type === 'tv'
    ? `TV ${tmdbId} S${season}E${episode}`
    : `Movie ${tmdbId}`;

  logger.info(`\n🎬 [EXTRACT] Request: ${identifier}`);

  try {
    // STEP 1: Intentar con anime provider primero (si es anime japonés)
    logger.info(`🔍 [EXTRACT] Checking if anime...`);
    const animeResult = await extractAnimeStream(tmdbId, type, season, episode);
    
    // Si ES ANIME, usar solo el anime provider
    if (animeResult.success) {
      logger.info(`🎌 [EXTRACT] Confirmed ANIME: Using Kenjitsu providers`);
      
      const sources = {
        original: null,
        latino: null,
        englishDub: null
      };

      const cached = {
        original: false,
        latino: false,
        englishDub: false
      };

      // Procesar streams de anime
      if (animeResult.streams.original) {
        const stream = animeResult.streams.original;
        sources.original = {
          streamUrl: stream.sources[0]?.url,
          subtitles: stream.subtitles || [],
          provider: stream.provider,
          quality: stream.sources.map(s => s.quality).join(', '),
          extractionTimeMs: stream.extractionTimeMs
        };
        cached.original = animeResult.cached || false;
      }

      if (animeResult.streams.dub) {
        const stream = animeResult.streams.dub;
        sources.englishDub = {
          streamUrl: stream.sources[0]?.url,
          subtitles: stream.subtitles || [],
          provider: stream.provider,
          quality: stream.sources.map(s => s.quality).join(', '),
          extractionTimeMs: stream.extractionTimeMs
        };
        cached.englishDub = animeResult.cached || false;
      }

      if (animeResult.streams.latino) {
        const stream = animeResult.streams.latino;
        sources.latino = {
          streamUrl: stream.sources[0]?.url,
          provider: stream.provider,
          extractionTimeMs: stream.extractionTimeMs
        };
        cached.latino = animeResult.cached || false;
      }

      const totalTime = Date.now() - startTime;
      const successCount = [sources.original, sources.latino, sources.englishDub].filter(s => s !== null).length;

      logger.info(`🎉 [EXTRACT] ANIME Completed: ${successCount} sources in ${totalTime}ms`);

      return res.json({
        success: successCount > 0,
        sources,
        metadata: {
          identifier,
          isAnime: true,
          animeTitle: animeResult.title,
          extractedAt: new Date().toISOString(),
          totalTimeMs: totalTime,
          cached,
          successCount,
          totalProviders: 'kenjitsu+cuevana'
        }
      });
    }

    // NO ES ANIME: usar providers normales
    logger.info(`🚀 [EXTRACT] Not anime, using standard providers: Vidlink, Cuevana, Vidify...`);
    
    const [vidlinkResult, cuevanaResult, vidifyResult] = await Promise.allSettled([
      extractVidlink(type, tmdbId, season, episode),
      extractCuevana(type, tmdbId, season, episode),
      extractVidify(type, tmdbId, season, episode)
    ]);

    // Procesar resultados
    const sources = {
      original: null,
      latino: null,
      englishDub: null
    };

    const cached = {
      original: false,
      latino: false,
      englishDub: false
    };

    // 1. ORIGINAL (Vidlink)
    if (vidlinkResult.status === 'fulfilled' && vidlinkResult.value.success) {
      sources.original = {
        streamUrl: vidlinkResult.value.streamUrl,
        subtitles: vidlinkResult.value.subtitles || [],
        provider: 'vidlink',
        sourceUrl: vidlinkResult.value.sourceUrl,
        extractionTimeMs: vidlinkResult.value.extractionTimeMs
      };
      cached.original = vidlinkResult.value.cached;
      logger.info(`✅ [EXTRACT] Vidlink (Original): SUCCESS (${vidlinkResult.value.extractionTimeMs}ms, cached: ${vidlinkResult.value.cached})`);
    } else {
      const error = vidlinkResult.status === 'fulfilled' 
        ? vidlinkResult.value.error 
        : vidlinkResult.reason?.message;
      logger.warn(`⚠️  [EXTRACT] Vidlink (Original): FAILED - ${error}`);
    }

    // 2. LATINO (Cuevana)
    if (cuevanaResult.status === 'fulfilled' && cuevanaResult.value.success) {
      sources.latino = {
        streamUrl: cuevanaResult.value.streamUrl,
        provider: 'cuevana',
        player: cuevanaResult.value.player,
        sourceUrl: cuevanaResult.value.sourceUrl,
        extractionTimeMs: cuevanaResult.value.extractionTimeMs
      };
      cached.latino = cuevanaResult.value.cached;
      logger.info(`✅ [EXTRACT] Cuevana (Latino): SUCCESS (${cuevanaResult.value.extractionTimeMs}ms, cached: ${cuevanaResult.value.cached})`);
    } else {
      const error = cuevanaResult.status === 'fulfilled'
        ? cuevanaResult.value.error
        : cuevanaResult.reason?.message;
      logger.warn(`⚠️  [EXTRACT] Cuevana (Latino): FAILED - ${error}`);
    }

    // 3. ENGLISH DUB (Vidify)
    if (vidifyResult.status === 'fulfilled' && vidifyResult.value.success) {
      sources.englishDub = {
        streamUrl: vidifyResult.value.streamUrl,
        provider: 'vidify',
        server: vidifyResult.value.server,
        extractionTimeMs: vidifyResult.value.extractionTimeMs
      };
      cached.englishDub = vidifyResult.value.cached;
      logger.info(`✅ [EXTRACT] Vidify (English Dub): SUCCESS (${vidifyResult.value.extractionTimeMs}ms, cached: ${vidifyResult.value.cached})`);
    } else {
      const error = vidifyResult.status === 'fulfilled'
        ? vidifyResult.value.error
        : vidifyResult.reason?.message;
      
      // Solo logear warning si NO está deshabilitado
      if (vidifyResult.status === 'fulfilled' && vidifyResult.value.disabled) {
        logger.debug(`ℹ️  [EXTRACT] Vidify (English Dub): DISABLED`);
      } else {
        logger.warn(`⚠️  [EXTRACT] Vidify (English Dub): FAILED - ${error}`);
      }
    }

    const totalTime = Date.now() - startTime;
    const successCount = [sources.original, sources.latino, sources.englishDub].filter(s => s !== null).length;

    logger.info(`🎉 [EXTRACT] Completed: ${successCount}/3 sources extracted in ${totalTime}ms`);

    // Respuesta
    res.json({
      success: successCount > 0,
      sources,
      metadata: {
        identifier,
        extractedAt: new Date().toISOString(),
        totalTimeMs: totalTime,
        cached,
        successCount,
        totalProviders: 3
      }
    });

  } catch (error) {
    logger.error(`❌ [EXTRACT] Error:`, error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// ============================================================================
// ERROR HANDLER
// ============================================================================
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// ============================================================================
// START SERVER
// ============================================================================
const server = app.listen(PORT, () => {
  logger.info(`🚀 Streaming API listening on port ${PORT}`);
  logger.info(`📊 Health check: http://localhost:${PORT}/health`);
  logger.info(`🎬 Extract endpoint: POST http://localhost:${PORT}/api/streams/extract`);
  logger.info(`📦 Cache stats: GET http://localhost:${PORT}/api/cache/stats`);
  
  // PM2 ready signal
  if (process.send) {
    process.send('ready');
  }
});

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================
process.on('SIGINT', async () => {
  logger.info('🛑 SIGINT received, shutting down gracefully...');
  
  server.close(async () => {
    logger.info('✅ HTTP server closed');
    
    // Cerrar browser
    await browserService.close();
    
    logger.info('✅ Cleanup complete, exiting');
    process.exit(0);
  });
  
  // Force exit after 10s
  setTimeout(() => {
    logger.error('⚠️  Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
});

process.on('SIGTERM', async () => {
  logger.info('🛑 SIGTERM received, shutting down gracefully...');
  
  server.close(async () => {
    await browserService.close();
    logger.info('✅ Cleanup complete, exiting');
    process.exit(0);
  });
});

export default app;

