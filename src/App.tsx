import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import Profile from './pages/Profile';
import CreateRoom from './pages/CreateRoom';
import JoinRoom from './pages/JoinRoom';
import Room from './pages/Room';
import Plans from './pages/Plans';
import { useStore } from './store/useStore';
import SecurityLockModal from './components/SecurityLockModal';
import { SignInOptions } from './components/AccountSheet';
import { useAuthSync } from './lib/auth';
import { fetchVipStatus, subscribeToMembership } from './lib/api';
import { Languages, Loader2 } from 'lucide-react';

/** Room pages need a Supabase session; a shared room link lands here first when signed out */
function RequireAuth({ children }: { children: React.ReactElement }) {
  const authReady = useStore((s) => s.authReady);
  const authUser = useStore((s) => s.authUser);

  if (!authReady) {
    return (
      <div className="flex-1 flex items-center justify-center text-(--theme-accent)" role="status" aria-label="Yükleniyor">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }
  if (authUser) return children;

  return (
    <div className="flex-1 overflow-y-auto flex flex-col justify-center px-6 py-10 gap-8">
      <div className="flex flex-col items-center text-center gap-4">
        <span className="w-16 h-16 rounded-full bg-(--theme-accent-light) text-(--theme-accent) flex items-center justify-center">
          <Languages className="w-8 h-8" />
        </span>
        <div className="space-y-1.5">
          <h1 className="font-display font-semibold text-3xl text-(--theme-ink)">Sohbete katıl</h1>
          <p className="text-[15px] text-(--theme-muted)">Devam etmek için giriş yap. Mesajların karşı tarafa kendi dilinde ulaşır.</p>
        </div>
      </div>
      <SignInOptions />
    </div>
  );
}

/** VIP settings (hidden profile, VIP badge) need an active paid package; the local switch follows the server */
function useMembershipSync() {
  const userId = useStore((s) => s.authUser?.id);
  const setIsPremium = useStore((s) => s.setIsPremium);
  const setHideProfile = useStore((s) => s.setHideProfile);

  React.useEffect(() => {
    if (!userId) {
      setIsPremium(false);
      return;
    }
    const sync = () => fetchVipStatus(userId).then((status) => {
      const active = !!status.vipUntil;
      setIsPremium(active);
      if (!active) setHideProfile(false);
    }).catch(() => {});
    void sync();
    const unsubscribe = subscribeToMembership(userId, () => { void sync(); });
    // A package can run out while the app stays open
    const timer = setInterval(sync, 5 * 60 * 1000);
    return () => { unsubscribe(); clearInterval(timer); };
  }, [userId, setIsPremium, setHideProfile]);
}

export default function App() {
  useAuthSync();
  useMembershipSync();
  const theme = useStore((state) => state.theme);
  const colorTheme = useStore((state) => state.colorTheme);
  const fontSize = useStore((state) => state.fontSize);
  const fontFamily = useStore((state) => state.fontFamily);
  const setDeferredPrompt = useStore((state) => state.setDeferredPrompt);

  const appPin = useStore((state) => state.appPin);
  const isAppLockEnabled = useStore((state) => state.isAppLockEnabled);
  const isAppUnlocked = useStore((state) => state.isAppUnlocked);

  React.useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  React.useEffect(() => {
    document.documentElement.setAttribute('data-color-theme', colorTheme || 'indigo');
  }, [colorTheme]);

  React.useEffect(() => {
    document.documentElement.setAttribute('data-font-size', fontSize || 'medium');
  }, [fontSize]);

  const gender = useStore((state) => state.profile.gender);
  React.useEffect(() => {
    if (gender) {
      document.documentElement.setAttribute('data-gender', gender);
    } else {
      document.documentElement.removeAttribute('data-gender');
    }
  }, [gender]);

  const fontClass = fontFamily === 'serif' ? 'font-app-serif' : fontFamily === 'mono' ? 'font-app-mono' : 'font-app-sans';

  React.useEffect(() => {
    const handleBeforeInstallPrompt = (e: any) => {
      // Prevent the mini-infobar from appearing on mobile
      e.preventDefault();
      // Stash the event so it can be triggered later.
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, [setDeferredPrompt]);

  const isAppLocked = isAppLockEnabled && !!appPin && !isAppUnlocked;

  return (
    <BrowserRouter>
      <div className={`h-[100dvh] w-full app-outer-bg text-(--theme-ink) ${fontClass} selection:bg-(--theme-accent-light) selection:text-(--theme-ink) flex justify-center overflow-hidden`}>
        <div className="w-full max-w-2xl h-full app-page-bg shadow-2xl overflow-hidden flex flex-col relative">
          <Routes>
            <Route path="/profile" element={<Profile />} />
            <Route path="/" element={<Home />} />
            <Route path="/create-room" element={<RequireAuth><CreateRoom /></RequireAuth>} />
            <Route path="/join-room" element={<RequireAuth><JoinRoom /></RequireAuth>} />
            <Route path="/room/:roomCode" element={<RequireAuth><Room /></RequireAuth>} />
            <Route path="/plans" element={<RequireAuth><Plans /></RequireAuth>} />
          </Routes>

          {/* Full-Screen App Start Lock */}
          {isAppLocked && (
            <SecurityLockModal
              isOpen={true}
              mode="unlock"
              title="LiveTranslate kilitli"
              subtitle="Açmak için 4 haneli PIN kodunu gir."
            />
          )}
        </div>
      </div>
    </BrowserRouter>
  );
}

