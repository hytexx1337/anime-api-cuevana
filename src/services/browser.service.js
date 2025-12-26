import puppeteer from 'puppeteer';
import logger from '../utils/logger.js';

const MAX_WORKERS = parseInt(process.env.MAX_PUPPETEER_WORKERS) || 10;
const BROWSER_TIMEOUT = parseInt(process.env.PUPPETEER_TIMEOUT_MS) || 60000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';

class BrowserService {
  constructor() {
    this.browser = null;
    this.activePages = 0;
    this.browserStartTime = null;
    this.totalPagesCreated = 0;
    this.activePagesSet = new Set(); // Track actual page objects
    
    // Reiniciar browser cada 1 hora para prevenir memory leaks
    setInterval(() => this.restartBrowser(), 60 * 60 * 1000);
    
    // Limpiar páginas zombie cada 5 minutos
    setInterval(() => this.cleanupZombiePages(), 5 * 60 * 1000);
  }

  /**
   * Obtiene o crea una instancia de browser
   */
  async getBrowser() {
    if (this.browser) {
      try {
        // Verificar que el browser sigue vivo
        await this.browser.version();
        return this.browser;
      } catch (e) {
        logger.warn('⚠️  [BROWSER] Browser corrupted, restarting...', e.message);
        this.browser = null;
      }
    }

    logger.info('🚀 [BROWSER] Launching new browser instance...');
    this.browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding'
      ]
    });

    this.browserStartTime = Date.now();
    logger.info('✅ [BROWSER] Browser launched successfully');
    
    return this.browser;
  }

  /**
   * Reinicia el browser (para prevenir corrupción)
   */
  async restartBrowser() {
    if (!this.browser) return;

    try {
      logger.info('🔄 [BROWSER] Scheduled restart...');
      
      // Limpiar páginas zombie antes de cerrar
      await this.cleanupZombiePages();
      
      await this.browser.close();
      this.browser = null;
      this.activePages = 0;
      this.activePagesSet.clear();
      logger.info('✅ [BROWSER] Browser closed, will restart on next request');
    } catch (error) {
      logger.error('❌ [BROWSER] Error restarting browser:', error);
      this.browser = null;
      this.activePages = 0;
      this.activePagesSet.clear();
    }
  }

  /**
   * Verifica si se puede crear una nueva página
   */
  canCreatePage() {
    return this.activePages < MAX_WORKERS;
  }

  /**
   * Espera hasta que haya un slot disponible
   */
  async waitForAvailableSlot(timeout = 30000) {
    const start = Date.now();
    
    while (!this.canCreatePage()) {
      if (Date.now() - start > timeout) {
        throw new Error(`No available Puppeteer slots after ${timeout}ms (max: ${MAX_WORKERS})`);
      }
      
      // Esperar 500ms antes de reintentar
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  /**
   * Crea una nueva página con configuración estándar
   */
  async createPage() {
    // Esperar por un slot disponible
    await this.waitForAvailableSlot();

    const browser = await this.getBrowser();
    let page = null;
    
    try {
      page = await browser.newPage();
      this.activePages++;
      this.totalPagesCreated++;
      this.activePagesSet.add(page); // Track this page

      logger.info(`📄 [BROWSER] Page created (active: ${this.activePages}/${MAX_WORKERS}, total: ${this.totalPagesCreated})`);

      // Configuración anti-detección con try-catch individual
      try {
        await page.setUserAgent(USER_AGENT);
      } catch (e) {
        logger.warn(`⚠️  [BROWSER] Failed to set user agent:`, e.message);
      }
      
      try {
        await page.evaluateOnNewDocument(() => {
          Object.defineProperty(navigator, 'webdriver', { get: () => false });
          window.chrome = { runtime: {} };
        });
      } catch (e) {
        logger.warn(`⚠️  [BROWSER] Failed to set anti-detection:`, e.message);
        // No es crítico, continuar igual
      }

      // Auto-cerrar popups
      browser.on('targetcreated', async (target) => {
      try {
        if (target.type() === 'page') {
          const targetPage = await target.page();
          if (targetPage && targetPage !== page) {
            const url = target.url();
            // Solo cerrar si no es del dominio objetivo
            if (!/vidlink|videasy|vidking|111movies|megafiles|workers\.dev/i.test(url)) {
              await targetPage.close();
              logger.debug(`🚫 [BROWSER] Closed popup: ${url.substring(0, 50)}`);
            }
          }
        }
      } catch {}
    });

    // Auto-cleanup cuando la página se cierra
    const originalClose = page.close.bind(page);
    let closeCalled = false;
    
    page.close = async (...args) => {
      if (closeCalled) {
        logger.warn(`⚠️  [BROWSER] Page.close() called multiple times, ignoring`);
        return;
      }
      closeCalled = true;
      
      this.activePages--;
      this.activePagesSet.delete(page); // Remove from tracking
      logger.info(`📄 [BROWSER] Page closed (active: ${this.activePages}/${MAX_WORKERS})`);
      return originalClose(...args);
    };

    // Timeout de seguridad: cerrar página después de 2 minutos
    const pageTimeout = setTimeout(() => {
      if (!closeCalled && !page.isClosed()) {
        logger.warn(`⚠️  [BROWSER] Force closing page after 2 minute timeout`);
        page.close().catch(() => {});
      }
    }, 2 * 60 * 1000);

      // Cleanup del timeout cuando se cierra la página
      page.once('close', () => {
        clearTimeout(pageTimeout);
      });

      return page;
      
    } catch (createError) {
      // Si falla la creación, revertir counters
      logger.error(`❌ [BROWSER] Error creating page:`, createError.message);
      
      if (page) {
        this.activePages--;
        this.activePagesSet.delete(page);
        try {
          await page.close();
        } catch {}
      }
      
      throw createError;
    }
  }

  /**
   * Limpia páginas zombie (páginas que no se cerraron correctamente)
   */
  async cleanupZombiePages() {
    if (!this.browser) return 0;

    let cleaned = 0;
    const pages = await this.browser.pages();
    
    // Cerrar páginas que no están en nuestro tracking
    for (const page of pages) {
      if (!this.activePagesSet.has(page) && !page.isClosed()) {
        try {
          await page.close();
          cleaned++;
          logger.warn(`🧹 [BROWSER] Closed zombie page`);
        } catch {}
      }
    }

    // Sincronizar contador con realidad
    const actualActivePagesCount = this.activePagesSet.size;
    if (this.activePages !== actualActivePagesCount) {
      logger.warn(`⚠️  [BROWSER] Active pages mismatch: counted=${this.activePages}, actual=${actualActivePagesCount}. Fixing...`);
      this.activePages = actualActivePagesCount;
    }

    return cleaned;
  }

  /**
   * Obtiene estadísticas del browser
   */
  getStats() {
    const uptime = this.browserStartTime 
      ? Math.floor((Date.now() - this.browserStartTime) / 1000)
      : 0;

    return {
      active: !!this.browser,
      activePages: this.activePages,
      actualActivePages: this.activePagesSet.size,
      maxWorkers: MAX_WORKERS,
      totalPagesCreated: this.totalPagesCreated,
      uptimeSeconds: uptime,
      availableSlots: MAX_WORKERS - this.activePages
    };
  }

  /**
   * Cierra todo
   */
  async close() {
    if (this.browser) {
      try {
        await this.cleanupZombiePages();
        await this.browser.close();
        logger.info('✅ [BROWSER] Browser closed gracefully');
      } catch (error) {
        logger.error('❌ [BROWSER] Error closing browser:', error);
      }
      this.browser = null;
      this.activePages = 0;
      this.activePagesSet.clear();
    }
  }
}

// Singleton
export default new BrowserService();

