# 🔌 Integration Example - Next.js App

Ejemplo de cómo integrar la Streaming API en tu aplicación Next.js.

## 📝 Paso 1: Configurar URL de la API

Agrega en `.env.local`:

```env
# URL de la Streaming API (VPS de scraping)
NEXT_PUBLIC_STREAMING_API_URL=http://SERVER_IP:4000
# O si configurás Nginx con SSL:
NEXT_PUBLIC_STREAMING_API_URL=https://streams.tudominio.com
```

## 🎬 Paso 2: Crear cliente de la API

Crea `src/lib/streaming-api-client.ts`:

```typescript
const STREAMING_API_URL = process.env.NEXT_PUBLIC_STREAMING_API_URL || 'http://localhost:4000';

export interface StreamSource {
  streamUrl: string;
  provider: string;
  extractionTimeMs: number;
  subtitles?: Array<{
    url: string;
    language: string;
    label: string;
  }>;
  player?: string;
  server?: string;
}

export interface StreamsResponse {
  success: boolean;
  sources: {
    original: StreamSource | null;
    latino: StreamSource | null;
    englishDub: StreamSource | null;
  };
  metadata: {
    identifier: string;
    extractedAt: string;
    totalTimeMs: number;
    cached: {
      original: boolean;
      latino: boolean;
      englishDub: boolean;
    };
    successCount: number;
    totalProviders: number;
  };
}

export async function fetchStreams(
  type: 'movie' | 'tv',
  tmdbId: string,
  options?: {
    imdbId?: string;
    season?: number;
    episode?: number;
  }
): Promise<StreamsResponse> {
  const response = await fetch(`${STREAMING_API_URL}/api/streams/extract`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type,
      tmdbId,
      imdbId: options?.imdbId,
      season: options?.season,
      episode: options?.episode,
    }),
  });

  if (!response.ok) {
    throw new Error(`Streaming API error: ${response.status}`);
  }

  return response.json();
}
```

## 🎯 Paso 3: Usar en tu componente

Ejemplo en `ClientPlayer.tsx`:

```typescript
import { fetchStreams } from '@/lib/streaming-api-client';

// En tu componente:
const loadStreams = async () => {
  try {
    setLoading(true);
    
    // ✅ UNA SOLA LLAMADA en lugar de 3 llamadas separadas
    const result = await fetchStreams(type, tmdbId, {
      imdbId,
      season: seasonNum,
      episode: episodeNum
    });

    if (!result.success) {
      throw new Error('No streams available');
    }

    // 1. ORIGINAL (Vidlink con subtítulos)
    if (result.sources.original) {
      console.log('✅ Original stream:', result.sources.original.streamUrl);
      console.log('📝 Subtitles:', result.sources.original.subtitles?.length || 0);
      
      // Agregar stream original al botón de audio
      addAudioTrack({
        url: result.sources.original.streamUrl,
        label: 'Original',
        subtitles: result.sources.original.subtitles || []
      });
    }

    // 2. LATINO (Cuevana)
    if (result.sources.latino) {
      console.log('✅ Latino stream:', result.sources.latino.streamUrl);
      
      addAudioTrack({
        url: result.sources.latino.streamUrl,
        label: 'Latino',
        subtitles: []
      });
    }

    // 3. ENGLISH DUB (Vidify)
    if (result.sources.englishDub) {
      console.log('✅ English Dub stream:', result.sources.englishDub.streamUrl);
      
      addAudioTrack({
        url: result.sources.englishDub.streamUrl,
        label: 'English Dub',
        subtitles: []
      });
    }

    // Metadata
    console.log(`⏱️  Total extraction time: ${result.metadata.totalTimeMs}ms`);
    console.log(`💾 Cached: ${JSON.stringify(result.metadata.cached)}`);
    console.log(`✅ Success: ${result.metadata.successCount}/${result.metadata.totalProviders}`);

  } catch (error) {
    console.error('❌ Error loading streams:', error);
    setError(error.message);
  } finally {
    setLoading(false);
  }
};
```

## 🔄 Comparación Antes/Después

### ❌ ANTES (Múltiples endpoints, lento):

```typescript
// 3 llamadas SECUENCIALES (una después de otra)
// Total: 5-10 segundos

// 1. Vidlink (3s)
const vidlink = await fetch('/api/vidlink-puppeteer?...');

// 2. Cuevana (2s)
const cuevana = await fetch('https://api.cineparatodos.lat/fast/...');

// 3. Vidify (3s)
const vidify = await fetch('/api/streams/vidify-unified?...');
```

### ✅ DESPUÉS (Un solo endpoint, paralelo, rápido):

```typescript
// 1 llamada, extracción PARALELA en el backend
// Total: 1.5-3 segundos

const streams = await fetchStreams('movie', '603');
// Ya tiene: original, latino, englishDub
```

## 🚀 Ventajas

1. **Más rápido**: Extracción paralela (3x más rápido)
2. **Más simple**: Una sola llamada HTTP
3. **Más robusto**: Cache unificado, retry logic
4. **Mejor UX**: Loading state único
5. **Escalable**: Backend independiente

## 🔧 Next.js Route Handler (Opcional)

Si querés un proxy en Next.js:

```typescript
// src/app/api/streams/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const body = await req.json();
  
  const response = await fetch('http://STREAMING_API_IP:4000/api/streams/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await response.json();
  return NextResponse.json(data);
}
```

Uso:
```typescript
const streams = await fetch('/api/streams', {
  method: 'POST',
  body: JSON.stringify({ type: 'movie', tmdbId: '603' })
});
```

## 📊 Monitoring desde Next.js

```typescript
// Health check del backend
const checkStreamingAPI = async () => {
  try {
    const res = await fetch(`${STREAMING_API_URL}/health`);
    const data = await res.json();
    
    console.log('🎬 Streaming API:', data.status);
    console.log('🔧 Browser workers:', data.browser.activePages);
    console.log('💾 Cache:', await fetch(`${STREAMING_API_URL}/api/cache/stats`).then(r => r.json()));
  } catch (error) {
    console.error('❌ Streaming API down:', error);
  }
};
```

## 🐛 Error Handling

```typescript
try {
  const streams = await fetchStreams('movie', '603');
  
  if (!streams.success || streams.metadata.successCount === 0) {
    throw new Error('No streams available for this content');
  }
  
  // Usar los streams disponibles
  const available = Object.entries(streams.sources)
    .filter(([_, source]) => source !== null)
    .map(([lang]) => lang);
  
  console.log(`Available languages: ${available.join(', ')}`);
  
} catch (error) {
  if (error.message.includes('404')) {
    console.error('Content not found');
  } else if (error.message.includes('429')) {
    console.error('Rate limit exceeded');
  } else {
    console.error('Unknown error:', error);
  }
}
```

## 🔄 Invalidar Cache

Si un stream no funciona:

```typescript
const invalidateCache = async (type: string, tmdbId: string, season?: number, episode?: number) => {
  const url = new URL(`${STREAMING_API_URL}/api/cache/${type}/${tmdbId}`);
  
  if (season && episode) {
    url.searchParams.set('season', season.toString());
    url.searchParams.set('episode', episode.toString());
  }
  
  const response = await fetch(url.toString(), { method: 'DELETE' });
  const data = await response.json();
  
  console.log(`🗑️  Invalidated ${data.invalidated} cache entries`);
};

// Uso:
await invalidateCache('movie', '603');
// Luego re-intentar fetch
const streams = await fetchStreams('movie', '603');
```

