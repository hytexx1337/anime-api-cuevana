/**
 * Test del flujo completo Kenjitsu + HiAnime
 */

import axios from 'axios';

const KENJITSU_API = 'https://fatal-jacklyn-nasheee1337-5d2fbb84.koyeb.app';
const TMDB_ID = 240411; // Dan Da Dan

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🧪 Test: Kenjitsu + HiAnime integration');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Step 1: Buscar directamente en HiAnime
console.log('📍 Step 1: Search anime in HiAnime');
console.log(`   Query: "Dan Da Dan"\n`);

try {
  const searchResp = await axios.get(`${KENJITSU_API}/api/hianime/anime/search`, {
    params: { q: 'Dan Da Dan', page: 1 },
    timeout: 10000
  });

  console.log('   Search response:');
  console.log(JSON.stringify(searchResp.data, null, 2).substring(0, 800) + '...');
  console.log('');

  const results = searchResp.data.data || [];
  if (!Array.isArray(results) || results.length === 0) {
    console.error('   ❌ No results found in HiAnime');
    process.exit(1);
  }

  console.log(`   ✅ Found ${results.length} results:`);
  results.slice(0, 3).forEach((anime, i) => {
    console.log(`   ${i + 1}. ${anime.name} (id: ${anime.id})`);
  });

  const providerId = results[0].id;
  console.log(`\n   ✅ Using: ${providerId}\n`);

  // Step 2: Obtener episodes directamente
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📍 Step 2: Get episodes list\n');

  const episodesResp = await axios.get(`${KENJITSU_API}/api/hianime/anime/${providerId}/episodes`, {
    timeout: 10000
  });

  console.log('   Episodes response:');
  console.log(JSON.stringify(episodesResp.data, null, 2).substring(0, 800) + '...');
  console.log('');

  const episodes = episodesResp.data.data?.episodes || [];
  if (episodes.length === 0) {
    console.error('   ❌ No episodes found');
    process.exit(1);
  }

  console.log(`   ✅ Total episodes: ${episodes.length}`);
  console.log(`\n   First 3 episodes:`);
  episodes.slice(0, 3).forEach((ep, i) => {
    console.log(`   ${i + 1}. Episode ${ep.number} - "${ep.title}" (id: ${ep.episodeId})`);
  });

  const firstEpisode = episodes[0];
  console.log(`\n   ✅ Using first episode: ${firstEpisode.episodeId}\n`);

  // Step 3: Obtener sources (streams)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📍 Step 3: Get episode sources\n');

  const sourcesResp = await axios.get(`${KENJITSU_API}/api/hianime/sources/${firstEpisode.episodeId}`, {
    params: {
      version: 'dub',  // Probar con dub primero
      server: 'hd-2'
    },
    timeout: 15000
  });

  console.log('   Sources response:');
  console.log(JSON.stringify(sourcesResp.data, null, 2).substring(0, 1000) + '...');
  console.log('');

  const sources = sourcesResp.data.data?.sources || [];
  const subtitles = sourcesResp.data.data?.subtitles || [];

  console.log(`   ✅ Found ${sources.length} sources:`);
  sources.forEach((source, i) => {
    console.log(`   ${i + 1}. Quality: ${source.quality}, Type: ${source.type || 'N/A'}`);
    console.log(`      URL: ${source.url.substring(0, 70)}...`);
  });

  console.log(`\n   ✅ Found ${subtitles.length} subtitles:`);
  subtitles.slice(0, 5).forEach((sub, i) => {
    console.log(`   ${i + 1}. ${sub.lang || sub.label} - ${sub.url ? sub.url.substring(0, 50) + '...' : 'N/A'}`);
  });

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ Test completado\n');

} catch (error) {
  console.error('\n❌ Error:');
  console.error(`   Message: ${error.message}`);
  if (error.response) {
    console.error(`   Status: ${error.response.status}`);
    console.error(`   Data:`, JSON.stringify(error.response.data, null, 2));
  }
  process.exit(1);
}

