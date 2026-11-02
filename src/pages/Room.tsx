import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import RoomHeader from '../components/RoomHeader';
import ChatInput, { type ChatInputHandle } from '../components/ChatInput';
import ChatMessage, { MessageType, readableText } from '../components/ChatMessage';
import VoiceCallBar from '../components/VoiceCallBar';
import VoiceModeSheet from '../components/VoiceModeSheet';
import { joinLiveChannel, type LiveChannel, type CallMember } from '../lib/live';
import {
  VoiceTranslator, BrowserVoiceTranslator, PcmPlayer, speak, isSpeaking, isDictationSupported,
  type VoiceState, type VoiceEngine, type VoiceMode
} from '../lib/voice';
import { motion, AnimatePresence } from 'motion/react';
import { X, Pencil, Trash2, Check, Plus, Wand2, Lock, Unlock } from 'lucide-react';
import { LANGUAGES, t, plainLanguageName } from '../lib/i18n';
import { playNotificationSound, generateRoomCode } from '../lib/utils';
import { getChatPatternStyle } from '../lib/themes';
import SettingsSheet from '../components/SettingsSheet';
import { SettingsGroup, SheetHeader, fieldClass } from '../components/ui';
import { cn } from '../lib/utils';
import SecurityLockModal from '../components/SecurityLockModal';
import { primaryButton } from '../components/ui';
import {
  findRoom, upsertParticipant, fetchParticipants, fetchMessages, sendMessage,
  requestTranslation, markMessagesRead, subscribeToRoom, fetchVipStatus, consumeVipSeconds, type Participant, type VipStatus
} from '../lib/api';

