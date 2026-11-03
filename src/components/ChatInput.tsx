import React, { useState, useRef, useEffect, useImperativeHandle } from 'react';
import { Send, Zap, Plus, X, Pencil, Trash2, Check, Reply, Mic, Square } from 'lucide-react';
import { cn } from '../lib/utils';
import { useStore } from '../store/useStore';
import { t, getDefaultQuickMessages } from '../lib/i18n';
import { Dictation, isDictationSupported, speak } from '../lib/voice';

/** Tell the partner "yazıyor…" at most this often while typing */
const TYPING_PING_MS = 2500;
/** Stop showing "yazıyor…" after this much inactivity */
const TYPING_IDLE_MS = 3500;
/** Voice typing: once I'm quiet this long, what I said is sent */
const DICTATION_SEND_MS = 3000;

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  /** The message being answered, shown above the field */
  replyTo?: { name: string; text: string } | null;
  onCancelReply?: () => void;
  onTyping?: (typing: boolean) => void;
  /** The microphone is taken by a voice call: no voice typing meanwhile */
  micBusy?: boolean;
  sendVoice?: boolean;
  ref?: React.Ref<ChatInputHandle>;
}

export interface ChatInputHandle {
  /** Voice typing, started from the voice sheet; must be called inside the tap */
  startDictation: () => void;
}

