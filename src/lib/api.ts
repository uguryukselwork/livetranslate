// Data access for rooms, participants and messages via the local Express server.
import { v4 as uuidv4 } from 'uuid';
import type { MessageType } from '../components/ChatMessage';

export interface Room {
  id: string;
  code: string;
}

export interface Participant {
  room_id: string;
  user_id: string;
  name: string;
  gender: 'male' | 'female' | null;
  language: string;
  avatarUrl: string | null;
  status: string;
}

export interface ParticipantInput {
  name: string;
  gender: 'male' | 'female' | null;
  language: string;
  avatarUrl?: string | null;
  status?: string;
}

/** Finds a room by its invite code */
export async function findRoom(code: string): Promise<Room | null> {
  const res = await fetch(`/api/rooms/by-code/${code.trim().toUpperCase()}`);
  if (!res.ok) return null;
  return res.json();
}

/** Creates a room with the given code */
export async function createRoom(code: string): Promise<Room | null> {
  const res = await fetch('/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: code.toUpperCase() })
  });
  if (!res.ok) return null;
  return res.json();
}

/** Joins the room as the current user, or refreshes the user's name/language/photo in it */
export async function upsertParticipant(roomId: string, userId: string, p: ParticipantInput) {
  const res = await fetch(`/api/rooms/${roomId}/participants`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, ...p })
  });
  if (!res.ok) throw new Error('Participant update failed');
  return res.json();
}

export async function fetchParticipants(roomId: string): Promise<Participant[]> {
  const res = await fetch(`/api/rooms/${roomId}/participants`);
  if (!res.ok) return [];
  return res.json();
}

/** The newest messages of the room */
export async function fetchMessages(roomId: string): Promise<MessageType[]> {
  const res = await fetch(`/api/rooms/${roomId}/messages`);
  if (!res.ok) return [];
  return res.json();
}

/** Asks the server to (re)translate a message */
export async function requestTranslation(messageId: string, spoken?: string) {
  // Not implemented on local server yet, but exported for build
  console.log('Request translation', messageId, spoken);
}

export async function sendMessage(msg: {
  room_id: string;
  sender_id: string; // Added sender_id which server.ts expects
  sender_name: string;
  sender_gender: string | null;
  sender_avatar: string | null;
  original_text: string;
  original_language: string;
  target_language: string;
  reply_to_id?: string | null;
  is_voice?: boolean;
}): Promise<MessageType> {
  const res = await fetch(`/api/rooms/${msg.room_id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(msg)
  });
  if (!res.ok) throw new Error('Message send failed');
  return res.json();
}

// VIP membership mocked for local environment
export type VipAccess = 'members' | 'everyone' | 'off';

export interface VipStatus {
  access: VipAccess;
  vipUntil: string | null;
  canUseVip: boolean;
  balanceUsd: number;
  vipSeconds: number;
}

export async function fetchVipStatus(_userId: string): Promise<VipStatus> {
  // Everyone is VIP in the local test environment
  return {
    access: 'everyone',
    vipUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    canUseVip: true,
    balanceUsd: 100,
    vipSeconds: 36000,
  };
}

export function subscribeToMembership(_userId: string, _onChange: () => void): () => void {
  return () => {};
}

export async function fetchAnnouncement(): Promise<string> {
  return '';
}

export async function markMessagesRead(roomId: string, userId: string) {
  await fetch(`/api/rooms/${roomId}/messages/read`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId })
  });
}

/** Live updates for one room using Server-Sent Events */
export function subscribeToRoom(roomId: string, handlers: {
  onMessageInsert: (m: MessageType) => void;
  onMessageUpdate: (m: MessageType) => void;
  onParticipantsChange: () => void;
  onSubscribed?: () => void;
}): () => void {
  const eventSource = new EventSource(`/api/rooms/${roomId}/events`);
  
  eventSource.onopen = () => {
    handlers.onSubscribed?.();
  };
  
  eventSource.addEventListener('message_new', (e: any) => {
    handlers.onMessageInsert(JSON.parse(e.data));
  });
  
  eventSource.addEventListener('message_update', (e: any) => {
    handlers.onMessageUpdate(JSON.parse(e.data));
  });
  
  eventSource.addEventListener('participant_update', () => {
    handlers.onParticipantsChange();
  });
  
  eventSource.onerror = (e) => {
    console.error('SSE Error', e);
  };
  
  return () => {
    eventSource.close();
  };
}

export async function requestVip(_kind: 'gift' | 'purchase', _plan: string | null, _name: string): Promise<'sent' | 'already_pending'> {
  return 'sent';
}

export async function fetchMyLatestRequest(_userId: string) {
  return null;
}

// Admin mock exports
export interface AdminUser {
  user_id: string;
  name: string;
  last_seen: string;
  vip_until: string | null;
  balance_usd: number;
  vip_seconds: number;
}

export interface AdminOverview {
  vip_access: VipAccess;
  vip_members: number;
  requests: VipRequest[];
  users: AdminUser[];
}

export interface VipRequest {
  id: string;
  user_id: string;
  user_name: string;
  kind: 'gift' | 'purchase';
  plan: string | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  decided_at: string | null;
}

export interface RoomMember {
  user_id: string;
  name: string;
  last_seen: string;
  vip_until: string | null;
}

export async function adminCheckPin(_pin: string): Promise<boolean> {
  return true;
}

export async function adminOverview(_pin: string): Promise<AdminOverview | null> {
  return {
    vip_access: 'everyone',
    vip_members: 0,
    requests: [],
    users: []
  };
}

export async function adminSetVipAccess(_pin: string, _value: VipAccess): Promise<boolean> {
  return true;
}

export async function adminDecideRequest(_pin: string, _id: string, _approve: boolean, _days: number | null): Promise<boolean> {
  return true;
}

export async function adminAddBalance(_pin: string, _userId: string, _amount: number): Promise<boolean> {
  return true;
}

export async function adminGrantHours(_pin: string, _userId: string, _hours: number): Promise<boolean> {
  return true;
}

export async function adminRoomMembers(_pin: string, _code: string): Promise<RoomMember[] | null> {
  return [];
}

export async function adminSetAnnouncement(_pin: string, _text: string): Promise<boolean> {
  return true;
}

export async function adminGrantVip(_pin: string, _userId: string, _days: number): Promise<boolean> {
  return true;
}

export async function consumeVipSeconds(seconds: number): Promise<number> {
  return -1;
}

export async function buyWithBalance(_plan: string): Promise<'ok' | 'insufficient' | 'invalid_plan'> {
  return 'ok';
}
