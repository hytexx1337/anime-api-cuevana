import browserService from '../services/browser.service.js';
import cacheService from '../services/cache.service.js';
import logger from '../utils/logger.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';

/**
 * Detecta idioma del subtítulo desde URL
 */
function detectLanguage(url) {
  const filename = url.split('/').pop()?.split('?')[0].toLowerCase() || '';
  
  const langMap = {
    'eng': 'English', 'spa': 'Spanish', 'fre': 'French', 'fra': 'French',
    'ger': 'German', 'deu': 'German', 'ita': 'Italian', 'por': 'Portuguese',
    'jpn': 'Japanese', 'kor': 'Korean', 'chi': 'Chinese', 'zho': 'Chinese',
    'ara': 'Arabic', 'rus': 'Russian', 'hin': 'Hindi',
    'dut': 'Dutch', 'nld': 'Dutch', 'pol': 'Polish', 'tur': 'Turkish'
  };
  
  const match = filename.match(/([a-z]{3})-\d+\.vtt$/);
  if (match) {
    const code = match[1];
    const name = langMap[code];
    if (name) return { code, name };
  }
  
  for (const [code, name] of Object.entries(langMap)) {
    const pattern = new RegExp(`[._-]${code}[._-]|^${code}[._-]|[._-]${code}\\.vtt`, 'i');
    if (pattern.test(filename)) {
      return { code, name };
    }
  }
  
  return { code: 'unknown', name: 'Unknown' };
}

/**
 * Puntúa URLs de M3U8 por relevancia
 */
function scoreM3u8Url(url) {
  let score = 0;
  if (/\.m3u8(\?|$)/i.test(url)) score += 100;
  if (/playlist\.m3u8/i.test(url)) score += 50;
  if (/master\.m3u8/i.test(url)) score += 50;
  if (/workers\.dev/i.test(url)) score += 30;
  if (/cloudflare/i.test(url)) score += 20;
  if (/index\.m3u8/i.test(url)) score -= 20;
  return score;
}

/**
 * Extrae stream de Vidlink con Puppeteer
 */
