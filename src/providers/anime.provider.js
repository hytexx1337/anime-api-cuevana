/**
 * Anime Provider - Integración con Kenjitsu (HiAnime, AllAnime, Animepahe, Kaido) + Cuevana
 * 
 * Solo se activa para anime japonés (Animation + country: JP)
 * 
 * Flujo:
 * 1. TMDB ID → Obtener título y verificar si es anime japonés
 * 2. En PARALELO:
 *    - Kenjitsu providers (4 en paralelo: HiAnime, AllAnime, Animepahe, Kaido)
 *    - Cuevana (latino, usa TMDB ID)
 * 3. Retornar: { original, dub, latino }
 */

import axios from 'axios';
import logger from '../utils/logger.js';
import cacheService from '../services/cache.service.js';

const KENJITSU_API = 'https://fatal-jacklyn-nasheee1337-5d2fbb84.koyeb.app';
const CUEVANA_API_URL = 'https://api.cineparatodos.lat';
const TMDB_BEARER = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiIyMjYwNmNlMmU2MTJkOGQyYzQyNzhmYWNhNDE5Y2VjMSIsIm5iZiI6MTc1ODk0Njk4NC4yOTcsInN1YiI6IjY4ZDc2NmE4NWFmYjU3ZjJjZTUyZmMzZCIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.-KoF5Nloah5nLAlONDasUwMb9OUS_LbawNd8mdRGNBg';

// Providers de Kenjitsu (en orden de prioridad)
const KENJITSU_PROVIDERS = [
  { name: 'HiAnime', searchPath: '/api/hianime/anime/search', episodesPath: (id) => `/api/hianime/anime/${id}/episodes`, sourcesPath: (epId) => `/api/hianime/sources/${epId}`, sourcesParams: { version: 'dub', server: 'hd-2' } },
  { name: 'Kaido', searchPath: '/api/kaido/anime/search', episodesPath: (id) => `/api/kaido/anime/${id}/episodes`, sourcesPath: (epId) => `/api/kaido/sources/${epId}`, sourcesParams: {} },
  { name: 'Animepahe', searchPath: '/api/animepahe/anime/search', episodesPath: (id) => `/api/animepahe/anime/${id}/episodes`, sourcesPath: (epId) => `/api/animepahe/sources/${epId}`, sourcesParams: {} },
  { name: 'AllAnime', searchPath: '/api/allanime/anime/search', episodesPath: (id) => `/api/allanime/anime/${id}/episodes`, sourcesPath: (epId) => `/api/allanime/sources/${epId}`, sourcesParams: {} }
];

/**
 * Verificar si es anime japonés y obtener info de la temporada
 */
