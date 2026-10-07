import { useEffect } from 'react';
import type { User } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import { useStore, DEFAULT_AVATAR } from '../store/useStore';

/** Mock Google sign-in for AI Studio environment */
export async function signInWithGoogle() {
  const guestUser = {
    id: uuidv4(),
    email: 'google-user@example.com',
    user_metadata: {
      full_name: 'Google User',
      avatar_url: DEFAULT_AVATAR
    },
    is_anonymous: false
  } as any as User;
  
  localStorage.setItem('lt_auth_user', JSON.stringify(guestUser));
  window.location.reload();
}

/** Google is simulated in this environment */
export async function isGoogleSignInEnabled(): Promise<boolean> {
  return true;
}

/** Guest sign-in: local UUID tied to this browser */
export async function signInAsGuest() {
  const guestUser = {
    id: uuidv4(),
    email: '',
    user_metadata: {},
    is_anonymous: true
  } as any as User;
  
  localStorage.setItem('lt_auth_user', JSON.stringify(guestUser));
  // Small delay to simulate network then reload to trigger state sync
  await new Promise(r => setTimeout(r, 500));
  window.location.reload();
}

export async function signOut() {
  localStorage.removeItem('lt_auth_user');
  window.location.reload();
}

export const isGuest = (user: User | null) => !!user?.is_anonymous;

/** Keeps the store in sync with the local session. */
export function useAuthSync() {
  const setAuthUser = useStore((s) => s.setAuthUser);
  const setProfile = useStore((s) => s.setProfile);

  useEffect(() => {
    const apply = (user: User | null) => {
      setAuthUser(user);
      if (!user) return;

      const { profile } = useStore.getState();
      const meta = user.user_metadata ?? {};
      setProfile({
        id: user.id,
        name: profile.name || meta.full_name || meta.name || (user.is_anonymous ? 'Misafir' : ''),
        avatarUrl: (profile.avatarUrl !== DEFAULT_AVATAR && profile.avatarUrl) || meta.avatar_url || meta.picture || DEFAULT_AVATAR,
      });
    };

    const stored = localStorage.getItem('lt_auth_user');
    if (stored) {
      try {
        apply(JSON.parse(stored));
      } catch (e) {
        apply(null);
      }
    } else {
      apply(null);
    }
  }, [setAuthUser, setProfile]);
}