export async function extractVidlink(type, tmdbId, season, episode) {
  const startTime = Date.now();
  const logPrefix = type === 'tv' 
    ? `[VIDLINK] TV ${tmdbId} S${season}E${episode}`
    : `[VIDLINK] Movie ${tmdbId}`;

  // 1. Verificar cache
  const cached = await cacheService.get('vidlink', type, tmdbId, season, episode);
  if (cached) {
    // Verificar que el M3U8 aún funciona (HEAD request)
    if (cached.streamUrl && cached.streamUrl !== 'NOT_AVAILABLE') {
      try {
        const testRes = await fetch(cached.streamUrl, {
          method: 'HEAD',
          headers: { 'User-Agent': USER_AGENT, 'Referer': 'https://vidlink.pro/' },
          signal: AbortSignal.timeout(3000)
        });
        
        if (testRes.ok) {
          logger.info(`${logPrefix} ✅ Cache verified (${Date.now() - startTime}ms)`);
          return {
            success: true,
            streamUrl: cached.streamUrl,
            subtitles: cached.subtitles || [],
            sourceUrl: cached.sourceUrl,
            cached: true,
            provider: 'vidlink',
            extractionTimeMs: Date.now() - startTime
          };
        } else {
          logger.warn(`${logPrefix} ⚠️  Cached M3U8 expired (HTTP ${testRes.status})`);
        }
      } catch {
        logger.warn(`${logPrefix} ⚠️  Cached M3U8 unreachable`);
      }
    } else if (cached.streamUrl === 'NOT_AVAILABLE') {
      logger.info(`${logPrefix} ⚠️  Content not available (cached negative)`);
      return {
        success: false,
        error: 'Content not available on Vidlink (cached)',
        provider: 'vidlink',
        cached: true,
        extractionTimeMs: Date.now() - startTime
      };
    }
  }

  // 2. Construir URL de Vidlink
  const isTv = type === 'tv';
  const baseUrl = isTv
    ? `https://vidlink.pro/tv/${tmdbId}/${season || 1}/${episode || 1}`
    : `https://vidlink.pro/movie/${tmdbId}`;
  
  const optimizedUrl = new URL(baseUrl);
  optimizedUrl.searchParams.set('primaryColor', '63b8bc');
  optimizedUrl.searchParams.set('player', 'jw');
  optimizedUrl.searchParams.set('title', 'false');
  optimizedUrl.searchParams.set('autoplay', 'false');
  const sourceUrl = optimizedUrl.toString();

  let page = null;
  let pageCreationSuccess = false;

  try {
    logger.info(`${logPrefix} 🚀 Extracting with Puppeteer...`);
    
    // 3. Crear página de Puppeteer (sin timeout para evitar race conditions)
    page = await browserService.createPage();
    pageCreationSuccess = true; // Marcar que se creó correctamente

    let foundM3u8 = null;
    const candidates = [];
    const subtitles = [];

    // 4. Request interception (clave de la velocidad)
    await page.setRequestInterception(true);
    
    page.on('request', (req) => {
      const url = req.url();
      
      // Capturar M3U8
      if (/\.m3u8/i.test(url)) {
        const score = scoreM3u8Url(url);
        
        if (!candidates.some(c => c.url === url)) {
          candidates.push({ url, score, timestamp: Date.now() });
          logger.debug(`${logPrefix} [M3U8-REQUEST] Score ${score}: ${url.substring(0, 80)}...`);
          
          // Si encontramos un master/playlist, marcarlo
          if (score >= 150 && !foundM3u8) {
            foundM3u8 = url;
            logger.info(`${logPrefix} ✅ Master M3U8 detected!`);
          }
        }
      }
      
      // Capturar subtítulos .vtt
      if (/\.vtt(\?|$)/i.test(url)) {
        if (!subtitles.some(s => s.url === url)) {
          const lang = detectLanguage(url);
          subtitles.push({ url, lang });
          logger.debug(`${logPrefix} [VTT] ${lang.name}: ${url.substring(0, 60)}...`);
        }
      }

      req.continue().catch(() => {});
    });

    // También escuchar responses
    page.on('response', async (res) => {
      const url = res.url();
      if (/\.m3u8/i.test(url)) {
        const score = scoreM3u8Url(url);
        if (score >= 150 && !foundM3u8) {
          foundM3u8 = url;
          logger.info(`${logPrefix} [M3U8-RESPONSE] Master confirmed`);
        }
      }
    });

    // 5. Navegar
    logger.debug(`${logPrefix} 📍 Navigating...`);
    try {
      await page.goto(sourceUrl, { 
        waitUntil: 'domcontentloaded',
        timeout: 20000  // ⬆️ Aumentado de 10s a 20s para dar más tiempo
      });
    } catch {
      // Timeout OK si ya tenemos M3U8
    }

    // 6. Esperar 3 segundos iniciales para que cargue el player
    await new Promise(r => setTimeout(r, 3000));

    // 7. Evaluar resultado
    if (foundM3u8) {
      logger.info(`${logPrefix} 🎉 M3U8 captured in ${Date.now() - startTime}ms`);
    } else if (candidates.length > 0) {
      candidates.sort((a, b) => b.score - a.score);
      foundM3u8 = candidates[0].url;
      logger.info(`${logPrefix} ✅ Best candidate selected in ${Date.now() - startTime}ms`);
    } else {
      // Último intento: esperar 4s más (total 7s)
      logger.debug(`${logPrefix} 🔍 Searching M3U8...`);
      await new Promise(r => setTimeout(r, 4000));
      
      if (candidates.length > 0) {
        candidates.sort((a, b) => b.score - a.score);
        foundM3u8 = candidates[0].url;
        logger.info(`${logPrefix} ✅ Candidate found after extra wait`);
      }
    }

    const extractionTime = Date.now() - startTime;

    // 8. Guardar resultado en cache
    if (!foundM3u8) {
      logger.warn(`${logPrefix} ❌ No M3U8 found (${extractionTime}ms)`);
      
      // Cache negativo (7 días)
      await cacheService.set('vidlink', type, tmdbId, {
        streamUrl: 'NOT_AVAILABLE',
        sourceUrl,
        subtitles: []
      }, season, episode);
      
      return {
        success: false,
        error: 'No M3U8 found',
        provider: 'vidlink',
        extractionTimeMs: extractionTime
      };
    }

    // Guardar en cache (7 días)
    const subtitlesForCache = subtitles.map(s => ({
      url: s.url,
      language: s.lang.code,
      label: s.lang.name
    }));

    await cacheService.set('vidlink', type, tmdbId, {
      streamUrl: foundM3u8,
      sourceUrl,
      subtitles: subtitlesForCache
    }, season, episode);

    logger.info(`${logPrefix} 🎉 Success! (${extractionTime}ms, ${subtitlesForCache.length} subs)`);

    return {
      success: true,
      streamUrl: foundM3u8,
      subtitles: subtitlesForCache,
      sourceUrl,
      cached: false,
      provider: 'vidlink',
      extractionTimeMs: extractionTime
    };

  } catch (error) {
    logger.error(`${logPrefix} ❌ Error:`, error.message);
    return {
      success: false,
      error: error.message,
      provider: 'vidlink',
      extractionTimeMs: Date.now() - startTime
    };
  } finally {
    // ✅ SIEMPRE cerrar la página, incluso si hay error
    if (page && pageCreationSuccess) {
      try {
        logger.debug(`${logPrefix} 🧹 Closing page...`);
        
        // Timeout de 5s para cerrar la página
        await Promise.race([
          page.close(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Close timeout')), 5000))
        ]);
        
        logger.debug(`${logPrefix} ✅ Page closed successfully`);
      } catch (closeError) {
        logger.warn(`${logPrefix} ⚠️  Error closing page:`, closeError.message);
        
        // Forzar decremento del contador si falla el close
        try {
          if (browserService.activePages > 0) {
            browserService.activePages--;
            logger.info(`${logPrefix} 🔧 Forced activePages decrement (now: ${browserService.activePages})`);
          }
        } catch {}
      }
    }
  }
}