export default function Room() {
  const { roomCode } = useParams<{ roomCode: string }>();
  const navigate = useNavigate();
  const {
    profile, theme, soundEnabled, notificationSound, soundVolume, hideProfile, vibrationEnabled,
    savedRooms, addOrUpdateRoom, removeRoom, updateRoomName,
    chatPattern, appPin, isRoomLockEnabled, lockedRooms, unlockedRooms, unlockRoom, toggleRoomLock
  } = useStore();
  
  const [roomId, setRoomId] = useState<string | null>(null);

  const [editingRoomCode, setEditingRoomCode] = useState<string | null>(null);
  const [editRoomName, setEditRoomName] = useState("");
  const [newRoomCode, setNewRoomCode] = useState("");
  const [newRoomName, setNewRoomName] = useState("");

  const [messages, setMessages] = useState<MessageType[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);
  const [showOriginal, setShowOriginal] = useState(true);
  const [codeCopied, setCodeCopied] = useState(false);

  // Replies
  const [replyTo, setReplyTo] = useState<MessageType | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  // Typing indicator and live voice translation (see lib/live.ts, lib/voice.ts)
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [callMembers, setCallMembers] = useState<CallMember[]>([]);
  const [showVoiceModes, setShowVoiceModes] = useState(false);
  const chatInputRef = useRef<ChatInputHandle>(null);
  const [vipStatus, setVipStatus] = useState<VipStatus | null>(null);
  const [inCall, setInCall] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceState>('connecting');
  const [muted, setMuted] = useState(false);
  const [myCaption, setMyCaption] = useState('');
  const [partnerCaption, setPartnerCaption] = useState('');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const liveRef = useRef<LiveChannel | null>(null);
  const translatorRef = useRef<VoiceEngine | null>(null);
  const playerRef = useRef(new PcmPlayer());
  const inCallRef = useRef(false);
  inCallRef.current = inCall;
  const [callMode, setCallMode] = useState<VoiceMode>('free');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, typingUsers.length]);

  // Mark the partner's messages as seen while the room is on screen, and again when the app comes back to the front
  useEffect(() => {
    const markSeen = () => {
      if (roomId && document.visibilityState === 'visible' && messages.some(m => m.sender_id !== profile.id && !m.is_read)) {
        void markMessagesRead(roomId, profile.id);
      }
    };
    markSeen();
    document.addEventListener('visibilitychange', markSeen);
    return () => document.removeEventListener('visibilitychange', markSeen);
  }, [messages, roomId, profile.id]);

  // A translation request lost to a network drop leaves a message "çevriliyor…" forever: ask again once
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const retriedIds = useRef(new Set<string>());
  useEffect(() => {
    if (!roomId) return;
    const STUCK_MS = 20000;
    const timer = setInterval(() => {
      const now = Date.now();
      for (const m of messagesRef.current) {
        if (m.translation_status !== 'pending' || retriedIds.current.has(m.id)) continue;
        if (now - new Date(m.created_at).getTime() < STUCK_MS) continue;
        retriedIds.current.add(m.id);
        void requestTranslation(m.id);
      }
    }, 10000);
    return () => clearInterval(timer);
  }, [roomId]);

  // Latest notification preferences, read inside the realtime callback without resubscribing
  const notifyPrefs = useRef({ soundEnabled, notificationSound, soundVolume, vibrationEnabled });
  notifyPrefs.current = { soundEnabled, notificationSound, soundVolume, vibrationEnabled };
  // Message ids already seen, so each incoming message rings exactly once
  const knownIds = useRef(new Set<string>());

  const notifyIncoming = (msgs: MessageType[]) => {
    const fresh = msgs.filter(m => !knownIds.current.has(m.id));
    fresh.forEach(m => knownIds.current.add(m.id));
    if (!fresh.some(m => m.sender_id !== profile.id)) return;
    const { soundEnabled, notificationSound, soundVolume, vibrationEnabled } = notifyPrefs.current;
    if (soundEnabled) playNotificationSound(notificationSound, soundVolume);
    if (vibrationEnabled && typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(100); } catch { /* not allowed */ }
    }
  };

  const participantInput = () => ({
    name: hideProfile ? 'Gizli Kullanıcı' : (profile.name || 'Misafir'),
    gender: hideProfile ? null : profile.gender,
    language: profile.language,
    avatarUrl: hideProfile ? null : profile.avatarUrl,
    status: hideProfile ? 'Gizli' : profile.status,
  });

  // Initial load & realtime subscription
  useEffect(() => {
    if (!roomCode) return;

    let mounted = true;
    let unsubscribe: (() => void) | null = null;
    let onResync: (() => void) | null = null;

    // Switching rooms from "Odalarım" reuses this page: drop what belonged to the previous room
    setRoomId(null);
    setRoomError(null);
    setParticipants([]);
    setMessages([]);
    setReplyTo(null);

    const loadParticipants = async (rId: string) => {
      const data = await fetchParticipants(rId);
      if (!mounted) return;
      setParticipants(data);

      // Remember the room (and who is in it) for the recent chats list
      const other = data.find(p => p.user_id !== profile.id);
      addOrUpdateRoom({
        code: roomCode,
        lastAccessed: Date.now(),
        partnerName: other?.name,
        partnerAvatar: other?.avatarUrl ?? undefined,
        partnerGender: other?.gender
      });
    };

    const initRoom = async () => {
      try {
        const room = await findRoom(roomCode);
        if (!room) {
          if (mounted) setRoomError(t('room.not_found', profile.language));
          return;
        }
        if (!mounted) return;
        setRoomId(room.id);

        await upsertParticipant(room.id, profile.id, participantInput());
        await loadParticipants(room.id);

        const initialMessages = await fetchMessages(room.id);
        if (!mounted) return;
        knownIds.current = new Set(initialMessages.map(m => m.id));
        setMessages(initialMessages);
        setIsConnected(true);

        // Catch up on anything missed while the socket was down or the phone was asleep
        let subscribedOnce = false;
        const resync = async () => {
          try {
            const latest = await fetchMessages(room.id);
            if (!mounted) return;
            notifyIncoming(latest);
            setMessages(prev => {
              const fetched = new Set(latest.map(m => m.id));
              return [...latest, ...prev.filter(m => !fetched.has(m.id))]
                .sort((a, b) => a.created_at.localeCompare(b.created_at));
            });
          } catch (e) {
            console.error('Resync error:', e);
          }
        };
        onResync = () => { if (document.visibilityState === 'visible') void resync(); };
        document.addEventListener('visibilitychange', onResync);

        unsubscribe = subscribeToRoom(room.id, {
          onMessageInsert: (msg) => {
            if (!mounted) return;
            notifyIncoming([msg]);
            setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
          },
          onSubscribed: () => {
            if (subscribedOnce) void resync();
            subscribedOnce = true;
          },
          onMessageUpdate: (msg) => {
            if (mounted) setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, ...msg } : m));
          },
          onParticipantsChange: () => { void loadParticipants(room.id); },
        });
      } catch (error) {
        console.error('Room init error:', error);
        if (mounted) setRoomError(t('room.load_error', profile.language));
      }
    };

    initRoom();

    return () => {
      mounted = false;
      unsubscribe?.();
      if (onResync) document.removeEventListener('visibilitychange', onResync);
      setIsConnected(false);
    };
  }, [roomCode, profile.id]);

  // Keep my name, language and photo in the room up to date
  useEffect(() => {
    if (roomId) {
      upsertParticipant(roomId, profile.id, participantInput()).catch(console.error);
    }
  }, [profile.language, profile.avatarUrl, profile.status, profile.name, profile.gender, hideProfile, roomId]);

  // Target language: my explicit choice, else the partner's language, else the other of tr/en
  const targetLanguage = () => {
    const otherParticipant = participants.find(p => p.user_id !== profile.id);
    if (profile.partnerLanguage && profile.partnerLanguage !== 'auto') return profile.partnerLanguage;
    if (otherParticipant?.language && otherParticipant.language !== 'auto') return otherParticipant.language;
    return profile.language === 'tr' ? 'en' : 'tr';
  };

  const postMessage = async (text: string, extra: { reply_to_id?: string | null; is_voice?: boolean } = {}, spoken?: string) => {
    if (!roomId) return;
    try {
      const input = participantInput();
      const sent = await sendMessage({
        room_id: roomId,
        sender_id: profile.id,
        sender_name: input.name,
        sender_gender: input.gender,
        sender_avatar: input.avatarUrl,
        original_text: text,
        original_language: profile.language,
        target_language: targetLanguage(),
        ...extra,
      }, spoken);
      // Show it right away; the realtime insert for the same id is ignored
      setMessages(prev => prev.some(m => m.id === sent.id) ? prev : [...prev, sent]);
    } catch (error) {
      console.error('Send message error:', error);
    }
  };

  const handleSendMessage = (text: string) => {
    const replyId = replyTo?.id ?? null;
    setReplyTo(null);
    void postMessage(text, { reply_to_id: replyId });
  };

  // Latest sender for voice sentences, which arrive from the translator long after it started
  const postMessageRef = useRef(postMessage);
  postMessageRef.current = postMessage;

  // Typing, call presence and relayed voice for this room
  useEffect(() => {
    if (!roomId) return;
    const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const live = joinLiveChannel(roomId, profile.id, {
      onTyping: (userId, typing) => {
        clearTimeout(typingTimers.get(userId));
        setTypingUsers(prev => typing ? (prev.includes(userId) ? prev : [...prev, userId]) : prev.filter(id => id !== userId));
        // Missed "stopped typing" events (closed app, lost signal) must not leave it stuck
        if (typing) typingTimers.set(userId, setTimeout(() => setTypingUsers(prev => prev.filter(id => id !== userId)), 6000));
      },
      onCallMembers: setCallMembers,
      onAudio: (_from, data) => {
        if (inCallRef.current) playerRef.current.play(data);
      },
      onCaption: (_from, text) => {
        if (!inCallRef.current) return;
        setPartnerCaption(text);
        rememberHeard(text);
      },
    });
    liveRef.current = live;
    return () => {
      typingTimers.forEach(clearTimeout);
      translatorRef.current?.stop();
      translatorRef.current = null;
      live.leave();
      liveRef.current = null;
      setInCall(false);
      setTypingUsers([]);
      setCallMembers([]);
    };
  }, [roomId, profile.id]);

  // A new message from someone ends their "yazıyor…" (translation updates of older ones do not)
  const lastMessageId = useRef<string | null>(null);
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || last.id === lastMessageId.current) return;
    lastMessageId.current = last.id;
    setTypingUsers(prev => prev.filter(id => id !== last.sender_id));
  }, [messages]);

  // What the partner said lately (in my language). A sentence of mine that repeats it is my speaker's echo,
  // which would otherwise bounce between the two phones forever.
  const heardLog = useRef<{ text: string; at: number }[]>([]);
  const rememberHeard = (text: string) => {
    if (!text.trim()) return;
    const now = Date.now();
    heardLog.current = [...heardLog.current.filter(h => now - h.at < 15000), { text, at: now }];
  };
  // What I said lately (and its translation). When the two phones are in one room, my partner's speaker
  // plays my translation into my own mic; without this it would be translated and sent again and again.
  const saidLog = useRef<{ text: string; at: number }[]>([]);
  const rememberSaid = (...texts: (string | undefined)[]) => {
    const now = Date.now();
    saidLog.current = [
      ...saidLog.current.filter(h => now - h.at < 8000),
      ...texts.filter((t): t is string => !!t?.trim()).map(text => ({ text, at: now })),
    ];
  };
  const recentlyHeard = () => {
    const now = Date.now();
    return [
      ...heardLog.current.filter(h => now - h.at < 15000),
      ...saidLog.current.filter(h => now - h.at < 8000),
    ].map(h => h.text).join(' ');
  };
  // Partner audio from my speaker: VIP audio or a translation read aloud
  const isHearingPartner = () => playerRef.current.isPlaying || isSpeaking();

  // VIP membership decides whether the VIP (Gemini Live) option can be picked
  const refreshVipStatus = () => { fetchVipStatus(profile.id).then(setVipStatus).catch(() => {}); };
  useEffect(refreshVipStatus, [profile.id]);

  const partnerMember = callMembers.find(m => m.userId !== profile.id);
  const partnerEngineRef = useRef<'free' | 'paid'>('free');
  partnerEngineRef.current = partnerMember?.engine ?? 'free';

  // A partner on the free engine sends text only: read their voice sentences aloud here, one after another.
  // (A partner on VIP sends translated audio, which the player handles.)
  const spokenIds = useRef(new Set<string>());
  const lastSpoken = useRef({ text: '', at: 0 });
  const speechQueue = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    if (!inCall || partnerEngineRef.current !== 'free') return;
    for (const m of messages) {
      if (!m.is_voice || m.sender_id === profile.id || m.translation_status !== 'completed' || spokenIds.current.has(m.id)) continue;
      spokenIds.current.add(m.id);
      const text = m.translated_text || m.original_text;
      speechQueue.current = speechQueue.current.then(async () => {
        if (!inCallRef.current) return;
        // The same sentence twice in a few seconds is a repeat, not something new to hear
        const key = text.trim().toLocaleLowerCase();
        if (key === lastSpoken.current.text && Date.now() - lastSpoken.current.at < 8000) return;
        lastSpoken.current = { text: key, at: Date.now() };
        const engine = translatorRef.current;
        if (engine instanceof BrowserVoiceTranslator) engine.setHeld(true);
        rememberHeard(text);
        setPartnerCaption(text);
        await speak(text, profile.language);
        setPartnerCaption('');
        if (engine instanceof BrowserVoiceTranslator) engine.setHeld(false);
      });
    }
  }, [messages, inCall, partnerMember?.engine]);

  const openVoiceModes = () => {
    refreshVipStatus();
    setShowVoiceModes(true);
  };

  const onEngineState = (state: VoiceState, error?: string) => {
    setVoiceState(state);
    if (state === 'error') {
      setVoiceError(error || '');
      endCall();
    }
  };

  // Called straight from a tap: browsers only allow the microphone and sound to start inside one
  const startCall = (mode: VoiceMode) => {
    setShowVoiceModes(false);
    if (!roomId || translatorRef.current) return;
    setVoiceError(null);
    setMuted(false);
    setInCall(true);
    setCallMode(mode);
    liveRef.current?.setInCall(true, mode);
    // Only sentences spoken from now on are read aloud
    spokenIds.current = new Set(messages.map(m => m.id));
    heardLog.current = [];
    saidLog.current = [];
    lastSpoken.current = { text: '', at: 0 };

    const engine: VoiceEngine = mode === 'paid'
      ? new VoiceTranslator({
          roomId,
          targetLanguage: targetLanguage(),
          isHearingPartner,
          recentlyHeard,
          onState: onEngineState,
          onAudio: (data) => liveRef.current?.sendAudio(data),
          onCaption: (translated, original) => {
            setMyCaption(original);
            liveRef.current?.sendCaption(translated);
          },
          onSentence: (original, translated) => {
            rememberSaid(original, translated);
            void postMessageRef.current(original, { is_voice: true }, translated || undefined);
          },
        })
      : new BrowserVoiceTranslator({
          language: profile.language,
          recentlyHeard,
          isHearingPartner: () => playerRef.current.isPlaying,
          onState: onEngineState,
          onCaption: setMyCaption,
          onSentence: (original) => {
            rememberSaid(original);
            void postMessageRef.current(original, { is_voice: true });
          },
        });
    translatorRef.current = engine;
    void engine.start();
  };

  const endCall = () => {
    translatorRef.current?.stop();
    translatorRef.current = null;
    setInCall(false);
    liveRef.current?.setInCall(false);
    playerRef.current.reset();
    setMyCaption('');
    setPartnerCaption('');
  };

  // VIP talk time runs down while a VIP call is connected and the microphone is on
  useEffect(() => {
    if (!inCall || callMode !== 'paid' || voiceState !== 'live' || muted) return;
    const TICK = 10;
    let lastTick = Date.now();
    const consume = (seconds: number) =>
      consumeVipSeconds(seconds).then(left => {
        if (left < 0) return; // package or free-for-all: not metered
        setVipStatus(s => s && { ...s, vipSeconds: left });
        if (left === 0) {
          endCall();
          setVoiceError('VIP konuşma hakkın bitti');
          refreshVipStatus();
        }
      }).catch(() => {});
    const timer = setInterval(() => {
      lastTick = Date.now();
      void consume(TICK);
    }, TICK * 1000);
    return () => {
      clearInterval(timer);
      // The part of the last 10 seconds before hang-up / mute counts too (short calls were free before)
      const rest = Math.round((Date.now() - lastTick) / 1000);
      if (rest >= 1) void consume(rest);
    };
  }, [inCall, callMode, voiceState, muted]);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    translatorRef.current?.setMuted(next);
  };

  const messageById = useMemo(() => new Map(messages.map(m => [m.id, m])), [messages]);

  const jumpToMessage = (id: string) => {
    document.getElementById(`msg-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightId(id);
    setTimeout(() => setHighlightId(current => current === id ? null : current), 1600);
  };

  const handleRetryTranslation = async (msgId: string) => {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, translation_status: 'pending' } : m));
    await requestTranslation(msgId);
  };

  const partner = participants.find(p => p.user_id !== profile.id);
  const isThisRoomLocked = (isRoomLockEnabled || (roomCode ? lockedRooms.includes(roomCode) : false)) && !!appPin && !(roomCode && unlockedRooms.includes(roomCode));

  if (roomError) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-8 gap-5 app-page-bg">
        <h1 className="font-display font-semibold text-2xl text-(--theme-ink)">{roomError}</h1>
        <p className="text-[15px] text-(--theme-muted)">{t('room.not_found_hint', profile.language)}</p>
        <button onClick={() => navigate('/')} className={primaryButton}>{t('room.back_home', profile.language)}</button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full max-h-full overflow-hidden app-page-bg relative transition-colors">
      <RoomHeader 
        roomCode={roomCode || ''} 
        partnerName={partner?.name}
        partnerGender={partner?.gender}
        partnerAvatar={partner?.avatarUrl}
        partnerStatus={partner?.status}
        participantsCount={participants.length}
        isConnected={isConnected}
        onOpenSettings={() => setShowSettings(true)}
        onOpenParticipants={() => setShowParticipants(true)}
        partnerTyping={!!partner && typingUsers.includes(partner.user_id)}
        onStartCall={partner && isConnected ? openVoiceModes : undefined}
        inCall={inCall}
      />

      {/* Chat Area - Header and Input stay fixed while only messages scroll */}
      <div 
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 pt-3 pb-1 flex flex-col transition-colors"
        style={getChatPatternStyle(chatPattern, theme === 'dark')}
      >
        {!partner && (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-10">
            <div className="w-full max-w-xs rounded-[2rem] bg-(--theme-card-bg) border border-(--theme-border) px-6 py-7 space-y-4">
              <h2 className="font-display font-semibold text-xl text-(--theme-ink)">{t('room.waiting_title', profile.language)}</h2>
              <p className="text-sm text-(--theme-muted) leading-relaxed">{t('room.waiting_desc', profile.language)}</p>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(roomCode || '');
                    setCodeCopied(true);
                    setTimeout(() => setCodeCopied(false), 2000);
                  } catch (err) {
                    console.error('Failed to copy', err);
                  }
                }}
                className="w-full rounded-3xl bg-(--theme-accent-light) py-4 flex flex-col items-center gap-1 cursor-pointer active:scale-[0.98] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--theme-accent)"
              >
                <span className="font-display font-semibold text-4xl tracking-[0.12em] text-(--theme-accent)">{roomCode}</span>
                <span className="text-xs font-bold text-(--theme-accent)">
                  {codeCopied ? t('create.copied', profile.language) : t('create.copy_code', profile.language)}
                </span>
              </button>
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <ChatMessage
            key={msg.id}
            message={msg}
            showOriginal={showOriginal}
            onRetry={handleRetryTranslation}
            onReply={setReplyTo}
            replyTo={msg.reply_to_id ? messageById.get(msg.reply_to_id) : null}
            onJumpTo={jumpToMessage}
            highlighted={highlightId === msg.id}
            isFirstInGroup={messages[i - 1]?.sender_id !== msg.sender_id}
            isLastInGroup={messages[i + 1]?.sender_id !== msg.sender_id}
            avatarUrl={participants.find(p => p.user_id === msg.sender_id)?.avatarUrl}
          />
        ))}

        {partner && typingUsers.includes(partner.user_id) && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 mb-2 ml-10"
            role="status"
            aria-label={t('room.typing', profile.language, { name: partner.name })}
          >
            <span className="inline-flex items-center gap-2 px-4 py-3 rounded-[1.4rem] rounded-bl-md bg-(--theme-card-bg) border border-(--theme-border) text-(--theme-muted)">
              <span className="translating-dots inline-flex items-center gap-1" aria-hidden>
                <span /><span /><span />
              </span>
              <span className="text-[13px] font-semibold">{t('room.typing', profile.language, { name: partner.name })}</span>
            </span>
          </motion.div>
        )}
        <div ref={messagesEndRef} className="h-4 shrink-0" />
      </div>

      {voiceError !== null && !inCall && (
        <div role="alert" className="mx-3 mb-1 flex items-center gap-2 rounded-2xl bg-red-500/10 border border-red-500/40 text-red-600 text-[13px] font-bold pl-3 pr-1 py-1">
          <span className="flex-1">{t('call.error', profile.language, { reason: voiceError })}</span>
          <button type="button" onClick={() => setVoiceError(null)} aria-label={t('common.close', profile.language)} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-red-500/10 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <VoiceCallBar
        lang={profile.language}
        partnerName={partner?.name || t('room.waiting_partner', profile.language)}
        inCall={inCall}
        partnerInCall={!!partner && callMembers.some(m => m.userId === partner.user_id)}
        state={voiceState}
        muted={muted}
        myCaption={myCaption}
        partnerCaption={partnerCaption}
        onJoin={openVoiceModes}
        onToggleMute={toggleMute}
        onEnd={endCall}
      />

      <ChatInput
        onSend={handleSendMessage}
        disabled={!isConnected}
        replyTo={replyTo ? {
          name: replyTo.sender_id === profile.id ? t('msg.you', profile.language) : replyTo.sender_name,
          text: readableText(replyTo, profile.id),
        } : null}
        onCancelReply={() => setReplyTo(null)}
        onTyping={(typing) => liveRef.current?.setTyping(typing)}
        micBusy={inCall}
        ref={chatInputRef}
      />

      {/* Settings Overlay */}
      <AnimatePresence>
        {showParticipants && (
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 240 }}
            className="absolute inset-0 z-50 app-page-bg flex flex-col"
            role="dialog"
            aria-modal="true"
            aria-label="Odalarım"
          >
            <SheetHeader title="Odalarım" onClose={() => setShowParticipants(false)} />

            <div className="flex-1 overflow-y-auto px-4 pt-5 pb-10 space-y-6">
              <SettingsGroup title="Oda kaydet">
                <form
                  className="p-3 space-y-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!newRoomCode.trim()) return;
                    addOrUpdateRoom({
                      code: newRoomCode.trim(),
                      lastAccessed: Date.now(),
                      customName: newRoomName.trim() || undefined
                    });
                    setNewRoomCode("");
                    setNewRoomName("");
                  }}
                >
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Oda kodu"
                      aria-label="Oda kodu"
                      value={newRoomCode}
                      maxLength={6}
                      onChange={(e) => setNewRoomCode(e.target.value.toUpperCase())}
                      className={cn(fieldClass, 'pr-12 font-display tracking-[0.1em] uppercase')}
                    />
                    <button
                      type="button"
                      title="Rastgele kod üret"
                      aria-label="Rastgele kod üret"
                      onClick={() => setNewRoomCode(generateRoomCode())}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full flex items-center justify-center text-(--theme-muted) hover:text-(--theme-accent) hover:bg-(--theme-accent-light) transition-colors cursor-pointer"
                    >
                      <Wand2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder={`Ad (isteğe bağlı)`}
                      aria-label="Oda adı"
                      value={newRoomName}
                      onChange={(e) => setNewRoomName(e.target.value)}
                      className={cn(fieldClass, 'flex-1 min-w-0')}
                    />
                    <button
                      type="submit"
                      disabled={!newRoomCode.trim()}
                      aria-label="Kaydet"
                      className="w-[52px] shrink-0 rounded-2xl bg-(--theme-accent) text-(--theme-on-accent) flex items-center justify-center hover:bg-(--theme-accent-hover) transition-colors disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
                    >
                      <Plus className="w-5 h-5" />
                    </button>
                  </div>
                </form>
              </SettingsGroup>

              {savedRooms.length === 0 ? (
                <p className="text-center text-[15px] text-(--theme-muted) py-8">
                  Henüz kayıtlı odan yok. Girdiğin odalar burada birikir.
                </p>
              ) : (
                <SettingsGroup title="Kayıtlı odalar">
                  {[...savedRooms].sort((a, b) => b.lastAccessed - a.lastAccessed).map(room => {
                    const label = room.customName || room.partnerName || t('room.unnamed', profile.language);
                    const isEditing = editingRoomCode === room.code;
                    const isLocked = lockedRooms.includes(room.code);
                    const saveName = () => {
                      updateRoomName(room.code, editRoomName.trim());
                      setEditingRoomCode(null);
                    };
                    const rowButton = "w-9 h-9 rounded-full flex items-center justify-center transition-colors cursor-pointer";
                    return (
                      <div key={room.code} className="flex items-center gap-3 px-3 py-3">
                        <button
                          type="button"
                          disabled={isEditing}
                          onClick={() => {
                            setShowParticipants(false);
                            if (room.code !== roomCode) {
                              setMessages([]); // Clear current messages for smoother transition
                              navigate(`/room/${room.code}`);
                            }
                          }}
                          className="flex-1 flex items-center gap-3 min-w-0 text-left cursor-pointer rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--theme-accent)"
                        >
                          <span className="w-12 h-12 rounded-full overflow-hidden bg-(--theme-accent-light) text-(--theme-accent) flex items-center justify-center shrink-0 font-display font-semibold text-lg">
                            {room.partnerAvatar
                              ? <img src={room.partnerAvatar} alt="" className="w-full h-full object-cover" />
                              : label[0].toLocaleUpperCase(profile.language)}
                          </span>
                          <span className="flex-1 min-w-0">
                            {isEditing ? (
                              <input
                                type="text"
                                autoFocus
                                value={editRoomName}
                                placeholder={t('room.unnamed', profile.language)}
                                aria-label="Oda adı"
                                onChange={(e) => setEditRoomName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') saveName();
                                  if (e.key === 'Escape') setEditingRoomCode(null);
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className={cn(fieldClass, 'py-1.5 px-3 text-sm')}
                              />
                            ) : (
                              <span className="block font-bold text-[15px] text-(--theme-ink) truncate">{label}</span>
                            )}
                            <span className="flex items-center gap-2 text-[13px] text-(--theme-muted) mt-0.5">
                              <span className="font-display tracking-[0.08em]">{room.code}</span>
                              {room.code === roomCode && (
                                <span className="px-2 py-0.5 rounded-full bg-(--theme-accent-light) text-(--theme-accent) text-[11px] font-bold">Şu an burada</span>
                              )}
                            </span>
                          </span>
                        </button>

                        <div className="flex items-center shrink-0">
                          {appPin && (
                            <button
                              type="button"
                              onClick={() => toggleRoomLock(room.code)}
                              aria-label={isLocked ? 'Oda kilidini kaldır' : 'Odayı PIN ile kilitle'}
                              aria-pressed={isLocked}
                              title={isLocked ? 'Oda kilidini kaldır' : 'Odayı PIN ile kilitle'}
                              className={cn(rowButton, isLocked ? 'text-(--theme-accent) bg-(--theme-accent-light)' : 'text-(--theme-muted) hover:text-(--theme-ink) hover:bg-(--theme-subtle-bg)')}
                            >
                              {isLocked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                            </button>
                          )}
                          {isEditing ? (
                            <button type="button" onClick={saveName} className="h-9 px-3.5 rounded-full bg-(--theme-accent) text-(--theme-on-accent) text-[13px] font-bold flex items-center gap-1 hover:bg-(--theme-accent-hover) transition-colors cursor-pointer">
                              <Check className="w-4 h-4" />
                              {t('common.save', profile.language)}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setEditRoomName(room.customName || room.partnerName || '');
                                setEditingRoomCode(room.code);
                              }}
                              aria-label="Yeniden adlandır"
                              className={cn(rowButton, 'text-(--theme-muted) hover:text-(--theme-ink) hover:bg-(--theme-subtle-bg)')}
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => removeRoom(room.code)}
                            aria-label="Listeden kaldır"
                            className={cn(rowButton, 'text-(--theme-muted) hover:text-red-600 hover:bg-red-500/10')}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </SettingsGroup>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <VoiceModeSheet
        open={showVoiceModes}
        status={vipStatus}
        onClose={() => setShowVoiceModes(false)}
        onStart={startCall}
        onOpenPlans={() => { setShowVoiceModes(false); navigate('/plans'); }}
        onDictate={isDictationSupported() && !inCall ? () => { setShowVoiceModes(false); chatInputRef.current?.startDictation(); } : undefined}
      />

      <SettingsSheet
        open={showSettings}
        onClose={() => setShowSettings(false)}
        room={{
          partnerLanguageName: partner
            ? plainLanguageName(LANGUAGES.find(l => l.code === partner.language)?.name || partner.language)
            : t('room.waiting_partner', profile.language),
          showOriginal,
          setShowOriginal,
          onLeave: () => navigate('/'),
        }}
      />

      {/* Room Security Lock Modal */}
      {isThisRoomLocked && (
        <SecurityLockModal
          isOpen={true}
          mode="unlock"
          title={`${roomCode} kilitli`}
          subtitle="Bu odaya girmek için 4 haneli PIN kodunu gir."
          onSuccess={() => {
            if (roomCode) unlockRoom(roomCode);
          }}
          onCancel={() => {
            navigate('/');
          }}
        />
      )}
    </div>
  );
}
