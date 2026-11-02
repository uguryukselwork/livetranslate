import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Heart, Link as LinkIcon, Languages, User, Camera, Sun, Moon, UserRound, Check, Crown } from 'lucide-react';
import { useStore, Gender } from '../store/useStore';
import { t } from '../lib/i18n';
import { cn, compressImage } from '../lib/utils';
import SettingsSheet from '../components/SettingsSheet';
import AccountSheet from '../components/AccountSheet';
import AdminPanel from '../components/AdminPanel';
import AnnouncementBanner from '../components/AnnouncementBanner';

/** Taps on the logo, each within this long of the previous one, that open the admin panel */
const ADMIN_TAPS = 5;
const ADMIN_TAP_GAP_MS = 1500;


const headerButton = 'w-10 h-10 rounded-full flex items-center justify-center bg-(--theme-card-bg) border border-(--theme-border) text-(--theme-muted) hover:text-(--theme-ink) transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--theme-accent)';

// "Hello" in the languages the app supports, so the greeting shows what the app does
const GREETINGS = [
  { code: 'tr', text: 'Merhaba' },
  { code: 'en', text: 'Hello' },
  { code: 'es', text: 'Hola' },
  { code: 'fr', text: 'Bonjour' },
  { code: 'de', text: 'Hallo' },
  { code: 'it', text: 'Ciao' },
  { code: 'ru', text: 'Привет' },
  { code: 'ja', text: 'こんにちは' },
  { code: 'ko', text: '안녕하세요' },
  { code: 'ar', text: 'مرحبا' },
];