async function isJapaneseAnime(tmdbId, type, season) {
  const logPrefix = `[ANIME-CHECK]`;
  
  if (!TMDB_BEARER) {
    logger.warn(`${logPrefix} TMDB_BEARER not configured, skipping anime check`);
    return { isAnime: false };
  }

  try {
    const endpoint = type === 'movie' 
      ? `https://api.themoviedb.org/3/movie/${tmdbId}`
      : `https://api.themoviedb.org/3/tv/${tmdbId}`;
    
    const response = await axios.get(endpoint, {
      headers: { 'Authorization': `Bearer ${TMDB_BEARER}` },
      timeout: 5000
    });

    const data = response.data;
    const title = data.title || data.name;
    const originalTitle = data.original_title || data.original_name;
    const genres = data.genres || [];
    const countries = data.production_countries || data.origin_country || [];

    // Verificar si es Animation
    const isAnimation = genres.some(g => g.name === 'Animation' || g.id === 16);
    
    // Verificar si es de Japón
    const isJapanese = countries.some(c => c === 'JP' || c.iso_3166_1 === 'JP');

    const isAnime = isAnimation && isJapanese;

    let searchTitle = title;
    let seasonYear = null;

    // Para series, obtener info de la temporada específica
    if (type === 'tv' && season && season > 1) {
      try {
        const seasonEndpoint = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}`;
        const seasonResp = await axios.get(seasonEndpoint, {
          headers: { 'Authorization': `Bearer ${TMDB_BEARER}` },
          timeout: 5000
        });
        
        const seasonData = seasonResp.data;
        seasonYear = seasonData.air_date ? new Date(seasonData.air_date).getFullYear() : null;
        
        // Agregar "Season X" al título para búsqueda si es temporada > 1
        searchTitle = `${title} Season ${season}`;
        
        logger.info(`${logPrefix} Season ${season} aired in ${seasonYear}, search: "${searchTitle}"`);
      } catch (err) {
        logger.warn(`${logPrefix} Failed to fetch season ${season} info:`, err.message);
      }
    }

    logger.info(`${logPrefix} ${tmdbId} - ${title}: isAnime=${isAnime} (Animation=${isAnimation}, JP=${isJapanese})`);

    return {
      isAnime,
      title,
      originalTitle,
      searchTitle,
      seasonYear
    };

  } catch (error) {
    logger.error(`${logPrefix} Error checking TMDB:`, error.message);
    return { isAnime: false };
  }
}

/**
 * Buscar y obtener streams de un provider de Kenjitsu
 * @param {string} version - 'sub' o 'dub'
 * @param {number} seasonYear - Año de estreno de la temporada para filtrar resultados
 */
async function fetchFromKenjitsuProvider(provider, title, season, episode, version = 'sub', seasonYear = null) {
  const logPrefix = `[${provider.name}:${version}]`;
  const startTime = Date.now();

  try {
    // Step 1: Search
    logger.debug(`${logPrefix} Searching: "${title}"`);
    const searchResp = await axios.get(`${KENJITSU_API}${provider.searchPath}`, {
      params: { q: title, page: 1 },
      timeout: 10000
    });

    const results = searchResp.data.data || [];
    if (!Array.isArray(results) || results.length === 0) {
      throw new Error('No results found');
    }

    // Filtrar por año si está disponible (para distinguir temporadas)
    let matchedAnime = results[0]; // Default: primer resultado
    
    if (seasonYear && results.length > 1) {
      logger.debug(`${logPrefix} Filtering by year: ${seasonYear}`);
      
      // Buscar match exacto por año en releaseDate
      const yearMatch = results.find(r => {
        if (r.releaseDate) {
          const releaseYear = parseInt(r.releaseDate);
          return releaseYear === seasonYear;
        }
        return false;
      });
      
      if (yearMatch) {
        matchedAnime = yearMatch;
        logger.debug(`${logPrefix} Matched by year: ${matchedAnime.id} (${seasonYear})`);
      } else {
        logger.warn(`${logPrefix} No exact year match found for ${seasonYear}, using first result`);
      }
    }

    const animeId = matchedAnime.id;
    logger.debug(`${logPrefix} Using anime: ${animeId}`);

    // Step 2: Get episodes
    const episodesResp = await axios.get(`${KENJITSU_API}${provider.episodesPath(animeId)}`, {
      timeout: 10000
    });

    const episodes = episodesResp.data.data?.episodes || episodesResp.data.data || [];
    if (episodes.length === 0) {
      throw new Error('No episodes found');
    }

    // Encontrar episodio correcto (anime usa numeración simple, ignorar season)
    const targetEpisode = episodes.find(ep => ep.number === episode || ep.episodeNumber === episode) || episodes[episode - 1];
    
    if (!targetEpisode) {
      throw new Error(`Episode ${episode} not found`);
    }

    const episodeId = targetEpisode.episodeId || targetEpisode.id;
    logger.debug(`${logPrefix} Episode: ${episodeId}`);

    // Step 3: Get sources (con version parameter)
    const sourcesResp = await axios.get(`${KENJITSU_API}${provider.sourcesPath(episodeId)}`, {
      params: { ...provider.sourcesParams, version },
      timeout: 15000
    });

    const sources = sourcesResp.data.data?.sources || [];
    const subtitles = sourcesResp.data.data?.subtitles || [];

    if (sources.length === 0) {
      throw new Error('No sources found');
    }

    const extractionTimeMs = Date.now() - startTime;
    logger.info(`${logPrefix} ✅ SUCCESS: ${sources.length} sources, ${subtitles.length} subs (${extractionTimeMs}ms)`);

    return {
      success: true,
      provider: provider.name,
      version,
      sources,
      subtitles,
      extractionTimeMs
    };

  } catch (error) {
    const extractionTimeMs = Date.now() - startTime;
    logger.debug(`${logPrefix} ❌ Failed: ${error.message} (${extractionTimeMs}ms)`);
    return {
      success: false,
      provider: provider.name,
      version,
      error: error.message,
      extractionTimeMs
    };
  }
}

/**
 * Buscar en Cuevana (latino)
 */
async function fetchFromCuevana(tmdbId, type, season, episode) {
  const logPrefix = `[CUEVANA-ANIME]`;
  const startTime = Date.now();

  try {
    const endpoint = type === 'movie'
      ? `${CUEVANA_API_URL}/fast/movie/${tmdbId}`
      : `${CUEVANA_API_URL}/fast/tv/${tmdbId}/${season}/${episode}`;

    logger.info(`${logPrefix} Requesting: ${endpoint}`);

    const response = await axios.get(endpoint, { timeout: 10000 });

    logger.info(`${logPrefix} Response status: ${response.status}`);
    logger.debug(`${logPrefix} Response data: ${JSON.stringify(response.data).substring(0, 300)}`);

    const videoUrl = response.data?.video?.url;
    const videoStatus = response.data?.video?.status;

    if (!videoUrl || videoStatus !== 'success') {
      throw new Error('No valid video URL found in response');
    }

    const extractionTimeMs = Date.now() - startTime;
    logger.info(`${logPrefix} ✅ SUCCESS: Latino stream found (${extractionTimeMs}ms)`);

    return {
      success: true,
      provider: 'cuevana',
      sources: [{ url: videoUrl, quality: 'auto', type: 'hls' }],
      subtitles: [],
      extractionTimeMs
    };

  } catch (error) {
    const extractionTimeMs = Date.now() - startTime;
    const endpoint = type === 'movie'
      ? `${CUEVANA_API_URL}/fast/movie/${tmdbId}`
      : `${CUEVANA_API_URL}/fast/tv/${tmdbId}/${season}/${episode}`;
    logger.info(`${logPrefix} ❌ Failed: ${error.message} (${extractionTimeMs}ms)`);
    logger.info(`${logPrefix} URL was: ${endpoint}`);
    if (error.response) {
      logger.info(`${logPrefix} Response status: ${error.response.status}`);
      logger.debug(`${logPrefix} Response data: ${JSON.stringify(error.response.data).substring(0, 200)}`);
    }
    return {
      success: false,
      provider: 'cuevana',
      error: error.message,
      extractionTimeMs
    };
  }
}

/**
 * Provider principal de anime
 */
export async function extractAnimeStream(tmdbId, type, season = 1, episode = 1) {
  const startTime = Date.now();
  const logPrefix = `[ANIME] ${type}/${tmdbId}`;

  // Solo soportar series
  if (type !== 'tv') {
    logger.debug(`${logPrefix} Anime provider only supports TV series`);
    return {
      success: false,
      error: 'Anime provider only supports TV series',
      provider: 'anime',
      extractionTimeMs: Date.now() - startTime
    };
  }

  try {
    // Cache key
    const cacheKey = `anime_${tmdbId}_s${season}e${episode}`;
    const cached = await cacheService.get(cacheKey);
    
    if (cached) {
      logger.info(`${logPrefix} ✅ Cache hit`);
      return {
        ...cached,
        cached: true,
        extractionTimeMs: Date.now() - startTime
      };
    }

    // Step 1: Verificar si es anime japonés
    logger.info(`${logPrefix} Step 1: Checking if Japanese anime...`);
    const animeCheck = await isJapaneseAnime(tmdbId, type, season);
    
    if (!animeCheck.isAnime) {
      logger.info(`${logPrefix} Not a Japanese anime, skipping`);
      return {
        success: false,
        error: 'Not a Japanese anime',
        provider: 'anime',
        extractionTimeMs: Date.now() - startTime
      };
    }

    logger.info(`${logPrefix} ✅ Confirmed: "${animeCheck.title}"`);

    // Step 2: Buscar en PARALELO (SUB, DUB, y Cuevana)
    logger.info(`${logPrefix} Step 2: Fetching from all providers in parallel...`);
    
    // Crear promesas para SUB (original japonés con subs) - con seasonYear para filtrar
    const kenjitsuSubPromises = KENJITSU_PROVIDERS.map(provider =>
      fetchFromKenjitsuProvider(provider, animeCheck.searchTitle, season, episode, 'sub', animeCheck.seasonYear)
    );

    // Crear promesas para DUB (doblaje inglés) - con seasonYear para filtrar
    const kenjitsuDubPromises = KENJITSU_PROVIDERS.map(provider =>
      fetchFromKenjitsuProvider(provider, animeCheck.searchTitle, season, episode, 'dub', animeCheck.seasonYear)
    );

    const cuevanaPromise = fetchFromCuevana(tmdbId, type, season, episode);

    // Esperar a que TODOS terminen
    const [kenjitsuSubResults, kenjitsuDubResults, cuevanaResult] = await Promise.all([
      Promise.all(kenjitsuSubPromises),
      Promise.all(kenjitsuDubPromises),
      cuevanaPromise
    ]);

    // Encontrar el primer provider exitoso para cada version
    const successfulSub = kenjitsuSubResults.find(r => r.success);
    const successfulDub = kenjitsuDubResults.find(r => r.success);

    if (!successfulSub && !successfulDub && !cuevanaResult.success) {
      throw new Error('No providers returned streams');
    }

    // Log resultados individuales
    logger.debug(`${logPrefix} SUB results: ${kenjitsuSubResults.map(r => `${r.provider}:${r.success}`).join(', ')}`);
    logger.debug(`${logPrefix} DUB results: ${kenjitsuDubResults.map(r => `${r.provider}:${r.success}`).join(', ')}`);
    logger.debug(`${logPrefix} Cuevana result: success=${cuevanaResult.success}, error=${cuevanaResult.error || 'none'}`);

    // Construir respuesta
    const result = {
      success: true,
      provider: 'anime',
      title: animeCheck.title,
      streams: {
        original: successfulSub || null,
        dub: successfulDub || null,
        latino: cuevanaResult.success ? cuevanaResult : null
      },
      extractionTimeMs: Date.now() - startTime
    };

    // Guardar en cache
    await cacheService.set(cacheKey, result);

    logger.info(`${logPrefix} ✅ SUCCESS: original=${!!successfulSub} (${successfulSub?.provider || 'none'}), dub=${!!successfulDub} (${successfulDub?.provider || 'none'}), latino=${cuevanaResult.success} ${cuevanaResult.error ? `(${cuevanaResult.error})` : ''}`);

    return result;

  } catch (error) {
    logger.error(`${logPrefix} ❌ Error:`, error.message);
    return {
      success: false,
      error: error.message,
      provider: 'anime',
      extractionTimeMs: Date.now() - startTime
    };
  }
}

export default {
  extractAnimeStream
};