export default function ChatInput({ onSend, disabled, replyTo, onCancelReply, onTyping, micBusy, sendVoice, ref }: ChatInputProps) {
  const { profile, quickMessages: savedQuickMessages, addQuickMessage, removeQuickMessage, updateQuickMessage } = useStore();
  const quickMessages = savedQuickMessages ?? getDefaultQuickMessages(profile.language);
  const lang = profile.language;
  const [text, setText] = useState('');
  const [showQuickMessages, setShowQuickMessages] = useState(false);
  const [newQuickMsg, setNewQuickMsg] = useState('');
  const [editingMsg, setEditingMsg] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Voice typing: what I say is written into the field and sent by itself when I go quiet
  const [dictating, setDictating] = useState(false);
  const [dictationError, setDictationError] = useState<string | null>(null);
  const dictationRef = useRef<Dictation | null>(null);
  const dictationBase = useRef('');
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textRef = useRef('');
  textRef.current = text;
  // The send timer outlives renders: always use the latest props
  const sendRef = useRef({ onSend, disabled });
  sendRef.current = { onSend, disabled };

  const clearSilenceTimer = () => {
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    silenceTimer.current = null;
  };

  const stopDictation = () => {
    clearSilenceTimer();
    dictationRef.current?.stop();
    dictationRef.current = null;
    setDictating(false);
  };

  /** Empties the field after a send; voice typing keeps listening for the next sentence */
  const clearAfterSend = () => {
    clearSilenceTimer();
    dictationBase.current = '';
    dictationRef.current?.reset();
    stopTyping();
    setText('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const sendDictated = () => {
    silenceTimer.current = null;
    const message = textRef.current.trim();
    if (!message || sendRef.current.disabled || !dictationRef.current) return;
    sendRef.current.onSend(message);
    clearAfterSend();
  };

  const startDictation = () => {
    if (dictationRef.current || disabled || micBusy) return;
    setDictationError(null);
    dictationBase.current = textRef.current.trim();
    const dictation = new Dictation({
      language: lang,
      onText: (finalText, interim) => {
        const spoken = [finalText, interim].filter(Boolean).join(' ');
        const value = [dictationBase.current, spoken].filter(Boolean).join(' ');
        textRef.current = value;
        handleTextChange(value);
        // Still talking: wait for the next pause
        clearSilenceTimer();
        if (spoken) silenceTimer.current = setTimeout(sendDictated, DICTATION_SEND_MS);
      },
      onEnd: (error) => {
        clearSilenceTimer();
        dictationRef.current = null;
        setDictating(false);
        if (error) setDictationError(error);
      },
    });
    dictationRef.current = dictation;
    setDictating(true);
    dictation.start();
  };

  useImperativeHandle(ref, () => ({ startDictation }));

  useEffect(() => { if (micBusy) stopDictation(); }, [micBusy]);
  useEffect(() => () => { clearSilenceTimer(); dictationRef.current?.stop(); }, []);
  useEffect(() => {
    if (!dictationError) return;
    const timer = setTimeout(() => setDictationError(null), 4000);
    return () => clearTimeout(timer);
  }, [dictationError]);

  const startEditing = (msg: string) => {
    setEditingMsg(msg);
    setEditText(msg);
  };

  const handleSaveEdit = () => {
    if (editingMsg && editText.trim()) {
      updateQuickMessage(editingMsg, editText.trim());
    }
    setEditingMsg(null);
    setEditText('');
  };

  const handleCancelEdit = () => {
    setEditingMsg(null);
    setEditText('');
  };

  // "yazıyor…": ping while keys are pressed, clear after a pause or on send
  const lastTypingPing = useRef(0);
  const typingIdleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopTyping = () => {
    if (typingIdleTimer.current) clearTimeout(typingIdleTimer.current);
    typingIdleTimer.current = null;
    if (lastTypingPing.current) onTyping?.(false);
    lastTypingPing.current = 0;
  };
  const handleTextChange = (value: string) => {
    setText(value);
    if (!onTyping) return;
    if (!value.trim()) return stopTyping();
    const now = Date.now();
    if (now - lastTypingPing.current > TYPING_PING_MS) {
      lastTypingPing.current = now;
      onTyping(true);
    }
    if (typingIdleTimer.current) clearTimeout(typingIdleTimer.current);
    typingIdleTimer.current = setTimeout(stopTyping, TYPING_IDLE_MS);
  };
  useEffect(() => () => { if (typingIdleTimer.current) clearTimeout(typingIdleTimer.current); }, []);

  useEffect(() => {
    if (replyTo) textareaRef.current?.focus();
  }, [replyTo]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (text.trim() && !disabled) {
      onSend(text.trim());
      if (sendVoice) void speak(text.trim(), lang);
      clearAfterSend();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const adjustHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  };

  useEffect(() => {
    adjustHeight();
  }, [text]);

  // Handle outside click to close popover
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setShowQuickMessages(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <form 
      onSubmit={handleSubmit}
      className="px-3 pt-2 pb-3 app-page-bg flex items-end gap-2 shrink-0 pb-safe z-20 transition-colors"
    >
      <div className="flex-1 min-w-0 relative bg-(--theme-card-bg) rounded-[1.6rem] border-2 border-(--theme-border) focus-within:border-(--theme-accent) transition-colors flex flex-col">
        {dictating && (
          <div className="flex items-center gap-2 mx-2 mt-2 pl-3 pr-1 py-1 rounded-2xl bg-red-500/10 text-red-600">
            <Mic className="w-4 h-4 shrink-0 animate-pulse" aria-hidden />
            <span className="flex-1 min-w-0 text-[13px] font-bold truncate">Dinliyorum… susunca mesajın gider</span>
            <button
              type="button"
              onClick={stopDictation}
              aria-label="Sesli yazmayı durdur"
              className="h-8 shrink-0 rounded-full flex items-center gap-1 px-3 bg-red-500 text-white text-[12.5px] font-bold cursor-pointer"
            >
              <Square className="w-3 h-3 fill-current" /> Durdur
            </button>
          </div>
        )}
        {replyTo && (
          <div className="flex items-center gap-2 mx-2 mt-2 pl-2.5 pr-1 py-1.5 rounded-2xl bg-(--theme-subtle-bg) border-l-4 border-(--theme-accent)">
            <Reply className="w-4 h-4 shrink-0 text-(--theme-accent)" aria-hidden />
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-bold text-(--theme-accent) truncate">{replyTo.name}</div>
              <div className="text-[13px] text-(--theme-muted) truncate">{replyTo.text}</div>
            </div>
            <button
              type="button"
              onClick={onCancelReply}
              aria-label={t('msg.reply_cancel', lang)}
              title={t('msg.reply_cancel', lang)}
              className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-(--theme-muted) hover:text-(--theme-ink) hover:bg-(--theme-card-bg) transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className="flex items-end">
        <div className="relative shrink-0 flex items-center justify-center p-1.5 pl-2" ref={popoverRef}>
          <button
            type="button"
            title="Hazır Mesajlar"
            aria-label="Hazır mesajlar"
            aria-expanded={showQuickMessages}
            onClick={() => setShowQuickMessages(!showQuickMessages)}
            className={cn(
              "w-9 h-9 rounded-full flex items-center justify-center transition-colors",
              showQuickMessages 
                ? "bg-(--theme-accent-light) text-(--theme-accent)" 
                : "text-(--theme-muted) hover:text-(--theme-accent) hover:bg-(--theme-accent-light)"
            )}
          >
            <Zap className="w-5 h-5" />
          </button>
          
          {isDictationSupported() && !dictating && !micBusy && (
            <button
              type="button"
              title="Sesli yazma"
              aria-label="Sesli yazma"
              onClick={startDictation}
              className="w-9 h-9 rounded-full flex items-center justify-center text-(--theme-muted) hover:text-(--theme-accent) hover:bg-(--theme-accent-light) transition-colors"
            >
              <Mic className="w-4 h-4" />
            </button>
          )}
          
          {/* Quick Messages Popover */}
          {showQuickMessages && (
            <div className="absolute bottom-full left-0 mb-3 w-72 sm:w-80 bg-(--theme-card-bg) rounded-3xl shadow-xl border border-(--theme-border) overflow-hidden z-50">
              <div className="pl-4 pr-2 py-2 border-b border-(--theme-border) flex justify-between items-center">
                <span className="flex items-center gap-1.5 font-bold text-sm text-(--theme-ink)">
                  <Zap className="w-4 h-4 text-(--theme-accent)" />
                  {t('quick.title', lang)}
                </span>
                <button 
                  type="button"
                  onClick={() => {
                    setShowQuickMessages(false);
                    setEditingMsg(null);
                  }} 
                  aria-label={t('common.close', lang)}
                  className="w-8 h-8 flex items-center justify-center rounded-full text-(--theme-muted) hover:text-(--theme-ink) hover:bg-(--theme-subtle-bg) transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="max-h-56 overflow-y-auto p-2 space-y-0.5">
                {quickMessages.length === 0 ? (
                  <p className="text-sm text-center text-(--theme-muted) py-4 px-3">{t('quick.empty', lang)}</p>
                ) : (
                  quickMessages.map((msg, index) => (
                    <div key={`${msg}-${index}`}>
                      {editingMsg === msg ? (
                        <div className="p-1 bg-(--theme-accent-light) rounded-2xl flex items-center gap-1">
                          <input
                            type="text"
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            autoFocus
                            placeholder={t('quick.edit_placeholder', lang)}
                            className="flex-1 min-w-0 bg-(--theme-card-bg) border-2 border-transparent rounded-xl px-2.5 py-1.5 text-sm font-semibold outline-none focus:border-(--theme-accent) text-(--theme-ink)"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleSaveEdit();
                              } else if (e.key === 'Escape') {
                                handleCancelEdit();
                              }
                            }}
                          />
                          <button
                            type="button"
                            title={t('common.save', lang)}
                            onClick={handleSaveEdit}
                            aria-label={t('common.save', lang)}
                            className="w-8 h-8 flex items-center justify-center text-(--theme-accent) hover:bg-(--theme-card-bg) rounded-full transition-colors cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            title={t('common.cancel', lang)}
                            onClick={handleCancelEdit}
                            aria-label={t('common.cancel', lang)}
                            className="w-8 h-8 flex items-center justify-center text-(--theme-muted) hover:text-(--theme-ink) hover:bg-(--theme-card-bg) rounded-full transition-colors cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-1 rounded-2xl hover:bg-(--theme-subtle-bg) transition-colors p-0.5 group">
                          <button 
                            type="button"
                            onClick={() => {
                              setShowQuickMessages(false);
                              onSend(msg);
                            }}
                            className="flex-1 min-w-0 text-left px-2 py-1.5 text-sm font-semibold text-(--theme-ink) truncate hover:text-(--theme-accent) transition-colors cursor-pointer"
                            title={msg}
                          >
                            {msg}
                          </button>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              title={t('common.edit', lang)}
                              onClick={(e) => {
                                e.stopPropagation();
                                startEditing(msg);
                              }}
                              aria-label={t('common.edit', lang)}
                              className="w-8 h-8 flex items-center justify-center text-(--theme-muted) hover:text-(--theme-accent) hover:bg-(--theme-accent-light) rounded-full transition-colors cursor-pointer"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              title={t('common.delete', lang)}
                              onClick={(e) => {
                                e.stopPropagation();
                                removeQuickMessage(msg);
                              }}
                              aria-label={t('common.delete', lang)}
                              className="w-8 h-8 flex items-center justify-center text-(--theme-muted) hover:text-red-600 hover:bg-red-500/10 rounded-full transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
              <div className="p-2 border-t border-(--theme-border) flex items-center gap-2">
                <input 
                  type="text" 
                  value={newQuickMsg}
                  onChange={(e) => setNewQuickMsg(e.target.value)}
                  placeholder={t('quick.new', lang)}
                  aria-label={t('quick.new', lang)}
                  className="flex-1 min-w-0 bg-(--theme-subtle-bg) border-2 border-transparent rounded-full px-3.5 py-1.5 text-sm font-semibold outline-none focus:border-(--theme-accent) text-(--theme-ink) placeholder:text-(--theme-muted)"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (newQuickMsg.trim()) {
                        addQuickMessage(newQuickMsg.trim());
                        setNewQuickMsg('');
                      }
                    }
                  }}
                />
                <button
                  type="button"
                  title={t('common.add', lang)}
                  aria-label={t('common.add', lang)}
                  onClick={() => {
                    if (newQuickMsg.trim()) {
                      addQuickMessage(newQuickMsg.trim());
                      setNewQuickMsg('');
                    }
                  }}
                  disabled={!newQuickMsg.trim()}
                  className="w-8 h-8 bg-(--theme-accent) hover:bg-(--theme-accent-hover) text-(--theme-on-accent) rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center cursor-pointer shrink-0"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
        
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => handleTextChange(e.target.value)}
          onBlur={stopTyping}
          onKeyDown={handleKeyDown}
          placeholder={dictating ? 'Dinliyorum… konuş' : t('room.type_message', profile.language)}
          disabled={disabled}
          rows={1}
          className="w-full max-h-32 bg-transparent border-none outline-none focus:ring-0 resize-none py-3 pr-4 text-[16px] sm:text-[15px] text-(--theme-ink) placeholder:text-(--theme-muted) disabled:opacity-50"
        />
        </div>
        {dictationError && (
          <p role="alert" className="px-4 pb-2 text-[12.5px] font-bold text-red-600">{dictationError}</p>
        )}
      </div>
      
      <button
        type="submit"
        disabled={!text.trim() || disabled}
        aria-label="Gönder"
        className={cn(
          "w-[52px] h-[52px] rounded-full flex items-center justify-center transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-(--theme-accent)",
          text.trim() && !disabled
            ? "bg-(--theme-accent) text-(--theme-on-accent) hover:bg-(--theme-accent-hover) active:scale-95"
            : "bg-(--theme-subtle-bg) text-(--theme-muted)"
        )}
      >
        <Send className="w-5 h-5 -ml-0.5" />
      </button>
    </form>
  );
}
