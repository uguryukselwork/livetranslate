import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, ChevronRight, Download, Loader2, LogOut, Settings as SettingsIcon, UserRound, X } from 'lucide-react';
import { useStore } from '../store/useStore';
import { signInWithGoogle, signInAsGuest, signOut, isGuest, isGoogleSignInEnabled } from '../lib/auth';
import { SettingsGroup, SettingsRow, primaryButton, focusRing, softIconButton } from './ui';
import InstallGuide, { isInstalledApp } from './InstallGuide';
import { cn } from '../lib/utils';

function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" className="w-5 h-5" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/** The two sign-in choices. Used in the account sheet and on the full-page sign-in screen. */
export function SignInOptions({ onSignedIn }: { onSignedIn?: () => void }) {
  const [busy, setBusy] = useState<'google' | 'guest' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Shown as "coming soon" until Google is switched on in Supabase
  const [googleReady, setGoogleReady] = useState(false);
  useEffect(() => { isGoogleSignInEnabled().then(setGoogleReady); }, []);

  const run = async (kind: 'google' | 'guest') => {
    setError(null);
    setNotice(null);
    if (kind === 'google' && !googleReady) {
      setNotice('Google ile giriş yakında geliyor. Şimdilik misafir olarak devam edebilirsin.');
      return;
    }
    setBusy(kind);
    try {
      if (kind === 'google') {
        await signInWithGoogle(); // leaves the page; we come back signed in
      } else {
        await signInAsGuest();
        onSignedIn?.();
        setBusy(null);
      }
    } catch (err: any) {
      console.error('Sign-in failed', err);
      setError(kind === 'google'
        ? 'Google ile giriş şu an yapılamıyor. Biraz sonra tekrar dene.'
        : 'Misafir girişi şu an yapılamıyor. Biraz sonra tekrar dene.');
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => run('guest')}
        disabled={!!busy}
        className={cn(
          'w-full py-4 px-6 rounded-full bg-[#078CCB] text-white font-bold text-[15px] flex items-center justify-center gap-3 hover:bg-[#067bb3] transition-all active:scale-[0.98] disabled:opacity-60 cursor-pointer shadow-sm',
          focusRing
        )}
      >
        {busy === 'guest' ? <Loader2 className="w-5 h-5 animate-spin" /> : <UserRound className="w-5 h-5" />}
        Misafir olarak devam et
      </button>

      <button
        type="button"
        onClick={() => run('google')}
        disabled={!!busy}
        aria-describedby={googleReady ? undefined : 'google-soon'}
        className={cn(
          'w-full py-4 px-6 rounded-full bg-white text-(--theme-ink) border-2 border-[#B9E6FF] font-bold text-[15px] flex items-center justify-center gap-3 hover:bg-[#f8fbff] transition-all active:scale-[0.98] disabled:opacity-60 cursor-pointer shadow-sm',
          !googleReady && 'opacity-70',
          focusRing
        )}
      >
        {busy === 'google' ? <Loader2 className="w-5 h-5 animate-spin" /> : <GoogleLogo />}
        Google ile giriş yap
        {!googleReady && (
          <span id="google-soon" className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-neutral-500 border border-neutral-200">
            YAKINDA
          </span>
        )}
      </button>

      {notice && <p role="status" className="text-sm font-bold text-center text-(--theme-ink)">{notice}</p>}
      {error && <p role="alert" className="text-sm font-bold text-center text-red-600 dark:text-red-400">{error}</p>}
      
      <p className="text-[13px] leading-snug text-center text-(--theme-muted) px-2 pt-1 opacity-80">
        Misafir hesabı sadece bu cihazda durur. Tarayıcı verilerini silersen odalarına tekrar erişemezsin.
      </p>
    </div>
  );
}

interface AccountSheetProps {
  open: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
  /** Why we're asking, e.g. "Oda kurmak için önce giriş yap." */
  reason?: string | null;
}

