import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Moon, Palette, Type, Bell, Smartphone, Crown, EyeOff, Download, Play, Camera, ChevronDown, LogOut, Captions, Check } from 'lucide-react';
import { useStore } from '../store/useStore';
import { t, LANGUAGES, plainLanguageName } from '../lib/i18n';
import { THEMES } from '../lib/themes';
import { compressImage, playNotificationSound } from '../lib/utils';
import { SettingsGroup, SettingsRow, SheetHeader, Toggle, fieldClass, focusRing, primaryButton } from './ui';
import ThemeSettingsSection from './ThemeSettingsSection';
import TypographySettingsSection from './TypographySettingsSection';
import SecuritySettingsSection from './SecuritySettingsSection';
import PremiumModal from './PremiumModal';
import { cn } from '../lib/utils';

const SOUNDS = [
  { id: 'pop', label: 'Pop' },
  { id: 'chime', label: 'Zil' },
  { id: 'bell', label: 'Çan' },
  { id: 'digital', label: 'Dijital' },
  { id: 'drop', label: 'Damla' },
  { id: 'marimba', label: 'Marimba' },
  { id: 'harp', label: 'Arp' },
  { id: 'crystal', label: 'Kristal' },
];

const FONT_SIZE_NAMES = { small: 'Küçük', medium: 'Standart', large: 'Büyük' } as const;
const FONT_FAMILY_NAMES = { sans: 'Yuvarlak', serif: 'Klasik', mono: 'Daktilo' } as const;

interface SettingsSheetProps {
  open: boolean;
  onClose: () => void;
  /** Room-only extras: partner language, original-text toggle, avatar and leave */
  room?: {
    partnerLanguageName: string;
    showOriginal: boolean;
    setShowOriginal: (v: boolean) => void;
    onLeave: () => void;
  };
}

function LanguageField({ label, value, onChange, children, hint }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block px-4 py-3.5 space-y-2">
      <span className="block text-[15px] font-bold text-(--theme-ink)">{label}</span>
      <span className="relative block">
        <select value={value} onChange={(e) => onChange(e.target.value)} className={cn(fieldClass, 'appearance-none pr-10 cursor-pointer')}>
          {children}
        </select>
        <ChevronDown className="w-5 h-5 absolute right-3 top-1/2 -translate-y-1/2 text-(--theme-muted) pointer-events-none" />
      </span>
      {hint && <span className="block text-[13px] leading-snug text-(--theme-muted)">{hint}</span>}
    </label>
  );
}

