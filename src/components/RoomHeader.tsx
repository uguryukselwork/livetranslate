import { ArrowLeft, Settings, Copy, CheckCircle2, Share2, Users, EyeOff, AudioLines, DoorOpen, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useStore } from '../store/useStore';
import { t } from '../lib/i18n';
import { cn } from '../lib/utils';

interface RoomHeaderProps {
  roomCode: string;
  partnerName?: string;
  partnerGender?: string;
  partnerAvatar?: string;
  partnerStatus?: string;
  participantsCount?: number;
  isConnected: boolean;
  onOpenSettings: () => void;
  onOpenParticipants?: () => void;
  /** Partner is typing right now */
  partnerTyping?: boolean;
  /** Starts live voice translation; hidden until a partner is in the room */
  onStartCall?: () => void;
  inCall?: boolean;
}

export default function RoomHeader({ roomCode, partnerName, partnerGender, partnerAvatar, partnerStatus, participantsCount = 0, isConnected, onOpenSettings, onOpenParticipants, partnerTyping, onStartCall, inCall }: RoomHeaderProps) {
  const navigate = useNavigate();
  const { profile, savedRooms, hideProfile } = useStore();
  const [copiedCode, setCopiedCode] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const roomUrl = window.location.origin + window.location.pathname;

  const copyToClipboard = async (text: string): Promise<boolean> => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // Fallback
    }
    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const success = document.execCommand('copy');
      textArea.remove();
      return success;
    } catch (err) {
      console.error('Fallback copy failed', err);
      return false;
    }
  };

  const copyCode = async () => {
    const ok = await copyToClipboard(roomCode);
    if (ok) {
      setCopiedCode(true);
      showToast(t('create.copied', profile.language));
      setTimeout(() => setCopiedCode(false), 2000);
    }
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  const inviteText = `❤️ Benimle çeviri sohbetine katıl!\nOda kodu: ${roomCode}\nBuradan katıl:\n${roomUrl}`;

  const handleWhatsAppShare = () => {
    const encoded = encodeURIComponent(inviteText);
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    if (isMobile) {
      window.location.href = `whatsapp://send?text=${encoded}`;
    } else {
      window.open(`https://api.whatsapp.com/send?text=${encoded}`, '_blank', 'noopener,noreferrer');
    }
  };

  // Find custom name for the room
  const currentRoom = savedRooms.find(r => r.code === roomCode);
  const displayName = currentRoom?.customName || partnerName;

  const statusDot = !isConnected ? 'bg-red-500' : partnerStatus === 'busy' ? 'bg-red-500' : partnerStatus === 'away' ? 'bg-amber-400' : 'bg-emerald-500';
  const statusText = !isConnected
    ? t('room.no_connection', profile.language)
    : partnerStatus === 'busy' ? 'Rahatsız Etmeyin'
    : partnerStatus === 'away' ? 'Dışarıda'
    : t('room.online', profile.language);
  const hasPartner = !!(partnerName || currentRoom?.customName);
  const iconButton = 'w-10 h-10 rounded-full flex items-center justify-center text-(--theme-muted) hover:text-(--theme-ink) hover:bg-(--theme-subtle-bg) transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--theme-accent)';

  return (
    <header className="sticky top-0 z-20 shrink-0 select-none">
      {/* Toast Notification */}
      {toastMessage && (
        <div role="status" className="absolute top-20 left-1/2 -translate-x-1/2 z-50 bg-(--theme-ink) text-(--theme-page-bg) text-xs font-bold px-4 py-2 rounded-full shadow-lg flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Main Top Navigation Bar */}
      <div className="app-header-bg border-b px-2 py-2.5 flex items-center justify-between gap-1 transition-colors relative z-20">
        {/* Left side: Odalarım button & Partner Info */}
        <div className="flex flex-1 items-center gap-1.5 min-w-0">
          {onOpenParticipants ? (
            <button onClick={onOpenParticipants} className={cn(iconButton, 'bg-(--theme-accent-light) text-(--theme-accent) hover:bg-(--theme-accent) hover:text-(--theme-on-accent)')} aria-label="Odalarım" title="Odalarım">
              <DoorOpen className="w-5 h-5" />
            </button>
          ) : (
            <button onClick={() => navigate('/')} className={iconButton} aria-label="Ana sayfa">
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}

          <div className="flex items-center gap-2.5 min-w-0">
            <div className="relative shrink-0">
              <div className="w-10 h-10 rounded-full p-0.5 bg-(--theme-accent-light)">
                <div className="w-full h-full rounded-full overflow-hidden bg-(--theme-card-bg) text-(--theme-accent) flex items-center justify-center font-display font-semibold">
                  {hasPartner && partnerAvatar ? (
                    <img src={partnerAvatar} alt="" className="w-full h-full object-cover" />
                  ) : hasPartner ? (
                    (displayName || '?')[0].toLocaleUpperCase(profile.language)
                  ) : (
                    <Users className="w-4 h-4" />
                  )}
                </div>
              </div>
              <span className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-(--theme-header-bg) ${hasPartner ? statusDot : 'bg-amber-400 animate-pulse'}`} />
            </div>
            <div className="min-w-0">
              <h2 className="font-display font-semibold text-[17px] leading-tight text-(--theme-ink) truncate">
                {hasPartner ? displayName : t('room.waiting_partner', profile.language)}
              </h2>
              <p className="text-xs font-semibold text-(--theme-muted) truncate">
                {hasPartner && partnerTyping
                  ? <span className="text-(--theme-accent)">{t('room.typing_short', profile.language)}</span>
                  : hasPartner ? statusText : t('room.connecting', profile.language)}
                {participantsCount > 0 && (
                  <span className="inline-flex items-center gap-0.5 ml-1.5 align-middle">
                    · <Users className="w-3 h-3 ml-1" aria-hidden />{participantsCount}
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Right side: Incognito, Voice Call, Share, Settings, Exit (X) */}
        <div className="flex items-center shrink-0 gap-0.5">
          {hideProfile && (
            <button
              onClick={onOpenSettings}
              className="flex items-center gap-1 px-2.5 py-1.5 mr-1 rounded-full bg-(--theme-accent-light) text-(--theme-accent) text-xs font-bold"
              title="Gizli Profil Aktif (Değiştirmek için tıkla)"
            >
              <EyeOff className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Gizli</span>
            </button>
          )}

          {onStartCall && (
            <button
              onClick={onStartCall}
              disabled={inCall}
              className={inCall
                ? 'w-10 h-10 rounded-full flex items-center justify-center bg-(--theme-accent) text-(--theme-on-accent)'
                : 'w-10 h-10 rounded-full flex items-center justify-center bg-(--theme-accent-light) text-(--theme-accent) hover:bg-(--theme-accent) hover:text-(--theme-on-accent) transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--theme-accent)'}
              aria-label={t('call.start', profile.language)}
              title={t('call.start', profile.language)}
            >
              <AudioLines className="w-5 h-5" />
            </button>
          )}

          <button
            onClick={handleWhatsAppShare}
            className={iconButton}
            aria-label={t('room.share', profile.language)}
            title={t('room.share', profile.language)}
          >
            <Share2 className="w-5 h-5" />
          </button>

          <button
            onClick={onOpenSettings}
            className={iconButton}
            aria-label={t('room.settings', profile.language)}
            title={t('room.settings', profile.language)}
          >
            <Settings className="w-5 h-5" />
          </button>

          <button
            onClick={() => navigate('/')}
            className={cn(iconButton, 'hover:bg-red-500/10 hover:text-red-600 text-(--theme-muted)')}
            aria-label="Odayı terk et"
            title="Odayı terk et"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Room code pill, pinned under the top bar */}
      <div className="flex items-center justify-center pt-2 pb-1 px-4 pointer-events-none relative z-10">
        <button
          onClick={copyCode}
          className="pointer-events-auto flex items-center gap-2 pl-3 pr-3.5 py-1.5 rounded-full bg-(--theme-card-bg) border border-(--theme-border) text-xs transition-transform active:scale-95 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--theme-accent)"
          title={t('room.copy', profile.language)}
        >
          {copiedCode ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-(--theme-accent) shrink-0" />
          ) : (
            <Copy className="w-3.5 h-3.5 text-(--theme-accent) shrink-0" />
          )}
          <span className="font-display font-semibold text-sm tracking-[0.1em] text-(--theme-ink)">{roomCode}</span>
          <span className="font-semibold text-(--theme-muted)">
            {copiedCode ? 'Kopyalandı' : 'Kodu kopyala'}
          </span>
        </button>
      </div>
    </header>
  );
}