export default function AccountSheet({ open, onClose, onOpenSettings, reason }: AccountSheetProps) {
  const authUser = useStore((s) => s.authUser);
  const profile = useStore((s) => s.profile);
  const [signingOut, setSigningOut] = useState(false);
  const [view, setView] = useState<'main' | 'install'>('main');

  const [busy, setBusy] = useState<'google' | 'guest' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [googleReady, setGoogleReady] = useState(false);
  useEffect(() => { isGoogleSignInEnabled().then(setGoogleReady); }, []);

  const run = async (kind: 'google' | 'guest') => {
    setError(null);
    setNotice(null);
    if (kind === 'google' && !googleReady) {
      setNotice('Google ile giriş yakında geliyor. Şimdilik misafir olarak devam edebilirsin.');
      return;
    }
    setBusy(kind);
    try {
      if (kind === 'google') {
        await signInWithGoogle();
      } else {
        await signInAsGuest();
        setBusy(null);
      }
    } catch (err: any) {
      console.error('Sign-in failed', err);
      setError(kind === 'google'
        ? 'Google ile giriş şu an yapılamıyor. Biraz sonra tekrar dene.'
        : 'Misafir girişi şu an yapılamıyor. Biraz sonra tekrar dene.');
      setBusy(null);
    }
  };

  const close = () => { onClose(); setView('main'); };
  // Already running from the home screen: nothing to install
  const installRow = !isInstalledApp() && (
    <SettingsRow
      tone="blue"
      icon={<Download className="w-[18px] h-[18px]" />}
      title="Uygulamayı indir"
      description="Ana ekrana ekle, iPhone ve Android rehberi"
      onClick={() => setView('install')}
      chevron
    />
  );

  const guest = isGuest(authUser);
  const displayName = profile.name || (guest ? 'Misafir' : authUser?.user_metadata?.full_name) || 'Hesabın';

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => { if (authUser) close(); }}
          className={cn(
            "absolute inset-0 z-50 flex items-end bg-black/40",
            !authUser && "backdrop-blur-md"
          )}
        >
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={view === 'install' ? 'Uygulamayı indir' : authUser ? 'Hesabın' : 'Giriş yap'}
            className="w-full bg-[#F0F9FF] rounded-t-[2.5rem] border-t border-(--theme-border) px-5 pt-3 pb-10 max-h-[95%] overflow-y-auto shadow-2xl relative"
          >
            {/* Handle / Tutamaç */}
            <div className="absolute top-3 right-4 z-10">
              <button type="button" onClick={close} className={softIconButton} aria-label="Kapat" title="Kapat">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="mx-auto mb-6 h-1.5 w-12 rounded-full bg-[#B9E6FF]" aria-hidden />

            {view === 'install' ? (
              <div className="space-y-5">
                <div className="flex items-center gap-1 -ml-2">
                  <button type="button" onClick={() => setView('main')} className={softIconButton} aria-label="Geri">
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                  <h2 className="font-display font-semibold text-2xl text-(--theme-ink)">Uygulamayı indir</h2>
                </div>
                <InstallGuide />
              </div>
            ) : authUser ? (
              <div className="space-y-6">
                <div className="flex items-center gap-4 px-1">
                  <span className="w-16 h-16 rounded-full p-1 bg-(--theme-accent-light) shrink-0">
                    <span className="w-full h-full rounded-full overflow-hidden bg-(--theme-card-bg) text-(--theme-accent) flex items-center justify-center font-display font-semibold text-2xl">
                      {profile.avatarUrl
                        ? <img src={profile.avatarUrl} alt="" className="w-full h-full object-cover" />
                        : displayName[0].toLocaleUpperCase('tr')}
                    </span>
                  </span>
                  <div className="min-w-0">
                    <p className="font-display font-semibold text-xl text-(--theme-ink) truncate">{displayName}</p>
                    <p className="text-[13px] font-semibold text-(--theme-muted) truncate">
                      {guest ? 'Misafir hesabı, bu cihazda' : authUser.email}
                    </p>
                  </div>
                </div>

                <SettingsGroup>
                  <SettingsRow
                    tone="slate"
                    icon={<SettingsIcon className="w-[18px] h-[18px]" />}
                    title="Ayarlar"
                    description="Dil, görünüm, bildirimler, güvenlik"
                    onClick={() => { close(); onOpenSettings(); }}
                    chevron
                  />
                  {installRow}
                  <SettingsRow
                    tone="red"
                    icon={signingOut ? <Loader2 className="w-[18px] h-[18px] animate-spin" /> : <LogOut className="w-[18px] h-[18px]" />}
                    title="Çıkış yap"
                    description={guest ? 'Misafir hesabından çıkınca odalarına bu cihazdan da erişemezsin.' : undefined}
                    disabled={signingOut}
                    onClick={async () => {
                      if (guest && !confirm('Misafir hesabından çıkarsan bu hesaptaki odalara bir daha giremezsin. Çıkmak istiyor musun?')) return;
                      setSigningOut(true);
                      try { await signOut(); close(); } finally { setSigningOut(false); }
                    }}
                  />
                </SettingsGroup>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="text-center space-y-1 px-2">
                  <h2 className="font-display font-semibold text-[26px] text-[#101828]">Giriş yap</h2>
                  <p className="text-[15px] font-medium text-[#64748B]">
                    {reason || 'Oda kurmak ve sohbet etmek için giriş yap.'}
                  </p>
                </div>
                
                <div className="space-y-3 px-1">
                  <button
                    type="button"
                    onClick={() => run('guest')}
                    className="w-full py-[1.125rem] px-6 rounded-full bg-[#078CCB] text-white font-bold text-[16px] flex items-center justify-center gap-3 hover:bg-[#067bb3] transition-all active:scale-[0.98] shadow-md shadow-blue-500/20"
                  >
                    <UserRound className="w-5 h-5" />
                    Misafir olarak devam et
                  </button>

                  <button
                    type="button"
                    disabled
                    className="w-full py-[1.125rem] px-6 rounded-full bg-white text-[#101828] border-2 border-[#B9E6FF] font-bold text-[16px] flex items-center justify-center gap-3 opacity-80"
                  >
                    <GoogleLogo />
                    Google ile giriş yap
                    <span className="ml-1 rounded-full bg-[#F0F9FF] border border-[#B9E6FF] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#078CCB]">
                      YAKINDA
                    </span>
                  </button>
                </div>

                <div className="pt-2">
                  <div className="bg-white rounded-[2rem] border-2 border-[#B9E6FF] overflow-hidden divide-y divide-[#B9E6FF]/40 shadow-sm">
                    {!isInstalledApp() && (
                      <button
                        type="button"
                        onClick={() => setView('install')}
                        className="w-full flex items-center gap-3.5 px-5 py-4 hover:bg-neutral-50 transition-colors text-left"
                      >
                        <div className="w-10 h-10 rounded-2xl bg-[#F0F9FF] text-[#078CCB] flex items-center justify-center shrink-0">
                          <Download className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[15px] font-bold text-[#101828]">Uygulamayı indir</p>
                          <p className="text-[13px] text-[#64748B]">Ana ekrana ekle, iPhone ve Android rehberi</p>
                        </div>
                        <ChevronRight className="w-5 h-5 text-[#64748B] shrink-0" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
