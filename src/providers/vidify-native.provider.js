import cacheService from '../services/cache.service.js';
import logger from '../utils/logger.js';
import crypto from 'crypto';

// Constantes de Vidify
const VIDIFY_API = 'https://apiv2.vidify.top/api';
const VIDIFY_KEY = 'HpobLp2wBesBkA8rU9HJQcYTBxdrs8X1';
const VIDIFY_TOKEN = '1212';

// Servidores disponibles - Original Lang y English Dub solamente (igual que API original)
const VIDIFY_SERVERS = [
  // Original Lang (sr: 44) - Prioridad alta
  { name: 'Adam', sr: 44, language: 'Original Lang', quality: 'Fast' },
  { name: 'Vplus', sr: 18, language: 'Original Lang', quality: 'Fast' },
  // English Dub
  { name: 'Test', sr: 28, language: 'English Dub', quality: 'Fast' },
  { name: 'Vfast', sr: 11, language: 'English Dub', quality: '' },
];

/**
 * Convierte string a Uint8Array
 */
function stringToUint8Array(str) {
  return new Uint8Array([...str].map(char => char.charCodeAt(0)));
}

/**
 * Desencripta binario con XOR
 */
function decryptBinary(encryptedBinary) {
  const keyBytes = stringToUint8Array(VIDIFY_KEY);
  
  const bytes = encryptedBinary
    .split(' ')
    .map(bin => parseInt(bin, 2))
    .map((byte, idx) => byte ^ keyBytes[idx % keyBytes.length]);
  
  return new Uint8Array(bytes);
}

/**
 * Desencripta Snoopdog (AES-CBC con PBKDF2)
 */
async function decryptSnoopdog(snoopdog) {
  try {
    // 1. Desencriptar binario XOR
    const decryptedBytes = decryptBinary(snoopdog);
    
    // 2. Extraer componentes (igual que el código original)
    const password = decryptedBytes.slice(0, 32);   // 32 bytes
    const salt = decryptedBytes.slice(32, 48);       // 16 bytes
    const iv = decryptedBytes.slice(48, 64);         // 16 bytes
    const encryptedPayload = decryptedBytes.slice(64);
    
    // 3. Derivar key AES con PBKDF2 + SHA-512 (igual que original)
    const aesKey = crypto.pbkdf2Sync(
      password,
      salt,
      100000,
      32,
      'sha512' // SHA-512, no SHA-256!
    );
    
    // 4. Desencriptar con AES-256-CBC (no GCM!)
    const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, iv);
    
    let decrypted = decipher.update(encryptedPayload);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    // 5. Parsear JSON (el padding PKCS7 se maneja automático)
    const jsonString = decrypted.toString('utf-8');
    return JSON.parse(jsonString);
    
  } catch (error) {
    return null;
  }
}

/**
 * Extrae URL del objeto desencriptado
 */
function extractUrl(data) {
  if (!data || typeof data !== 'object') return null;
  
  // Prioridad de búsqueda
  let url = data.url || data.streaming_url || data.stream_url || data.video_url || data.m3u8;
  
  // Buscar en arrays
  if (!url && data.sources && Array.isArray(data.sources) && data.sources.length > 0) {
    const source = data.sources[0];
    url = source.url || source.originalUrl;
  }
  
  if (!url && data.streams && Array.isArray(data.streams) && data.streams.length > 0) {
    url = data.streams[0].url;
  }
  
  // Extraer URL original si es proxy
  if (url && (url.includes('proxify.vidify.top/proxy') || url.includes('workers.dev/proxy'))) {
    try {
      const urlObj = new URL(url);
      const originalUrl = urlObj.searchParams.get('url');
      if (originalUrl) {
        url = decodeURIComponent(originalUrl);
      }
    } catch {}
  }
  
  // Excluir .mp4 (dan Access Denied)
  if (url && /\.mp4(\?|$)/i.test(url)) {
    return null;
  }
  
  return url;
}

/**
 * Obtiene stream de un servidor específico
 */
