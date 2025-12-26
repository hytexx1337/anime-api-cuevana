/**
 * Test del flujo completo anime-api
 */

import axios from 'axios';

const ANIME_API_URL = 'https://animeapi.ramenflix.com';
const TMDB_BEARER = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiIyMjYwNmNlMmU2MTJkOGQyYzQyNzhmYWNhNDE5Y2VjMSIsIm5iZiI6MTc1ODk0Njk4NC4yOTcsInN1YiI6IjY4ZDc2NmE4NWFmYjU3ZjJjZTUyZmMzZCIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.-KoF5Nloah5nLAlONDasUwMb9OUS_LbawNd8mdRGNBg';
const TMDB_ID = 240411; // Dan Da Dan

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🧪 Test: anime-api integration');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Step 1: Obtener título de TMDB
console.log('📍 Step 1: Get TMDB title');
const tmdbResp = await axios.get(`https://api.themoviedb.org/3/tv/${TMDB_ID}`, {
  headers: {
    'Authorization': `Bearer ${TMDB_BEARER}`
  }
});

const title = tmdbResp.data.name;
const originalTitle = tmdbResp.data.original_name;
console.log(`   Title: "${title}"`);
console.log(`   Original: "${originalTitle}"\n`);

// Step 2: Buscar en anime-api
console.log('📍 Step 2: Search in anime-api');

// Probar con ambos títulos
const searchQueries = [
  { name: 'English', query: title },
  { name: 'Original', query: originalTitle },
  { name: 'Romanized', query: 'dandadan' }
];

let results = [];
let usedQuery = null;

for (const { name, query } of searchQueries) {
  console.log(`\n   Trying ${name}: "${query}"`);
  
  try {
    const searchResp = await axios.get(`${ANIME_API_URL}/api/search`, {
      params: { keyword: query },
      timeout: 10000
    });

    console.log(`   Response status: ${searchResp.status}`);
    console.log(`   Response success: ${searchResp.data.success}`);
    
    // La API devuelve results.data, no results directamente
    const resultData = searchResp.data.results?.data || searchResp.data.results || [];
    console.log(`   Results count: ${resultData.length}`);

    if (searchResp.data.success && resultData.length > 0) {
      results = resultData;
      usedQuery = query;
      console.log(`   ✅ Found ${results.length} results!`);
      break;
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
  }
}

if (results.length === 0) {
  console.error('\n   ❌ No results found with any query');
  console.error('   Try manual search: curl "https://animeapi.ramenflix.com/api/search?keyword=dandadan"');
  process.exit(1);
}

console.log(`\n   Using query: "${usedQuery}"`);
console.log(`   Top ${Math.min(5, results.length)} results:`);

results.slice(0, 5).forEach((r, i) => {
  console.log(`   ${i + 1}. ${r.title} (${r.id})`);
  console.log(`      JP: ${r.japanese_title || 'N/A'}`);
  console.log(`      Type: ${r.tvInfo?.showType || 'N/A'}`);
});

const animeResult = results[0];
const animeId = animeResult.id;
console.log(`\n   ✅ Using: ${animeId}\n`);

// Step 3: Obtener lista de episodios
console.log('📍 Step 3: Get episodes list');
const episodesResp = await axios.get(`${ANIME_API_URL}/api/episodes/${animeId}`, {
  timeout: 10000
});

if (!episodesResp.data.success) {
  console.error('   ❌ Failed to get episodes');
  process.exit(1);
}

const episodesData = episodesResp.data.results;
const episodes = episodesData.episodes || [];
console.log(`   Total episodes: ${episodesData.totalEpisodes || episodes.length}`);

if (episodes.length > 0) {
  console.log(`\n   First 3 episodes:`);
  episodes.slice(0, 3).forEach((ep, i) => {
    console.log(`   ${i + 1}. Episode ${ep.episode_no || i + 1} (id: ${ep.id})`);
  });
}

const firstEpisode = episodes[0];
if (!firstEpisode) {
  console.error('\n   ❌ No episodes found');
  process.exit(1);
}

const episodeId = firstEpisode.id;
console.log(`\n   ✅ Using first episode: ${episodeId}\n`);

// Step 4: Obtener streams
console.log('📍 Step 4: Get streams');
const servers = ['hd-1', 'hd-2', 's-mp4'];
const types = ['dub', 'sub'];

console.log('\n   Testing streams:\n');

for (const type of types) {
  console.log(`   ${type.toUpperCase()}:`);
  
  for (const server of servers) {
    try {
      const streamResp = await axios.get(`${ANIME_API_URL}/api/stream`, {
        params: {
          id: episodeId,  // Debe incluir "dan-da-dan-19319?ep=128368"
          server,
          type
        },
        timeout: 8000
      });

      // Debug: mostrar estructura completa en la primera iteración
      if (server === 'hd-1' && type === 'dub') {
        console.log('\n   DEBUG - Full stream response:');
        console.log(JSON.stringify(streamResp.data, null, 2).substring(0, 800) + '...\n');
      }

      const streamUrl = streamResp.data?.results?.streamingLink?.link?.file;
      const subtitles = streamResp.data?.results?.streamingLink?.tracks || [];
      
      if (streamUrl) {
        const isM3U8 = streamUrl.includes('.m3u8');
        console.log(`   ✅ ${server}: ${isM3U8 ? 'M3U8' : 'Other'}`);
        console.log(`      URL: ${streamUrl.substring(0, 70)}...`);
        console.log(`      Subtitles: ${subtitles.length} tracks`);
      } else {
        console.log(`   ❌ ${server}: No link (success: ${streamResp.data?.success})`);
      }
    } catch (error) {
      console.log(`   ❌ ${server}: ${error.message}`);
    }
  }
  console.log('');
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('✅ Test completado\n');

