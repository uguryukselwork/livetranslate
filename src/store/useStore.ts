import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import type { User } from '@supabase/supabase-js';
import { getBrowserLanguage, getDefaultQuickMessages } from '../lib/i18n';
import { ColorThemeId, ChatPatternId, BubbleColorId, themeForGender } from '../lib/themes';

export type Gender = 'male' | 'female';

// Served from public/; everyone starts with this picture until they pick their own
export const DEFAULT_AVATAR = '/default-avatar.jpg?v=3';

export interface SavedRoom {
  code: string;
  lastAccessed: number;
  partnerName?: string;
  partnerAvatar?: string;
  partnerGender?: Gender | null;
  customName?: string;
  isLocked?: boolean;
}

export interface UserProfile {
  id: string;
  name: string;
  gender: Gender | null;
  language: string;
  partnerLanguage: string;
  avatarUrl?: string;
  status?: string;
}

interface AppState {
  // Supabase auth (not persisted; supabase-js keeps the session itself)
  authUser: User | null;
  authReady: boolean;
  setAuthUser: (user: User | null) => void;
  profile: UserProfile;
  setProfile: (profile: Partial<UserProfile>) => void;
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
  colorTheme: ColorThemeId;
  setColorTheme: (colorTheme: ColorThemeId) => void;
  bubbleColor: BubbleColorId;
  setBubbleColor: (bubbleColor: BubbleColorId) => void;
  chatPattern: ChatPatternId;
  setChatPattern: (chatPattern: ChatPatternId) => void;
  resetThemeSettings: () => void;
  soundEnabled: boolean;
  setSoundEnabled: (enabled: boolean) => void;
  notificationSound: string;
  setNotificationSound: (sound: string) => void;
  soundVolume: number;
  setSoundVolume: (volume: number) => void;
  deferredPrompt: any;
  setDeferredPrompt: (prompt: any) => void;
  fontSize: 'small' | 'medium' | 'large';
  setFontSize: (size: 'small' | 'medium' | 'large') => void;
  fontFamily: 'sans' | 'serif' | 'mono';
  setFontFamily: (family: 'sans' | 'serif' | 'mono') => void;
  isPremium: boolean;
  setIsPremium: (isPremium: boolean) => void;
  hideProfile: boolean;
  setHideProfile: (hide: boolean) => void;
  vibrationEnabled: boolean;
  setVibrationEnabled: (enabled: boolean) => void;
  // Security PIN & Biometrics
  appPin: string | null;
  setAppPin: (pin: string | null) => void;
  isAppLockEnabled: boolean;
  setIsAppLockEnabled: (enabled: boolean) => void;
  isRoomLockEnabled: boolean;
  setIsRoomLockEnabled: (enabled: boolean) => void;
  biometricEnabled: boolean;
  setBiometricEnabled: (enabled: boolean) => void;
  lockedRooms: string[];
  toggleRoomLock: (roomCode: string) => void;
  isAppUnlocked: boolean;
  unlockApp: () => void;
  unlockedRooms: string[];
  unlockRoom: (roomCode: string) => void;
  lockAppNow: () => void;
  // Saved Rooms & Quick Messages
  savedRooms: SavedRoom[];
  addOrUpdateRoom: (room: SavedRoom) => void;
  removeRoom: (code: string) => void;
  updateRoomName: (code: string, customName: string) => void;
  // null = the built-in set, shown in the current UI language
  quickMessages: string[] | null;
  addQuickMessage: (msg: string) => void;
  removeQuickMessage: (msg: string) => void;
  updateQuickMessage: (oldMsg: string, newMsg: string) => void;
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      authUser: null,
      authReady: false,
      setAuthUser: (authUser) => set({ authUser, authReady: true }),
      profile: {
        id: uuidv4(),
        name: '',
        gender: null,
        language: getBrowserLanguage(),
        partnerLanguage: 'auto',
        avatarUrl: DEFAULT_AVATAR,
        status: 'online',
      },
      setProfile: (updates) =>
        set((state) => {
          const profile = { ...state.profile, ...updates };
          // Picking a gender switches to its matching light theme
          if ('gender' in updates && updates.gender !== state.profile.gender) {
            return { profile, colorTheme: themeForGender(profile.gender), theme: 'light' as const };
          }
          return { profile };
        }),
      theme: 'light',
      setTheme: (theme) => set({ theme }),
      colorTheme: 'indigo',
      setColorTheme: (colorTheme) => set({ colorTheme }),
      bubbleColor: 'theme',
      setBubbleColor: (bubbleColor) => set({ bubbleColor }),
      chatPattern: 'none',
      setChatPattern: (chatPattern) => set({ chatPattern }),
      resetThemeSettings: () => {
        const colorTheme = themeForGender(get().profile.gender);
        set({ colorTheme, bubbleColor: 'theme', chatPattern: 'none' });
        if (typeof document !== 'undefined') {
          document.documentElement.setAttribute('data-color-theme', colorTheme);
        }
      },
      soundEnabled: true,
      setSoundEnabled: (soundEnabled) => set({ soundEnabled }),
      notificationSound: 'pop',
      setNotificationSound: (notificationSound) => set({ notificationSound }),
      soundVolume: 0.5,
      setSoundVolume: (volume) => set({ soundVolume: volume }),
      deferredPrompt: null,
      setDeferredPrompt: (deferredPrompt) => set({ deferredPrompt }),
      fontSize: 'large',
      setFontSize: (fontSize) => set({ fontSize }),
      fontFamily: 'sans',
      setFontFamily: (fontFamily) => set({ fontFamily }),
      isPremium: false,
      setIsPremium: (isPremium) => set({ isPremium }),
      hideProfile: false,
      setHideProfile: (hideProfile) => set({ hideProfile }),
      vibrationEnabled: true,
      setVibrationEnabled: (vibrationEnabled) => set({ vibrationEnabled }),
      // Security
      appPin: null,
      setAppPin: (appPin) => set({ appPin }),
      isAppLockEnabled: false,
      setIsAppLockEnabled: (isAppLockEnabled) => set({ isAppLockEnabled }),
      isRoomLockEnabled: false,
      setIsRoomLockEnabled: (isRoomLockEnabled) => set({ isRoomLockEnabled }),
      biometricEnabled: false,
      setBiometricEnabled: (biometricEnabled) => set({ biometricEnabled }),
      lockedRooms: [],
      toggleRoomLock: (roomCode) =>
        set((state) => {
          const exists = state.lockedRooms.includes(roomCode);
          return {
            lockedRooms: exists 
              ? state.lockedRooms.filter(c => c !== roomCode)
              : [...state.lockedRooms, roomCode]
          };
        }),
      isAppUnlocked: false,
      unlockApp: () => set({ isAppUnlocked: true }),
      unlockedRooms: [],
      unlockRoom: (roomCode) =>
        set((state) => ({
          unlockedRooms: state.unlockedRooms.includes(roomCode)
            ? state.unlockedRooms
            : [...state.unlockedRooms, roomCode]
        })),
      lockAppNow: () => set({ isAppUnlocked: false, unlockedRooms: [] }),
      savedRooms: [],
      addOrUpdateRoom: (room) => 
        set((state) => {
          const existing = state.savedRooms.find(r => r.code === room.code);
          const filtered = state.savedRooms.filter(r => r.code !== room.code);
          return { savedRooms: [{ ...room, customName: room.customName || existing?.customName }, ...filtered] };
        }),
      removeRoom: (code) =>
        set((state) => ({
          savedRooms: state.savedRooms.filter(r => r.code !== code)
        })),
      updateRoomName: (code, customName) =>
        set((state) => ({
          savedRooms: state.savedRooms.map(r => 
            r.code === code ? { ...r, customName } : r
          )
        })),
      quickMessages: null,
      // Editing the built-in set freezes it in the language it was shown in
      addQuickMessage: (msg) => 
        set((state) => {
          const current = state.quickMessages ?? getDefaultQuickMessages(state.profile.language);
          if (!current.includes(msg)) {
            return { quickMessages: [...current, msg] };
          }
          return state;
        }),
      removeQuickMessage: (msg) =>
        set((state) => ({
          quickMessages: (state.quickMessages ?? getDefaultQuickMessages(state.profile.language)).filter(m => m !== msg)
        })),
      updateQuickMessage: (oldMsg, newMsg) =>
        set((state) => {
          const trimmed = newMsg.trim();
          if (!trimmed) return state;
          return {
            quickMessages: (state.quickMessages ?? getDefaultQuickMessages(state.profile.language)).map(m => m === oldMsg ? trimmed : m)
          };
        }),
    }),
    {
      name: 'livetranslate-storage',
      version: 3,
      // v1: the soft "blush" theme replaced indigo as the default look
      // v2: untouched Turkish quick messages become the language-aware built-in set
      // v3: profiles without a picture get the default avatar
      migrate: (persisted: any, version) => {
        if (version < 1 && persisted?.colorTheme === 'indigo') {
          persisted.colorTheme = 'blush';
        }
        if (version < 2 && Array.isArray(persisted?.quickMessages)
          && persisted.quickMessages.join('|') === 'Tamam|Seni seviyorum|Görüşürüz|Nasılsın?') {
          persisted.quickMessages = null;
        }
        if (version < 3 && persisted?.profile && !persisted.profile.avatarUrl) {
          persisted.profile.avatarUrl = DEFAULT_AVATAR;
        }
        return persisted;
      },
      partialize: (state) => ({ 
        profile: state.profile, 
        theme: state.theme, 
        colorTheme: state.colorTheme,
        bubbleColor: state.bubbleColor,
        chatPattern: state.chatPattern,
        soundEnabled: state.soundEnabled,
        notificationSound: state.notificationSound,
        soundVolume: state.soundVolume,
        fontSize: state.fontSize,
        fontFamily: state.fontFamily,
        isPremium: state.isPremium,
        hideProfile: state.hideProfile,
        vibrationEnabled: state.vibrationEnabled,
        appPin: state.appPin,
        isAppLockEnabled: state.isAppLockEnabled,
        isRoomLockEnabled: state.isRoomLockEnabled,
        biometricEnabled: state.biometricEnabled,
        lockedRooms: state.lockedRooms,
        savedRooms: state.savedRooms,
        quickMessages: state.quickMessages
      }), // Don't persist deferredPrompt, isAppUnlocked, or unlockedRooms
    }
  )
);