function GreetingCycle({ lang, name }: { lang: string; name: string }) {
  const reduceMotion = useReducedMotion();
  const ordered = useMemo(() => {
    const own = GREETINGS.find(g => g.code === lang);
    return own ? [own, ...GREETINGS.filter(g => g !== own)] : GREETINGS;
  }, [lang]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
    if (reduceMotion) return;
    const id = setInterval(() => setIndex(i => (i + 1) % ordered.length), 2600);
    return () => clearInterval(id);
  }, [reduceMotion, ordered]);

  const greeting = ordered[index];
  const punctuation = name ? ',' : '!';

  return (
    <h1 className="font-display font-semibold text-[2.6rem] leading-[1.08] tracking-[-0.01em] text-(--theme-ink) text-center w-full">
      <span className="sr-only">{ordered[0].text}{punctuation} {name}</span>
      <span aria-hidden className="relative block h-[1.15em] overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={greeting.code}
            lang={greeting.code}
            initial={{ y: '70%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '-70%', opacity: 0 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="block"
          >
            {greeting.text}{punctuation}
          </motion.span>
        </AnimatePresence>
      </span>
      {name && <span aria-hidden className="block truncate text-(--theme-accent)">{name}</span>}
    </h1>
  );
}

export default function Home() {
  const navigate = useNavigate();
  const { profile, setProfile, theme, setTheme, savedRooms, authUser } = useStore();


  
  const [name, setName] = useState(profile.name || '');
  const [gender, setGender] = useState<Gender | null>(profile.gender);
  const [showSettings, setShowSettings] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const logoTaps = useRef({ count: 0, last: 0 });
  const handleLogoTap = () => {
    const now = Date.now();
    const taps = logoTaps.current;
    taps.count = now - taps.last < ADMIN_TAP_GAP_MS ? taps.count + 1 : 1;
    taps.last = now;
    if (taps.count >= ADMIN_TAPS) {
      taps.count = 0;
      setShowAdmin(true);
    }
  };
  const [accountReason, setAccountReason] = useState<string | null>(null);
  // Where to go once the user signs in from the "create/join" prompt
  const [pendingPath, setPendingPath] = useState<string | null>(null);

  const openAccount = (reason: string | null = null) => {
    setAccountReason(reason);
    setShowAccount(true);
  };

  // Rooms need a signed-in user; ask first, then continue where they were heading
  const goSignedIn = (path: string, reason: string) => {
    // An unsaved name is kept when the user heads into a room
    if (name.trim() && nameDirty) setProfile({ name: name.trim() });
    if (authUser) return navigate(path);
    setPendingPath(path);
    openAccount(reason);
  };

  useEffect(() => {
    if (authUser && pendingPath) {
      setShowAccount(false);
      navigate(pendingPath);
      setPendingPath(null);
    }
  }, [authUser, pendingPath, navigate]);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const compressed = await compressImage(file);
        setProfile({ avatarUrl: compressed });
      } catch (err) {
        console.error('Avatar upload failed', err);
      }
    }
  };

  const getAvatarImage = () => {
    if (!profile.avatarUrl || profile.avatarUrl.startsWith('/default-avatar.jpg')) {
      return '/default-avatar.jpg?v=3';
    }
    return profile.avatarUrl;
  };

  const [nameSaved, setNameSaved] = useState(false);
  const nameDirty = name.trim() !== (profile.name || '');
  const handleSaveName = () => {
    if (!name.trim()) return;
    setName(name.trim());
    setProfile({ name: name.trim() });
    setNameSaved(true);
    setTimeout(() => setNameSaved(false), 2000);
  };

  // Gender is optional (the label says so); a name is all we need to start
  const isProfileComplete = name.trim().length > 0;
  const recentRooms = [...savedRooms].sort((a, b) => b.lastAccessed - a.lastAccessed).slice(0, 8);

  return (
    // Sheets sit outside the scrolling area so they always cover the screen, even when the page is scrolled or the keyboard is open
    <div className="flex-1 min-h-0 flex flex-col relative">
    <div className="flex-1 flex flex-col items-center app-page-bg relative overflow-y-auto overflow-x-hidden">
      {/* Decorative background blobs matched to theme */}
      <div
        className="absolute top-[-10%] left-[-10%] w-72 h-72 rounded-full blur-3xl pointer-events-none transition-all duration-500"
        style={{ backgroundColor: 'var(--theme-blob-1)' }}
      />
      <div
        className="absolute bottom-[-10%] right-[-10%] w-72 h-72 rounded-full blur-3xl pointer-events-none transition-all duration-500"
        style={{ backgroundColor: 'var(--theme-blob-2)' }}
      />

      {/* Header */}
      <header className="w-full flex items-center justify-between px-5 pt-5 pb-2 z-20">
        <div className="flex items-center gap-2.5">
          <div
            onClick={handleLogoTap}
            className="w-10 h-10 rounded-2xl bg-(--theme-accent-light) text-(--theme-accent) flex items-center justify-center select-none [-webkit-tap-highlight-color:transparent]"
          >
            <Languages className="w-5 h-5" />
          </div>
          {/* Hidden on the narrowest phones so the header buttons fit */}
          <span className="hidden min-[380px]:inline font-display font-semibold text-xl text-(--theme-ink)">LiveTranslate</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/plans')}
            aria-label="Üyelik planları"
            title="Üyelik planları"
            className={cn(headerButton, 'text-amber-500 hover:text-amber-600')}
          >
            <Crown className="w-5 h-5" />
          </button>
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label={theme === 'dark' ? 'Gündüz modu' : 'Gece modu'}
            className={headerButton}
          >
            {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
          <button
            onClick={() => openAccount()}
            aria-label={authUser ? 'Hesabın' : 'Giriş yap'}
            className={cn(headerButton, 'overflow-hidden p-0', authUser && 'border-2 border-(--theme-accent)')}
          >
            {authUser && profile.avatarUrl ? (
              <img src={profile.avatarUrl} alt="" className="w-full h-full object-cover" />
            ) : authUser && profile.name ? (
              <span className="font-display font-semibold text-base text-(--theme-accent)">{profile.name[0].toLocaleUpperCase(profile.language)}</span>
            ) : (
              <UserRound className="w-5 h-5" />
            )}
          </button>
        </div>
      </header>

      <div className="w-full max-w-sm flex flex-col flex-1 justify-center gap-7 z-10 px-6 pt-4 pb-8">
        <AnnouncementBanner />
        {/* Avatar + self-translating greeting */}
        <div className="flex flex-col items-center gap-5">
          <div className="relative">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label={t('home.change_photo', profile.language)}
              className="block w-28 h-28 rounded-full p-1.5 bg-(--theme-accent-light) focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-(--theme-accent)"
            >
              <span className="w-full h-full rounded-full overflow-hidden bg-(--theme-card-bg) flex items-center justify-center">
                {getAvatarImage() ? (
                  <img src={getAvatarImage()!} alt="" className="w-full h-full object-cover" />
                ) : name.trim() ? (
                  <span className="font-display text-4xl font-semibold text-(--theme-accent)">
                    {name.trim()[0].toLocaleUpperCase(profile.language)}
                  </span>
                ) : (
                  <User className="w-10 h-10 text-(--theme-accent)" />
                )}
              </span>
            </button>
            <span className="absolute bottom-0.5 right-0.5 w-9 h-9 rounded-full bg-(--theme-accent) text-(--theme-on-accent) border-4 border-(--theme-page-bg) flex items-center justify-center pointer-events-none">
              <Camera className="w-4 h-4" />
            </span>
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept="image/*"
              onChange={handleAvatarUpload}
            />
          </div>

          <GreetingCycle lang={profile.language} name={name.trim()} />
          <p className="text-[15px] text-(--theme-muted) text-center -mt-2">
            {t('home.subtitle', profile.language)}
          </p>
        </div>

        {/* Profile fields */}
        <div className="space-y-3">
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              handleSaveName();
            }}
          >
            <label className="block flex-1 min-w-0">
              <span className="sr-only">{t('profile.name_label', profile.language)}</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('home.name_placeholder', profile.language)}
                maxLength={32}
                className="w-full px-5 py-3.5 rounded-full border-2 border-(--theme-border) bg-(--theme-card-bg) text-(--theme-ink) placeholder:text-(--theme-muted) text-base font-semibold text-center focus:outline-none focus:border-(--theme-accent) transition-colors"
              />
            </label>
            {((nameDirty && name.trim()) || nameSaved) && (
              <button
                type="submit"
                disabled={!nameDirty}
                className="shrink-0 h-[54px] px-5 rounded-full bg-(--theme-accent) text-(--theme-on-accent) font-bold text-[15px] flex items-center gap-1.5 hover:bg-(--theme-accent-hover) transition-colors active:scale-[0.98] disabled:opacity-70 cursor-pointer"
              >
                <Check className="w-[18px] h-[18px]" />
                {t(nameDirty ? 'common.save' : 'common.saved', profile.language)}
              </button>
            )}
          </form>

          <div className="flex items-center justify-center gap-2" role="group" aria-label={t('profile.gender_label', profile.language)}>
            {(['female', 'male'] as Gender[]).map((g) => {
              const selected = gender === g;
              return (
                <button
                  key={g}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    const next = selected ? null : g;
                    setGender(next);
                    setProfile({ gender: next });
                  }}
                  className={cn(
                    "px-4 py-2 rounded-full text-sm font-semibold border-2 transition-colors",
                    selected
                      ? "border-(--theme-accent) bg-(--theme-accent-light) text-(--theme-accent)"
                      : "border-transparent bg-(--theme-subtle-bg) text-(--theme-muted) hover:text-(--theme-ink)"
                  )}
                >
                  {t(g === 'female' ? 'profile.female' : 'profile.male', profile.language)}
                </button>
              );
            })}
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => goSignedIn('/create-room', 'Oda kurmak için önce giriş yap.')}
              disabled={!isProfileComplete}
              className="flex items-center justify-center gap-2 py-4 px-3 rounded-[1.75rem] bg-(--theme-accent) text-(--theme-on-accent) font-bold text-[15px] hover:bg-(--theme-accent-hover) transition-colors active:scale-[0.98] disabled:opacity-45 disabled:cursor-not-allowed disabled:active:scale-100"
            >
              <Heart className="w-[18px] h-[18px]" />
              {t('home.create_room', profile.language)}
            </button>
            <button
              onClick={() => goSignedIn('/join-room', 'Bir odaya katılmak için önce giriş yap.')}
              disabled={!isProfileComplete}
              className="flex items-center justify-center gap-2 py-4 px-3 rounded-[1.75rem] bg-(--theme-accent-light) text-(--theme-accent) font-bold text-[15px] transition-colors active:scale-[0.98] disabled:opacity-45 disabled:cursor-not-allowed disabled:active:scale-100"
            >
              <LinkIcon className="w-[18px] h-[18px]" />
              {t('home.join_room', profile.language)}
            </button>
          </div>
          {!isProfileComplete && (
            <p className="text-sm text-center text-(--theme-muted)">{t('home.name_hint', profile.language)}</p>
          )}
        </div>

        {/* Recent chats */}
        {recentRooms.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-bold text-(--theme-muted) px-1">{t('home.recent', profile.language)}</h2>
            <div className="flex gap-4 overflow-x-auto pb-1 -mx-1 px-1">
              {recentRooms.map((room) => {
                const label = room.customName || room.partnerName || t('room.unnamed', profile.language);
                return (
                  <button
                    key={room.code}
                    type="button"
                    disabled={!isProfileComplete}
                    onClick={() => goSignedIn(`/room/${room.code}`, 'Sohbete dönmek için giriş yap.')}
                    className="flex flex-col items-center gap-1.5 w-16 shrink-0 group disabled:opacity-45 focus-visible:outline-none"
                  >
                    <span className="w-14 h-14 rounded-full overflow-hidden bg-(--theme-accent-light) text-(--theme-accent) flex items-center justify-center font-display text-xl font-semibold ring-2 ring-transparent group-hover:ring-(--theme-accent) group-focus-visible:ring-(--theme-accent) transition-shadow">
                      {room.partnerAvatar ? (
                        <img src={room.partnerAvatar} alt="" className="w-full h-full object-cover" />
                      ) : (
                        label[0].toLocaleUpperCase(profile.language)
                      )}
                    </span>
                    <span className="w-full text-xs font-semibold text-(--theme-ink) truncate text-center">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
      </div>

      <AccountSheet
        open={showAccount}
        onClose={() => { setShowAccount(false); setPendingPath(null); }}
        onOpenSettings={() => setShowSettings(true)}
        reason={accountReason}
      />
      <SettingsSheet open={showSettings} onClose={() => setShowSettings(false)} />
      <AdminPanel open={showAdmin} onClose={() => setShowAdmin(false)} />
    </div>
  );
}
