import cacheService from '../services/cache.service.js';
import logger from '../utils/logger.js';

const CUEVANA_API_URL = process.env.CUEVANA_API_URL || 'https://api.cineparatodos.lat';

/**
 * Extrae stream latino de Cuevana (API ya hosteada)
 */
export async function extractCuevana(type, tmdbId, season, episode) {
  const startTime = Date.now();
  const logPrefix = type === 'tv'
    ? `[CUEVANA] TV ${tmdbId} S${season}E${episode}`
    : `[CUEVANA] Movie ${tmdbId}`;

  // 1. Verificar cache
  const cached = await cacheService.get('cuevana', type, tmdbId, season, episode);
  if (cached) {
    if (cached.streamUrl && cached.streamUrl !== 'NOT_AVAILABLE') {
      logger.info(`${logPrefix} ✅ Cache hit (${Date.now() - startTime}ms)`);
      return {
        success: true,
        streamUrl: cached.streamUrl,
        sourceUrl: cached.sourceUrl,
        player: cached.player || 'unknown',
        cached: true,
        provider: 'cuevana',
        extractionTimeMs: Date.now() - startTime
      };
    } else if (cached.streamUrl === 'NOT_AVAILABLE') {
      logger.info(`${logPrefix} ⚠️  Content not available (cached negative)`);
      return {
        success: false,
        error: 'Content not available on Cuevana (cached)',
        provider: 'cuevana',
        cached: true,
        extractionTimeMs: Date.now() - startTime
      };
    }
  }

  // 2. Construir URL de la API de Cuevana
  let apiUrl;
  if (type === 'tv') {
    if (!season || !episode) {
      return {
        success: false,
        error: 'Season and episode required for TV',
        provider: 'cuevana',
        extractionTimeMs: Date.now() - startTime
      };
    }
    apiUrl = `${CUEVANA_API_URL}/fast/tv/${tmdbId}/${season}/${episode}`;
  } else {
    apiUrl = `${CUEVANA_API_URL}/fast/movie/${tmdbId}`;
  }

  try {
    logger.info(`${logPrefix} 🚀 Fetching from API...`);
    
    // 3. Llamar a la API de Cuevana
    const response = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'streaming-api/1.0'
      },
      signal: AbortSignal.timeout(20000) // ⬆️ Aumentado de 10s a 20s
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const extractionTime = Date.now() - startTime;

    // 4. Validar respuesta
    if (!data.video || !data.video.url || data.video.status !== 'success') {
      logger.warn(`${logPrefix} ❌ No valid video in response (${extractionTime}ms)`);
      
      // Cache negativo (7 días)
      await cacheService.set('cuevana', type, tmdbId, {
        streamUrl: 'NOT_AVAILABLE',
        sourceUrl: apiUrl
      }, season, episode);
      
      return {
        success: false,
        error: 'No valid video in Cuevana response',
        provider: 'cuevana',
        extractionTimeMs: extractionTime
      };
    }

    // 5. Guardar en cache (7 días)
    await cacheService.set('cuevana', type, tmdbId, {
      streamUrl: data.video.url,
      sourceUrl: apiUrl,
      player: data.video.player || 'unknown'
    }, season, episode);

    logger.info(`${logPrefix} ✅ Success! (${extractionTime}ms, player: ${data.video.player})`);

    return {
      success: true,
      streamUrl: data.video.url,
      sourceUrl: apiUrl,
      player: data.video.player || 'unknown',
      cached: false,
      provider: 'cuevana',
      extractionTimeMs: extractionTime
    };

  } catch (error) {
    logger.error(`${logPrefix} ❌ Error:`, error.message);
    return {
      success: false,
      error: error.message,
      provider: 'cuevana',
      extractionTimeMs: Date.now() - startTime
    };
  }
}

