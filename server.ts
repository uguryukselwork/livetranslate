import express from 'express';
import { GoogleGenAI } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { randomUUID } from 'crypto';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- IN-MEMORY DATABASE ---
const db = {
  rooms: [] as any[],
  participants: [] as any[],
  messages: [] as any[]
};

// SSE clients for real-time updates
const clients: Record<string, express.Response[]> = {};

const notifyRoom = (roomId: string, event: string, data: any) => {
  if (clients[roomId]) {
    clients[roomId].forEach(res => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    });
  }
};

async function startServer() {
  const app = express();
  app.use(express.json());

  // Initialize Gemini Client
  const ai = process.env.GEMINI_API_KEY ? new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  }) : null;

  const getLanguageName = (code: string) => {
    const map: Record<string, string> = {
      'tr': 'Turkish',
      'en': 'English',
      'de': 'German',
      'fr': 'French',
      'es': 'Spanish',
      'it': 'Italian',
      'ru': 'Russian',
      'ar': 'Arabic',
      'ja': 'Japanese',
      'ko': 'Korean',
      'th': 'Thai',
      'tk': 'Turkmen'
    };
    return map[code] || code;
  };

  // Track if Gemini is hitting quota/spending limits
  let geminiDisabledUntil = 0;

  const translateText = async (
    originalText: string,
    originalLanguage?: string,
    targetLanguage?: string
  ): Promise<{ text: string; detectedLanguage?: string }> => {
    const text = (originalText || '').trim();
    if (!text) {
      return { text: '' };
    }

    const target = targetLanguage || 'tr';
    const source = originalLanguage && originalLanguage !== 'auto' ? originalLanguage : undefined;

    console.log(`[Translate] Starting: "${text}" from ${source || 'auto'} to ${target}`);

    // If source and target language are explicitly identical
    if (source && source.toLowerCase() === target.toLowerCase()) {
      console.log(`[Translate] Source and target are same (${source}). Skipping.`);
      return { text, detectedLanguage: source };
    }

    // 1. Try Google Translate Web engine (Reliable & fast for testing)
    try {
      console.log(`[Translate] Trying Engine 1 (Google Web)...`);
      const sl = source || 'auto';
      const tl = target;
      const url = `https://translate.googleapis.com/translate_a/single?client=tw-ob&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: AbortSignal.timeout(5000)
      });
      if (res.ok) {
        const data: any = await res.json();
        if (Array.isArray(data?.[0])) {
          const translated = data[0].map((item: any) => item[0]).join('');
          const detected = data[2];
          if (translated && translated !== text) {
            console.log(`[Translate] Engine 1 success: "${translated}"`);
            return { text: translated, detectedLanguage: detected || source };
          }
        }
      } else {
        console.warn(`[Translate] Engine 1 failed with status: ${res.status}`);
      }
    } catch (err: any) {
      console.warn('[Translate] Engine 1 error:', err?.message || err);
    }

    // 2. Try Gemini API
    for (const model of ['gemini-flash-latest', 'gemini-3.8-flash', 'gemini-3.1-pro-preview']) {
      if (!ai) break;
      if (Date.now() <= geminiDisabledUntil) break;

      try {
        console.log(`[Translate] Trying Engine 2 (Gemini ${model})...`);
        const prompt = `You are a professional translator. 
Translate the following text into ${getLanguageName(target)}.
${source ? `The source language is ${getLanguageName(source)}.` : 'Automatically detect the source language.'}

Respond ONLY with the translated text. Do not include any explanations.

Text to translate:
"${text}"`;

        // AbortSignal is not supported by generateContent directly in some versions,
        // so we wrap it in a timeout promise if needed, but let's try standard first.
        const response = await ai.models.generateContent({
          model,
          contents: prompt,
        });
        
        const translatedText = (response.text || '').trim().replace(/^["']|["']$/g, '');
        
        if (translatedText && translatedText !== text) {
          console.log(`[Translate] Engine 2 success (${model}): "${translatedText}"`);
          return { text: translatedText, detectedLanguage: source || 'detected' };
        }
      } catch (err: any) {
        const msg = err?.message || '';
        console.warn(`[Translate] Engine 2 failure (${model}):`, msg);
        if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('spending cap')) {
          geminiDisabledUntil = Date.now() + 10 * 60 * 1000;
        }
      }
    }

    // 3. Fallback to MyMemory
    try {
      console.log(`[Translate] Trying Engine 3 (MyMemory)...`);
      const sl = source || 'autodetect';
      const tl = target;
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${sl}|${tl}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const data: any = await res.json();
        const translated = data.responseData?.translatedText;
        if (translated && !translated.startsWith('MYMEMORY WARNING') && translated !== text) {
          const decoded = translated
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');
          console.log(`[Translate] Engine 3 success: "${decoded}"`);
          return { text: decoded, detectedLanguage: data.responseData?.detectedLanguage || source };
        }
      }
    } catch (err: any) {
      console.warn('[Translate] Engine 3 error:', err?.message || err);
    }

    console.warn(`[Translate] All engines failed. Returning original.`);
    return { text };
  };

  if (ai) {
    console.log('[Server] Gemini AI client initialized.');
    // Test translation on startup
    void translateText('Hello', 'en', 'tr').then(res => {
      console.log(`[Server] Startup translation test (Hello -> tr): ${res.text}`);
    }).catch(err => {
      console.error('[Server] Startup translation test failed:', err);
    });
  } else {
    console.warn('[Server] Gemini AI client NOT initialized. GEMINI_API_KEY is missing.');
  }

  // --- API ENDPOINTS ---

  app.post('/api/rooms', (req, res) => {
    const { code, created_by } = req.body;
    const room = { id: randomUUID(), code, created_at: new Date().toISOString(), created_by };
    db.rooms.push(room);
    res.json(room);
  });

  app.get('/api/rooms/by-code/:code', (req, res) => {
    let room = db.rooms.find(r => r.code === req.params.code);
    if (!room) {
      // Auto-create room to prevent errors during server restart
      room = { id: randomUUID(), code: req.params.code, created_at: new Date().toISOString(), created_by: 'system' };
      db.rooms.push(room);
    }
    res.json(room);
  });

  app.post('/api/rooms/:id/participants', (req, res) => {
    const { id } = req.params;
    const { user_id, name, gender, language, avatarUrl, status } = req.body;
    
    let p = db.participants.find(p => p.room_id === id && p.user_id === user_id);
    if (p) {
      p.name = name;
      p.gender = gender;
      p.language = language;
      if (avatarUrl !== undefined) p.avatarUrl = avatarUrl;
      if (status !== undefined) p.status = status;
      p.last_seen = new Date().toISOString();
    } else {
      p = { room_id: id, user_id, name, gender, language, avatarUrl, status: status || 'online', last_seen: new Date().toISOString() };
      db.participants.push(p);
    }
    
    notifyRoom(id, 'participant_update', p);
    res.json(p);
  });

  app.get('/api/rooms/:id/participants', (req, res) => {
    res.json(db.participants.filter(p => p.room_id === req.params.id));
  });

  app.get('/api/rooms/:id/messages', (req, res) => {
    res.json(db.messages.filter(m => m.room_id === req.params.id));
  });

  app.post('/api/rooms/:id/messages', async (req, res) => {
    const { id } = req.params;
    const { sender_id, sender_name, sender_gender, original_text, original_language, target_language } = req.body;
    
    console.log(`[Msg] New message in ${id} from ${sender_name}: "${original_text}" (${original_language} -> ${target_language})`);

    const msg = {
      id: randomUUID(),
      room_id: id,
      sender_id,
      sender_name,
      sender_gender,
      original_text,
      translated_text: null,
      original_language,
      target_language,
      created_at: new Date().toISOString(),
      translation_status: 'pending',
      is_read: false
    };
    
    db.messages.push(msg);
    notifyRoom(id, 'message_new', msg);
    res.json(msg);

    // Trigger translation async
    (async () => {
      try {
        const result = await translateText(original_text, original_language, target_language);
        msg.translated_text = result.text;
        msg.original_language = result.detectedLanguage || (original_language === 'auto' ? 'detected' : original_language);
        msg.translation_status = 'completed';
        console.log(`[Msg] Translation complete for ${msg.id}: "${msg.translated_text}"`);
      } catch (error) {
        console.error(`[Msg] Translation error for ${msg.id}:`, error);
        msg.translation_status = 'error';
      }
      notifyRoom(id, 'message_update', msg);
    })();
  });

  app.post('/api/rooms/:id/messages/read', (req, res) => {
    const { id } = req.params;
    const { user_id } = req.body;
    let updated = false;

    db.messages.forEach(m => {
      if (m.room_id === id && m.sender_id !== user_id && !m.is_read) {
        m.is_read = true;
        updated = true;
        notifyRoom(id, 'message_update', m);
      }
    });

    res.json({ success: updated });
  });

  app.post('/api/rooms/:id/messages/:msg_id/retry', async (req, res) => {
    const { id, msg_id } = req.params;
    
    const msg = db.messages.find(m => m.id === msg_id && m.room_id === id);
    if (!msg) {
      return res.status(404).json({ error: 'Message not found' });
    }
    
    msg.translation_status = 'pending';
    notifyRoom(id, 'message_update', msg);
    res.json(msg);

    // Trigger translation async
    (async () => {
      try {
        const result = await translateText(msg.original_text, msg.original_language, msg.target_language);
        msg.translated_text = result.text;
        msg.original_language = result.detectedLanguage || (msg.original_language === 'auto' ? 'detected' : msg.original_language);
        msg.translation_status = 'completed';
      } catch (error) {
        console.error('Retry translation error:', error);
        msg.translation_status = 'error';
      }
      notifyRoom(id, 'message_update', msg);
    })();
  });

  // SSE endpoint
  app.get('/api/rooms/:id/events', (req, res) => {
    const { id } = req.params;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    if (!clients[id]) clients[id] = [];
    clients[id].push(res);
    
    req.on('close', () => {
      clients[id] = clients[id].filter(client => client !== res);
    });
  });

  // Broadcast endpoint for ephemeral events
  app.post('/api/rooms/:id/broadcast', (req, res) => {
    const { id } = req.params;
    const { event, payload } = req.body;
    notifyRoom(id, event, payload);
    res.json({ success: true });
  });

  app.post('/api/live-token', (req, res) => {
    const { target_language } = req.body;
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
    }
    
    // For local development, we return the key and standard config
    res.json({
      token: process.env.GEMINI_API_KEY,
      model: 'gemini-3.8-live', // Use a real model that supports Live API
      config: {
        generationConfig: {
          responseModalities: ['audio'],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } },
          },
        },
        systemInstruction: {
          parts: [{ text: `You are a live voice translator. Translate speech into ${getLanguageName(target_language)}. Output ONLY the translated audio.` }]
        }
      }
    });
  });

  // Serve static files in production, or use Vite middleware in dev
  if (process.env.NODE_ENV === 'production') {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