export default function SettingsSheet({ open, onClose, room }: SettingsSheetProps) {
  const {
    profile, setProfile, theme, setTheme, soundEnabled, setSoundEnabled,
    notificationSound, setNotificationSound, colorTheme, fontSize, fontFamily,
    isPremium, hideProfile, setHideProfile, vibrationEnabled, setVibrationEnabled,
    deferredPrompt, setDeferredPrompt,
    soundVolume, setSoundVolume
  } = useStore();
  const [view, setView] = useState<'main' | 'theme' | 'typography'>('main');
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lang = profile.language;

  // Language choices are drafts until "Kaydet" is pressed
  const [draftLanguage, setDraftLanguage] = useState(profile.language);
  const [draftPartnerLanguage, setDraftPartnerLanguage] = useState(profile.partnerLanguage || 'auto');
  const [languageSaved, setLanguageSaved] = useState(false);
  useEffect(() => {
    if (open) {
      setDraftLanguage(profile.language);
      setDraftPartnerLanguage(profile.partnerLanguage || 'auto');
      setLanguageSaved(false);
    }
  }, [open]);
  const languageDirty = draftLanguage !== profile.language || (!!room && draftPartnerLanguage !== (profile.partnerLanguage || 'auto'));
  const saveLanguages = () => {
    setProfile(room ? { language: draftLanguage, partnerLanguage: draftPartnerLanguage } : { language: draftLanguage });
    setLanguageSaved(true);
    setTimeout(() => setLanguageSaved(false), 2000);
  };

  const close = () => {
    onClose();
    setView('main');
  };

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') setDeferredPrompt(null);
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setProfile({ avatarUrl: await compressImage(file) });
    } catch (err) {
      console.error('Avatar upload failed', err);
    }
  };

  const title = view === 'theme' ? 'Tema ve renkler' : view === 'typography' ? 'Yazı tipi ve boyut' : t('room.settings', lang);
  const languageOptions = LANGUAGES.filter(l => l.code !== 'auto');

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 240 }}
            className="absolute inset-0 z-50 app-page-bg flex flex-col"
            role="dialog"
            aria-modal="true"
            aria-label={title}
          >
            <SheetHeader
              title={title}
              onBack={view !== 'main' ? () => setView('main') : undefined}
              backLabel={t('room.settings', lang)}
              onClose={close}
            />

            <div className="flex-1 overflow-y-auto px-4 pt-5 pb-10 space-y-6">
              {view === 'theme' && <ThemeSettingsSection />}
              {view === 'typography' && <TypographySettingsSection />}

              {view === 'main' && (
                <>
                  {room && (
                    <div className="flex items-center gap-4 px-2">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        aria-label={t('home.change_photo', lang)}
                        className={cn('relative w-16 h-16 rounded-full p-1 bg-(--theme-accent-light) shrink-0 cursor-pointer', focusRing)}
                      >
                        <span className="w-full h-full rounded-full overflow-hidden bg-(--theme-card-bg) text-(--theme-accent) flex items-center justify-center font-display font-semibold text-2xl">
                          {profile.avatarUrl
                            ? <img src={profile.avatarUrl} alt="" className="w-full h-full object-cover" />
                            : (profile.name || '?')[0].toLocaleUpperCase(lang)}
                        </span>
                        <span className="absolute -bottom-0.5 -right-0.5 w-7 h-7 rounded-full bg-(--theme-accent) text-(--theme-on-accent) border-[3px] border-(--theme-page-bg) flex items-center justify-center">
                          <Camera className="w-3.5 h-3.5" />
                        </span>
                      </button>
                      <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleAvatarUpload} />
                      <div className="min-w-0">
                        <p className="font-display font-semibold text-xl text-(--theme-ink) truncate">{profile.name}</p>
                        <p className="text-[13px] font-semibold text-(--theme-muted)">
                          {hideProfile ? 'Gizli profil açık: diğerleri seni "Gizli Kullanıcı" olarak görüyor' : t('home.change_photo', lang)}
                        </p>
                      </div>
                    </div>
                  )}

                  <SettingsGroup title="Dil">
                    <LanguageField label={t('room.my_language', lang)} value={draftLanguage} onChange={setDraftLanguage}>
                      {languageOptions.map(l => <option key={l.code} value={l.code}>{plainLanguageName(l.name)}</option>)}
                    </LanguageField>
                    {room && (
                      <LanguageField
                        label={t('room.partner_language', lang)}
                        value={draftPartnerLanguage}
                        onChange={setDraftPartnerLanguage}
                        hint={t('room.auto_desc', lang, { lang: room.partnerLanguageName })}
                      >
                        <option value="auto">{t('room.auto_detect', lang)}</option>
                        {languageOptions.map(l => <option key={`p-${l.code}`} value={l.code}>{plainLanguageName(l.name)}</option>)}
                      </LanguageField>
                    )}
                    {(languageDirty || languageSaved) && (
                      <div className="px-4 pb-4 pt-1">
                        <button type="button" onClick={saveLanguages} disabled={!languageDirty} className={primaryButton}>
                          <Check className="w-[18px] h-[18px]" />
                          {t(languageDirty ? 'common.save' : 'common.saved', lang)}
                        </button>
                      </div>
                    )}
                  </SettingsGroup>

                  <SettingsGroup title={t('room.appearance', lang)}>
                    <SettingsRow
                      tone="indigo"
                      icon={<Moon className="w-[18px] h-[18px]" />}
                      title="Gece modu"
                      trailing={<Toggle label="Gece modu" checked={theme === 'dark'} onChange={(v) => setTheme(v ? 'dark' : 'light')} />}
                    />
                    <SettingsRow
                      tone="rainbow"
                      icon={<Palette className="w-[18px] h-[18px]" />}
                      title="Tema ve renkler"
                      description={THEMES.find(x => x.id === colorTheme)?.name}
                      onClick={() => setView('theme')}
                      chevron
                    />
                    <SettingsRow
                      tone="sky"
                      icon={<Type className="w-[18px] h-[18px]" />}
                      title="Yazı tipi ve boyut"
                      description={`${FONT_FAMILY_NAMES[fontFamily]}, ${FONT_SIZE_NAMES[fontSize].toLocaleLowerCase('tr')}`}
                      onClick={() => setView('typography')}
                      chevron
                    />
                    {room && (
                      <SettingsRow
                        tone="teal"
                        icon={<Captions className="w-[18px] h-[18px]" />}
                        title={t('room.show_original', lang)}
                        description="Gelen mesajın çevirisinin altında orijinal hali de görünür."
                        trailing={<Toggle label={t('room.show_original', lang)} checked={room.showOriginal} onChange={room.setShowOriginal} />}
                      />
                    )}
                  </SettingsGroup>

                  <SettingsGroup title="Bildirimler">
                    <SettingsRow
                      tone="orange"
                      icon={<Bell className="w-[18px] h-[18px]" />}
                      title="Bildirim sesi"
                      trailing={<Toggle label="Bildirim sesi" checked={soundEnabled} onChange={setSoundEnabled} />}
                    />
                    <div className="px-4 py-3.5 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[15px] font-bold text-(--theme-ink)">Melodi</span>
                        <button
                          type="button"
                          onClick={() => playNotificationSound(notificationSound, soundVolume)}
                          className={cn('flex items-center gap-1.5 px-3 py-1.5 -my-1 rounded-full text-[13px] font-bold text-(--theme-accent) hover:bg-(--theme-accent-light) transition-colors cursor-pointer', focusRing)}
                        >
                          <Play className="w-3 h-3 fill-current" /> Dinle
                        </button>
                      </div>
                      <div className="space-y-2">
                        <div role="radiogroup" aria-label="Melodi" className="grid grid-cols-4 gap-1 p-1 rounded-3xl bg-(--theme-subtle-bg)">
                          {SOUNDS.map((sound) => {
                            const selected = notificationSound === sound.id;
                            return (
                              <button
                                key={sound.id}
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                onClick={() => {
                                  setNotificationSound(sound.id);
                                  playNotificationSound(sound.id, soundVolume);
                                }}
                                className={cn(
                                  'min-w-0 py-2 px-1 rounded-full text-[13px] font-bold transition-colors cursor-pointer truncate',
                                  selected ? 'bg-(--theme-card-bg) text-(--theme-accent) shadow-sm' : 'text-(--theme-muted) hover:text-(--theme-ink)',
                                  focusRing
                                )}
                              >
                                {sound.label}
                              </button>
                            );
                          })}
                        </div>
                        <label className="flex items-center gap-3 pt-1">
                          <span className="text-[13px] font-bold text-(--theme-ink) shrink-0">Ses seviyesi</span>
                          <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={soundVolume}
                            onChange={(e) => setSoundVolume(parseFloat(e.target.value))}
                            // Preview once the slider is released, not on every step
                            onPointerUp={() => playNotificationSound(notificationSound, soundVolume)}
                            onKeyUp={() => playNotificationSound(notificationSound, soundVolume)}
                            className="flex-1 accent-(--theme-accent) cursor-pointer"
                          />
                          <span className="w-9 text-right text-[13px] font-bold text-(--theme-muted) tabular-nums">{Math.round(soundVolume * 100)}%</span>
                        </label>
                      </div>
                    </div>
                    <SettingsRow
                      tone="emerald"
                      icon={<Smartphone className="w-[18px] h-[18px]" />}
                      title="Titreşim"
                      description="Yeni mesaj gelince telefon titrer."
                      trailing={<Toggle label="Titreşim" checked={vibrationEnabled} onChange={setVibrationEnabled} />}
                    />
                  </SettingsGroup>

                  <SettingsGroup title="Gizlilik">
                    <SettingsRow
                      tone="amber"
                      icon={<Crown className="w-[18px] h-[18px]" />}
                      title={isPremium ? 'VIP üyelik açık' : 'LiveTranslate VIP'}
                      description={isPremium ? 'Tüm ayrıcalıklar kullanımda.' : 'Gizli profil ve diğer ayrıcalıklar.'}
                      onClick={() => setShowPremiumModal(true)}
                      trailing={
                        <span className={cn(
                          'px-3 py-1.5 rounded-full text-[13px] font-bold shrink-0',
                          isPremium ? 'text-(--theme-muted)' : 'bg-(--theme-accent) text-(--theme-on-accent)'
                        )}>
                          {isPremium ? 'Yönet' : 'Yükselt'}
                        </span>
                      }
                    />
                    <SettingsRow
                      tone="slate"
                      icon={<EyeOff className="w-[18px] h-[18px]" />}
                      title="Profili gizle"
                      description={isPremium
                        ? 'Odalarda adın "Gizli Kullanıcı" olarak görünür, fotoğrafın gizlenir.'
                        : 'VIP ile açılır. Odalarda adın ve fotoğrafın gizlenir.'}
                      trailing={
                        <Toggle
                          label="Profili gizle"
                          checked={hideProfile}
                          onChange={(v) => isPremium ? setHideProfile(v) : setShowPremiumModal(true)}
                        />
                      }
                    />
                  </SettingsGroup>

                  {deferredPrompt && (
                    <SettingsGroup>
                      <SettingsRow
                        tone="blue"
                        icon={<Download className="w-[18px] h-[18px]" />}
                        title="Ana ekrana ekle"
                        description="LiveTranslate'i uygulama gibi aç."
                        onClick={handleInstallClick}
                        chevron
                      />
                    </SettingsGroup>
                  )}

                  {room && (
                    <button
                      type="button"
                      onClick={room.onLeave}
                      className={cn('w-full py-4 rounded-[1.75rem] bg-red-500/10 text-red-600 dark:text-red-400 font-bold text-[15px] flex items-center justify-center gap-2 hover:bg-red-500/15 transition-colors cursor-pointer', focusRing)}
                    >
                      <LogOut className="w-[18px] h-[18px]" />
                      {t('room.leave', lang)}
                    </button>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <PremiumModal
        isOpen={showPremiumModal}
        onClose={() => setShowPremiumModal(false)}
        onSuccess={() => setHideProfile(true)}
        featureTitle="Profili gizle"
      />
    </>
  );
}
