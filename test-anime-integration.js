/**
 * Test de integración completa del anime provider en streaming-api
 */

import axios from 'axios';

const API_URL = 'http://localhost:4000';
const TMDB_ID = 240411; // Dan Da Dan (anime japonés)
const TMDB_ID_NOT_ANIME = 603; // The Matrix (no es anime)

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🧪 Test: Anime Provider Integration');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Test 1: Anime japonés (Dan Da Dan)
console.log('📍 Test 1: Japanese Anime (Dan Da Dan)');
console.log(`   TMDB ID: ${TMDB_ID}\n`);

try {
  const startTime = Date.now();
  
  const response = await axios.get(`${API_URL}/api/streams/extract/tv/${TMDB_ID}`, {
    params: {
      season: 1,
      episode: 1
    },
    timeout: 60000
  });

  const totalTime = Date.now() - startTime;

  console.log(`   ✅ Response received in ${totalTime}ms\n`);
  console.log(`   Success: ${response.data.success}`);
  console.log(`   Is Anime: ${response.data.metadata.isAnime}`);
  console.log(`   Title: ${response.data.metadata.animeTitle || 'N/A'}\n`);

  console.log(`   Sources:`);
  if (response.data.sources.original) {
    console.log(`   ✅ Original: ${response.data.sources.original.provider}`);
    console.log(`      URL: ${response.data.sources.original.streamUrl?.substring(0, 60)}...`);
    console.log(`      Subtitles: ${response.data.sources.original.subtitles?.length || 0}`);
  } else {
    console.log(`   ❌ Original: Not found`);
  }

  if (response.data.sources.englishDub) {
    console.log(`   ✅ English Dub: ${response.data.sources.englishDub.provider}`);
    console.log(`      URL: ${response.data.sources.englishDub.streamUrl?.substring(0, 60)}...`);
  } else {
    console.log(`   ❌ English Dub: Not found`);
  }

  if (response.data.sources.latino) {
    console.log(`   ✅ Latino: ${response.data.sources.latino.provider}`);
    console.log(`      URL: ${response.data.sources.latino.streamUrl?.substring(0, 60)}...`);
  } else {
    console.log(`   ❌ Latino: Not found`);
  }

  console.log('');

} catch (error) {
  console.error(`   ❌ Error: ${error.message}`);
  if (error.response) {
    console.error(`   Status: ${error.response.status}`);
    console.error(`   Data:`, JSON.stringify(error.response.data, null, 2));
  }
}

// Test 2: NO es anime (The Matrix)
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📍 Test 2: NOT Anime (The Matrix)');
console.log(`   TMDB ID: ${TMDB_ID_NOT_ANIME}\n`);

try {
  const startTime = Date.now();
  
  const response = await axios.get(`${API_URL}/api/streams/extract/movie/${TMDB_ID_NOT_ANIME}`, {
    timeout: 60000
  });

  const totalTime = Date.now() - startTime;

  console.log(`   ✅ Response received in ${totalTime}ms\n`);
  console.log(`   Success: ${response.data.success}`);
  console.log(`   Is Anime: ${response.data.metadata.isAnime || false}`);
  console.log(`   Total Providers: ${response.data.metadata.totalProviders}\n`);

  console.log(`   Sources:`);
  if (response.data.sources.original) {
    console.log(`   ✅ Original: ${response.data.sources.original.provider}`);
  }
  if (response.data.sources.latino) {
    console.log(`   ✅ Latino: ${response.data.sources.latino.provider}`);
  }
  if (response.data.sources.englishDub) {
    console.log(`   ✅ English Dub: ${response.data.sources.englishDub.provider}`);
  }

  console.log('');

} catch (error) {
  console.error(`   ❌ Error: ${error.message}`);
  if (error.response) {
    console.error(`   Status: ${error.response.status}`);
  }
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('✅ Integration test completed\n');

