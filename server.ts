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
  messages: [] as any[],
  admin: {
    announcement: "Tüm kullanıcılara duyuru\nVIP üyelik şimdilik herkese bedava! 🎉",
    vip_access_mode: 'everyone' as 'members' | 'everyone' | 'off'
  }
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

  // In-memory cache for translations
  const translationCache = new Map<string, { text: string; detectedLanguage?: string }>();

  // Track if engines are hitting quota/rate limits
  let geminiDisabledUntil = 0;
  let googleWebDisabledUntil = 0;

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

    // If source and target language are explicitly identical
    if (source && source.toLowerCase() === target.toLowerCase()) {
      return { text, detectedLanguage: source };
    }

    const cacheKey = `${source || 'auto'}:${target}:${text}`;
    const cached = translationCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    console.log(`[Translate] Starting: "${text}" from ${source || 'auto'} to ${target}`);

    // 1. Try Google Translate Engine (using translate.google.com POST endpoint)
    if (Date.now() > googleWebDisabledUntil) {
      try {
        console.log(`[Translate] Trying Engine 1 (Google Translate)...`);
        const sl = source || 'auto';
        const tl = target;
        const params = new URLSearchParams();
        params.append('sl', sl);
        params.append('tl', tl);
        params.append('q', text);

        const res = await fetch('https://translate.google.com/translate_a/single?client=at&dt=t&dj=1', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          },
          body: params,
          signal: AbortSignal.timeout(5000)
        });

        if (res.ok) {
          const data: any = await res.json();
          const translated = data?.sentences
            ?.filter((s: any) => 'trans' in s)
            ?.map((s: any) => s.trans)
            ?.join('');
          const detected = data?.src;
          if (translated) {
            console.log(`[Translate] Engine 1 success: "${translated}"`);
            const out = { text: translated, detectedLanguage: detected || source };
            translationCache.set(cacheKey, out);
            return out;
          }
        } else {
          if (res.status === 429) {
            googleWebDisabledUntil = Date.now() + 10 * 60 * 1000;
          }
          console.log(`[Translate] Engine 1 returned status ${res.status}`);
        }
      } catch (err: any) {
        console.log('[Translate] Engine 1 request error:', err?.message || err);
      }
    }

    if (ai && Date.now() > geminiDisabledUntil) {
      for (const model of ['gemini-3.8-flash']) {
        try {
          const prompt = `You are a professional translator. 
Translate the following text into ${getLanguageName(target)}.
${source ? `The source language is ${getLanguageName(source)}.` : 'Automatically detect the source language.'}

Respond ONLY with the translated text. Do not include any explanations.

Text to translate:
"${text}"`;

          const response = await ai.models.generateContent({
            model,
            contents: [{ role: 'user', parts: [{ text: prompt }] }]
          });
          const translatedText = response.text.trim().replace(/^["']|["']$/g, '');
          
          if (translatedText && translatedText !== text) {
            console.log(`[Translate] Engine 2 success (${model}): "${translatedText}"`);
            const out = { text: translatedText, detectedLanguage: source || 'detected' };
            translationCache.set(cacheKey, out);
            return out;
          }
        } catch (err: any) {
          const msg = err?.message || '';
          if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota') || msg.includes('404')) {
            // Disable Gemini for 6 hours on quota / not found error so Engine 1 operates seamlessly
            geminiDisabledUntil = Date.now() + 6 * 60 * 60 * 1000;
            break;
          }
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
          const out = { text: decoded, detectedLanguage: data.responseData?.detectedLanguage || source };
          translationCache.set(cacheKey, out);
          return out;
        }
      }
    } catch (err: any) {
      console.log('[Translate] Engine 3 error:', err?.message || err);
    }

    console.log(`[Translate] All engines exhausted. Returning original.`);
    return { text };
  };

  if (ai) {
    console.log('[Server] Gemini AI client initialized.');
  } else {
    console.log('[Server] Gemini AI client not configured. Defaulting to Google Translate web engine.');
  }

  void translateText('Hello', 'en', 'tr').then(res => {
    console.log(`[Server] Startup translation test (Hello -> tr): ${res.text}`);
  }).catch(err => {
    console.error('[Server] Startup translation test failed:', err);
  });

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
      model: 'gemini-2.0-flash-exp', // Live API WebSocket model
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

  let elevenLabsDisabled = false;

  // ElevenLabs & High Quality Neural Voice API
  app.post('/api/tts', async (req, res) => {
    try {
      const { text, lang, voiceGender } = req.body;
      if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'Text is required' });
      }

      const cleanText = text.slice(0, 450).trim();
      const languageCode = lang || 'tr';
      const elevenKey = process.env.ELEVENLABS_API_KEY || 'sk_e5fd5f61fce207d7f558e0f0b8df0631870b13e4901a85bc';

      // 1. Primary: Try ElevenLabs TTS API
      if (elevenKey && !elevenLabsDisabled) {
        try {
          // Rachel (Female) vs Adam (Male)
          const voiceId = voiceGender === 'male' ? 'pNInz6obpgDQGcFmaJgB' : '21m00Tcm4TlvDq8ikWAM'; 
          const elRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
            method: 'POST',
            headers: {
              'xi-api-key': elevenKey,
              'Content-Type': 'application/json',
              'Accept': 'audio/mpeg',
            },
            body: JSON.stringify({
              text: cleanText,
              model_id: 'eleven_multilingual_v2',
              voice_settings: {
                stability: 0.5,
                similarity_boost: 0.75,
              },
            }),
            signal: AbortSignal.timeout(8000),
          });

          if (elRes.ok) {
            const audioBuffer = await elRes.arrayBuffer();
            if (audioBuffer.byteLength > 200) {
              res.setHeader('Content-Type', 'audio/mpeg');
              return res.send(Buffer.from(audioBuffer));
            }
          } else {
            const errText = await elRes.text().catch(() => '');
            if (elRes.status === 401 || elRes.status === 400 || errText.includes('invalid_api_key')) {
              elevenLabsDisabled = true;
            }
          }
        } catch (e) {
          // Fallback
        }
      }

      // 2. High-quality free neural voice fallback
      const googleTtsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(cleanText)}&tl=${encodeURIComponent(languageCode)}&client=tw-ob`;
      const ttsRes = await fetch(googleTtsUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });

      if (ttsRes.ok) {
        const audioBuffer = await ttsRes.arrayBuffer();
        res.setHeader('Content-Type', 'audio/mpeg');
        return res.send(Buffer.from(audioBuffer));
      }

      res.status(500).json({ error: 'TTS generation failed' });
    } catch (err: any) {
      console.error('[TTS Error]:', err?.message || err);
      res.status(500).json({ error: 'Failed to generate speech' });
    }
  });

  app.get('/api/announcement', (req, res) => {
    res.json({ text: db.admin.announcement });
  });

  app.post('/api/admin/announcement', (req, res) => {
    const { text } = req.body;
    db.admin.announcement = text;
    res.json({ success: true });
  });

  app.get('/api/admin/vip-access', (req, res) => {
    res.json({ mode: db.admin.vip_access_mode });
  });

  app.post('/api/admin/vip-access', (req, res) => {
    const { mode } = req.body;
    db.admin.vip_access_mode = mode;
    res.json({ success: true });
  });

  app.get('/api/vip-status/:userId', (req, res) => {
    const { userId } = req.params;
    // In local dev, we check the global mode
    const isEveryoneVip = db.admin.vip_access_mode === 'everyone';
    res.json({
      access: db.admin.vip_access_mode,
      vipUntil: isEveryoneVip ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString() : null,
      canUseVip: isEveryoneVip,
      balanceUsd: 100,
      vipSeconds: 36000,
    });
  });

  app.post('/api/admin/check-pin', (req, res) => {
    // Pin is 4958 for local dev
    const { pin } = req.body;
    res.json({ valid: pin === '4958' });
  });

  app.get('/api/admin/overview', (req, res) => {
    res.json({
      vip_access: db.admin.vip_access_mode,
      vip_members: db.participants.filter(p => p.is_vip).length,
      requests: [],
      users: db.participants.map(p => ({
        user_id: p.user_id,
        name: p.name,
        last_seen: p.last_seen,
        vip_until: p.is_vip ? new Date().toISOString() : null,
        balance_usd: 100,
        vip_seconds: 36000
      }))
    });
  });

  // Serve static files in production, or use Vite middleware in dev
  if (process.env.NODE_ENV === 'production') {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get(/.*/, (req, res) => {
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
