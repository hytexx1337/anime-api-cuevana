import { promises as fs } from 'fs';
import path from 'path';
import logger from '../utils/logger.js';

const CACHE_DIR = process.env.CACHE_DIR || '.cache';
const CACHE_TTL_MS = (parseInt(process.env.CACHE_TTL_DAYS) || 7) * 24 * 60 * 60 * 1000; // 7 días por defecto

class CacheService {
  constructor() {
    this.cacheDir = path.join(process.cwd(), CACHE_DIR, 'm3u8');
    this.ensureCacheDir();
    
    // Limpieza automática cada 6 horas
    setInterval(() => this.cleanExpired(), 6 * 60 * 60 * 1000);
  }

  async ensureCacheDir() {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
    } catch (error) {
      logger.error('Error creating cache directory:', error);
    }
  }

  /**
   * Genera clave de cache
   * @param {string} provider - vidlink, cuevana, vidify, etc.
   * @param {string} type - movie o tv
   * @param {string} id - TMDB o IMDB ID
   * @param {number} [season]
   * @param {number} [episode]
   * @returns {string}
   */
  getCacheKey(provider, type, id, season, episode) {
    if (type === 'tv' && season && episode) {
      return `${provider}_${type}_${id}_s${season}e${episode}`;
    }
    return `${provider}_${type}_${id}`;
  }

  /**
   * Guarda en cache
   */
  async set(provider, type, id, data, season, episode, customTTL) {
    try {
      await this.ensureCacheDir();

      const cacheKey = this.getCacheKey(provider, type, id, season, episode);
      const cachePath = path.join(this.cacheDir, `${cacheKey}.json`);
      const now = Date.now();
      const ttl = customTTL || CACHE_TTL_MS;

      const entry = {
        ...data,
        cachedAt: now,
        expiresAt: now + ttl,
        provider,
        type,
        id,
        season,
        episode
      };

      await fs.writeFile(cachePath, JSON.stringify(entry, null, 2), 'utf-8');
      
      const ttlDays = (ttl / 1000 / 60 / 60 / 24).toFixed(0);
      logger.info(`💾 [CACHE] Saved: ${cacheKey} (expires in ${ttlDays} days)`);
      
      return true;
    } catch (error) {
      logger.error(`Error saving cache for ${provider}:`, error);
      return false;
    }
  }

  /**
   * Obtiene del cache
   */
  async get(provider, type, id, season, episode) {
    try {
      const cacheKey = this.getCacheKey(provider, type, id, season, episode);
      const cachePath = path.join(this.cacheDir, `${cacheKey}.json`);

      // Verificar si existe
      try {
        await fs.access(cachePath);
      } catch {
        return null;
      }

      // Leer archivo
      const content = await fs.readFile(cachePath, 'utf-8');
      const entry = JSON.parse(content);

      // Verificar si expiró
      const now = Date.now();
      if (now > entry.expiresAt) {
        const ageDays = ((now - entry.cachedAt) / 1000 / 60 / 60 / 24).toFixed(1);
        logger.info(`⏰ [CACHE] Expired: ${cacheKey} (age: ${ageDays} days)`);
        await fs.unlink(cachePath).catch(() => {});
        return null;
      }

      const ageDays = ((now - entry.cachedAt) / 1000 / 60 / 60 / 24).toFixed(1);
      const remainingDays = ((entry.expiresAt - now) / 1000 / 60 / 60 / 24).toFixed(1);
      logger.info(`✅ [CACHE-HIT] ${cacheKey} (age: ${ageDays}d, expires in: ${remainingDays}d)`);
      
      return entry;
    } catch (error) {
      logger.error(`Error reading cache for ${provider}:`, error);
      return null;
    }
  }

  /**
   * Limpia cache expirado
   */
  async cleanExpired() {
    try {
      await this.ensureCacheDir();
      const files = await fs.readdir(this.cacheDir);
      const now = Date.now();
      let cleaned = 0;

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const filePath = path.join(this.cacheDir, file);
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const entry = JSON.parse(content);

          if (now > entry.expiresAt) {
            await fs.unlink(filePath);
            cleaned++;
          }
        } catch (error) {
          // Si hay error leyendo, eliminar el archivo corrupto
          await fs.unlink(filePath).catch(() => {});
          cleaned++;
        }
      }

      if (cleaned > 0) {
        logger.info(`🧹 [CACHE] Cleaned ${cleaned} expired entries`);
      }
    } catch (error) {
      logger.error('Error cleaning cache:', error);
    }
  }

  /**
   * Obtiene estadísticas del cache
   */
  async getStats() {
    try {
      await this.ensureCacheDir();
      const files = await fs.readdir(this.cacheDir);
      const now = Date.now();
      let total = 0;
      let valid = 0;
      let expired = 0;
      let totalSize = 0;
      const byProvider = {};

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const filePath = path.join(this.cacheDir, file);
        try {
          const stats = await fs.stat(filePath);
          totalSize += stats.size;
          total++;

          const content = await fs.readFile(filePath, 'utf-8');
          const entry = JSON.parse(content);

          if (now > entry.expiresAt) {
            expired++;
          } else {
            valid++;
            byProvider[entry.provider] = (byProvider[entry.provider] || 0) + 1;
          }
        } catch {}
      }

      return {
        total,
        valid,
        expired,
        totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
        byProvider
      };
    } catch (error) {
      return { total: 0, valid: 0, expired: 0, totalSizeMB: 0, byProvider: {} };
    }
  }

  /**
   * Invalida cache para un contenido específico
   */
  async invalidate(type, id, season, episode) {
    const providers = ['vidlink', 'cuevana', 'vidify', 'videasy', 'vidking', '111movies'];
    let invalidated = 0;

    for (const provider of providers) {
      const cacheKey = this.getCacheKey(provider, type, id, season, episode);
      const cachePath = path.join(this.cacheDir, `${cacheKey}.json`);
      
      try {
        await fs.unlink(cachePath);
        invalidated++;
        logger.info(`🗑️  [CACHE] Invalidated: ${cacheKey}`);
      } catch {
        // No existe, ignorar
      }
    }

    return invalidated;
  }
}

// Singleton
export default new CacheService();