async function fetchVidifyStream(tmdbId, serverConfig, type, season, episode) {
  try {
    const body = {
      tmdb_id: tmdbId,
      sr: serverConfig.sr,
      type: type
    };
    
    if (type === 'tv' && season !== undefined && episode !== undefined) {
      body.season = season;
      body.episode = episode;
    }
    
    const apiUrl = `${VIDIFY_API}?token=${VIDIFY_TOKEN}`;
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Origin': 'https://player.vidify.top',
        'Referer': 'https://player.vidify.top/'
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000) // 5s timeout
    });
    
    if (!response.ok) {
      return null;
    }
    
    const data = await response.json();
    
    if (!data.snoopdog) {
      return null;
    }
    
    // Desencriptar
    const decrypted = await decryptSnoopdog(data.snoopdog);
    
    if (!decrypted) {
      return null;
    }
    
    // Extraer URL
    const url = extractUrl(decrypted);
    
    // Filtrar URLs con IP directa (certificados SSL rotos)
    if (url) {
      const ipRegex = /^https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/;
      if (ipRegex.test(url)) {
        logger.debug(`[VIDIFY] Skipping ${serverConfig.name} (IP URL, broken SSL): ${url.substring(0, 50)}...`);
        return null;
      }
      
      return {
        server: serverConfig.name,
        sr: serverConfig.sr,
        url,
        language: serverConfig.language
      };
    }
    
    return null;
    
  } catch (error) {
    return null;
  }
}

/**
 * Obtiene todos los streams disponibles (English Dub)
 */
export async function extractVidify(type, tmdbId, season, episode) {
  const startTime = Date.now();
  const logPrefix = type === 'tv'
    ? `[VIDIFY] TV ${tmdbId} S${season}E${episode}`
    : `[VIDIFY] Movie ${tmdbId}`;

  // 1. Verificar cache
  const cached = await cacheService.get('vidify', type, tmdbId, season, episode);
  if (cached) {
    if (cached.streamUrl && cached.streamUrl !== 'NOT_AVAILABLE') {
      logger.info(`${logPrefix} ✅ Cache hit (${Date.now() - startTime}ms)`);
      return {
        success: true,
        streamUrl: cached.streamUrl,
        server: cached.server || 'unknown',
        cached: true,
        provider: 'vidify',
        extractionTimeMs: Date.now() - startTime
      };
    } else if (cached.streamUrl === 'NOT_AVAILABLE') {
      logger.info(`${logPrefix} ⚠️  Content not available (cached negative)`);
      return {
        success: false,
        error: 'Content not available on Vidify (cached)',
        provider: 'vidify',
        cached: true,
        extractionTimeMs: Date.now() - startTime
      };
    }
  }

  try {
    logger.info(`${logPrefix} 🚀 Fetching from Vidify API...`);
    
    // 2. RACE - El primer servidor que responda gana (igual que original)
    let bestResult = null;
    try {
      bestResult = await Promise.any(
        VIDIFY_SERVERS.map(async (server) => {
          const res = await fetchVidifyStream(tmdbId, server, type, season, episode);
          if (res === null) {
            throw new Error(`${server.name} failed`);
          }
          return res;
        })
      );
      logger.debug(`${logPrefix} ⚡ Winner: ${bestResult.server}`);
    } catch (err) {
      // Todos fallaron
      logger.debug(`${logPrefix} ⚠️  All servers failed`);
    }
    
    const extractionTime = Date.now() - startTime;
    
    if (!bestResult) {
      logger.warn(`${logPrefix} ❌ No streams found (${extractionTime}ms)`);
      
      // Cache negativo (7 días)
      await cacheService.set('vidify', type, tmdbId, {
        streamUrl: 'NOT_AVAILABLE'
      }, season, episode);
      
      return {
        success: false,
        error: 'No English Dub streams found',
        provider: 'vidify',
        extractionTimeMs: extractionTime
      };
    }
    
    // 4. Guardar en cache (7 días)
    await cacheService.set('vidify', type, tmdbId, {
      streamUrl: bestResult.url,
      server: bestResult.server
    }, season, episode);
    
    logger.info(`${logPrefix} ✅ Success! (${extractionTime}ms, server: ${bestResult.server})`);
    
    return {
      success: true,
      streamUrl: bestResult.url,
      server: bestResult.server,
      cached: false,
      provider: 'vidify',
      extractionTimeMs: extractionTime
    };
    
  } catch (error) {
    logger.error(`${logPrefix} ❌ Error:`, error.message);
    return {
      success: false,
      error: error.message,
      provider: 'vidify',
      extractionTimeMs: Date.now() - startTime
    };
  }
}

