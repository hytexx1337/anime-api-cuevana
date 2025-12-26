/**
 * Test de TODOS los providers de anime en Kenjitsu
 */

import axios from 'axios';

const KENJITSU_API = 'https://fatal-jacklyn-nasheee1337-5d2fbb84.koyeb.app';
const QUERY = 'Dan Da Dan';

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🧪 Test: ALL Anime Providers');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
console.log(`   Query: "${QUERY}"\n`);

// Providers disponibles en Kenjitsu
const providers = [
  { name: 'HiAnime', searchPath: '/api/hianime/anime/search', episodesPath: (id) => `/api/hianime/anime/${id}/episodes`, sourcesPath: (epId) => `/api/hianime/sources/${epId}` },
  { name: 'AllAnime', searchPath: '/api/allanime/anime/search', episodesPath: (id) => `/api/allanime/anime/${id}/episodes`, sourcesPath: (epId) => `/api/allanime/sources/${epId}` },
  { name: 'Animekai', searchPath: '/api/animekai/anime/search', episodesPath: (id) => `/api/animekai/anime/${id}/episodes`, sourcesPath: (epId) => `/api/animekai/sources/${epId}` },
  { name: 'Animepahe', searchPath: '/api/animepahe/anime/search', episodesPath: (id) => `/api/animepahe/anime/${id}/episodes`, sourcesPath: (epId) => `/api/animepahe/sources/${epId}` },
  { name: 'Kaido', searchPath: '/api/kaido/anime/search', episodesPath: (id) => `/api/kaido/anime/${id}/episodes`, sourcesPath: (epId) => `/api/kaido/sources/${epId}` }
];

// Test cada provider
for (const provider of providers) {
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📍 Testing: ${provider.name}\n`);

  try {
    // Step 1: Search
    const searchResp = await axios.get(`${KENJITSU_API}${provider.searchPath}`, {
      params: { q: QUERY, page: 1 },
      timeout: 10000
    });

    const results = searchResp.data.data || [];
    if (!Array.isArray(results) || results.length === 0) {
      console.log(`   ❌ No results found\n`);
      continue;
    }

    console.log(`   ✅ Found ${results.length} results`);
    const firstResult = results[0];
    console.log(`   Using: ${firstResult.name || firstResult.title} (${firstResult.id})\n`);

    // Step 2: Episodes
    const episodesResp = await axios.get(`${KENJITSU_API}${provider.episodesPath(firstResult.id)}`, {
      timeout: 10000
    });

    const episodes = episodesResp.data.data?.episodes || episodesResp.data.data || [];
    if (episodes.length === 0) {
      console.log(`   ❌ No episodes found\n`);
      continue;
    }

    console.log(`   ✅ Found ${episodes.length} episodes`);
    const firstEp = episodes[0];
    const epId = firstEp.episodeId || firstEp.id;
    console.log(`   Using episode: ${epId}\n`);

    // Step 3: Sources
    const sourcesResp = await axios.get(`${KENJITSU_API}${provider.sourcesPath(epId)}`, {
      params: provider.name === 'HiAnime' ? { version: 'dub', server: 'hd-2' } : {},
      timeout: 15000
    });

    const sources = sourcesResp.data.data?.sources || [];
    const subtitles = sourcesResp.data.data?.subtitles || [];

    if (sources.length === 0) {
      console.log(`   ❌ No sources found\n`);
      continue;
    }

    console.log(`   ✅ SUCCESS! Found ${sources.length} sources:`);
    sources.slice(0, 2).forEach((source, i) => {
      console.log(`   ${i + 1}. Quality: ${source.quality}, URL: ${source.url.substring(0, 60)}...`);
    });
    console.log(`   ✅ Subtitles: ${subtitles.length}\n`);

  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    if (error.response) {
      console.log(`   Status: ${error.response.status}`);
    }
    console.log('');
  }
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('✅ Test completado\n');

