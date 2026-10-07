// Ephemeral signals for one room over local Express SSE:
// "yazıyor…" (typing), who is in the voice call, and the voice call's translated audio + live captions.

/** 'paid' speakers relay translated audio; 'free' speakers' sentences are read aloud by the listener */
export interface CallMember {
  userId: string;
  engine: 'free' | 'paid';
}

export interface LiveHandlers {
  onTyping: (userId: string, typing: boolean) => void;
  /** Who is in the voice call (including me) and which engine they speak through */
  onCallMembers: (members: CallMember[]) => void;
  /** 24 kHz PCM16 (base64) of a partner's speech, already translated into my language */
  onAudio: (from: string, data: string) => void;
  /** What the partner is saying right now, translated; empty text clears the caption */
  onCaption: (from: string, text: string) => void;
}

export interface LiveChannel {
  setTyping: (typing: boolean) => void;
  setInCall: (inCall: boolean, engine?: 'free' | 'paid') => void;
  sendAudio: (data: string) => void;
  sendCaption: (text: string) => void;
  leave: () => void;
}

export function joinLiveChannel(roomId: string, userId: string, handlers: LiveHandlers): LiveChannel {
  const eventSource = new EventSource(`/api/rooms/${roomId}/events`);
  
  // Track call members locally since we don't have real Supabase Presence
  let callMembers: CallMember[] = [];

  eventSource.addEventListener('typing', (e: any) => {
    const payload = JSON.parse(e.data);
    if (payload.from !== userId) {
      handlers.onTyping(payload.from, !!payload.typing);
    }
  });

  eventSource.addEventListener('audio', (e: any) => {
    const payload = JSON.parse(e.data);
    if (payload.from !== userId) {
      handlers.onAudio(payload.from, payload.data);
    }
  });

  eventSource.addEventListener('caption', (e: any) => {
    const payload = JSON.parse(e.data);
    if (payload.from !== userId) {
      handlers.onCaption(payload.from, payload.text ?? '');
    }
  });

  eventSource.addEventListener('call_sync', (e: any) => {
    const payload = JSON.parse(e.data);
    if (payload.from !== userId) {
      // Very simple presence mock: update the list when someone else joins/leaves a call
      const other: CallMember = { userId: payload.from, engine: payload.engine };
      if (payload.inCall) {
        callMembers = [...callMembers.filter(m => m.userId !== other.userId), other];
      } else {
        callMembers = callMembers.filter(m => m.userId !== other.userId);
      }
      handlers.onCallMembers(callMembers);
    }
  });

  const send = async (event: string, payload: Record<string, unknown>) => {
    try {
      await fetch(`/api/rooms/${roomId}/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event, payload: { from: userId, ...payload } })
      });
    } catch (e) {
      console.error('Broadcast failed', e);
    }
  };

  return {
    setTyping: (typing) => send('typing', { typing }),
    setInCall: (inCall, engine = 'free') => {
      send('call_sync', { inCall, engine });
    },
    sendAudio: (data) => send('audio', { data }),
    sendCaption: (text) => send('caption', { text }),
    leave: () => {
      eventSource.close();
    },
  };
}
