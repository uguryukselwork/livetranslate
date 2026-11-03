import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ShieldCheck, Check, Loader2, Crown, Users, Megaphone, Gift, ShoppingBag, X, Trash2, RefreshCw, Search, Wallet, Clock, ChevronDown, KeyRound
} from 'lucide-react';
import { cn } from '../lib/utils';
import { fieldClass, primaryButton, IconTile, softIconButton } from './ui';
import {
  adminCheckPin, adminOverview, adminSetVipAccess, adminDecideRequest, adminAddBalance, adminGrantHours, adminRoomMembers, adminGrantVip,
  adminSetAnnouncement, fetchAnnouncement,
  type AdminOverview, type AdminUser, type VipAccess, type VipRequest, type RoomMember
} from '../lib/api';
import { describePlan, PACKAGES, PERIODS, formatTalkTime } from '../lib/plans';

// Applies to every user at once
const ACCESS_OPTIONS: { id: VipAccess; title: string; description: string; icon: React.ReactNode; tone: string }[] = [
  {
    id: 'everyone',
    title: 'Ücretsiz',
    description: 'Tüm kullanıcılar VIP sesli çeviriyi bedava kullanır. Gemini ücreti sana yansır.',
    icon: <Users className="w-5 h-5" />,
    tone: 'bg-emerald-500/15 text-emerald-600',
  },
  {
    id: 'members',
    title: 'Ücretli',
    description: 'VIP sesli çeviriyi yalnızca paketi ya da konuşma hakkı olanlar kullanır. Diğerleri yalnızca sesli yazmayı (ücretsiz) kullanır.',
    icon: <Crown className="w-5 h-5" />,
    tone: 'bg-amber-500/15 text-amber-600',
  },
];

const FREE_ANNOUNCEMENT = 'VIP üyelik şimdilik herkese bedava! 🎉';

const GIFT_DURATIONS = [
  { days: 7, label: '1 hafta' },
  { days: 30, label: '1 ay' },
  { days: 365, label: '1 yıl' },
];

const USAGE_HOURS = [
  { hours: 1, label: '1 saat' },
  { hours: 2, label: '2 saat' },
  { hours: 5, label: '5 saat' },
  { hours: 24, label: '1 gün' },
];

const formatUsd = (value: number) => `$${Number(value).toFixed(2)}`;

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const sectionTitle = 'text-xs font-bold uppercase tracking-wide text-(--theme-muted) px-1';

/** Hidden admin panel (5 taps on the logo). The PIN is verified by the database on every call, never in the browser. */
export default function AdminPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [pin, setPin] = useState('');
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [giftDays, setGiftDays] = useState<Record<string, number>>({});
  const [roomCode, setRoomCode] = useState('');
  const [roomDays, setRoomDays] = useState(30);
  const [roomMembers, setRoomMembers] = useState<RoomMember[] | null>(null);
  const [userQuery, setUserQuery] = useState('');
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [customAmount, setCustomAmount] = useState('');
  const [customHours, setCustomHours] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [draft, setDraft] = useState('');

  // Forget the PIN whenever the panel closes
  useEffect(() => {
    if (open) return;
    setPin('');
    setOverview(null);
    setError(null);
    setNotice(null);
    setSelectedUser(null);
    setUserQuery('');
    setRoomCode('');
    setRoomMembers(null);
  }, [open]);

  const explain = (err: unknown) => {
    const message = err instanceof Error ? err.message : '';
    if (message === 'too_many_attempts') return 'Çok fazla yanlış deneme. 15 dakika sonra tekrar dene.';
    if (message.includes('room_not_found')) return 'Bu kodla bir oda bulunamadı.';
    if (message.includes('request_not_pending')) return 'Bu istek zaten yanıtlanmış.';
    if (message.includes('invalid_amount')) return 'Geçerli bir tutar gir (en fazla 10.000$).';
    if (message.includes('invalid_hours')) return 'Geçerli bir süre gir (1–8760 saat).';
    if (message.includes('too_long')) return 'Duyuru en fazla 280 karakter olabilir.';
    return 'Bir sorun oluştu. Bağlantını kontrol et.';
  };

  const load = async (withPin = pin) => {
    const data = await adminOverview(withPin);
    if (!data) {
      setOverview(null);
      setError('Şifre yanlış.');
      setPin('');
      return false;
    }
    setOverview(data);
    const current = await fetchAnnouncement().catch(() => announcement);
    setAnnouncement(current);
    return true;
  };

  // The box starts from what is published (filled in once the panel opens)
  useEffect(() => { setDraft(announcement); }, [announcement]);

  /** Runs an admin action, then reloads the panel */
  const run = async (key: string, action: () => Promise<boolean>, done?: string) => {
    if (busy) return;
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      if (!(await action())) {
        setError('Şifre artık geçerli değil. Paneli kapatıp yeniden aç.');
        return;
      }
      await load();
      if (done) setNotice(done);
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(null);
    }
  };

  const submitPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length !== 4 || busy) return;
    setBusy('pin');
    setError(null);
    try {
      if (await adminCheckPin(pin)) await load(pin);
      else { setError('Şifre yanlış.'); setPin(''); }
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(null);
    }
  };

  const decide = (req: VipRequest, approve: boolean) => {
    const plan = describePlan(req.plan);
    const days = approve ? (req.kind === 'purchase' && plan ? plan.days : giftDays[req.id] ?? 30) : null;
    return run(`req-${req.id}`, () => adminDecideRequest(pin, req.id, approve, days),
      approve ? `${req.user_name} artık VIP (${req.kind === 'purchase' && plan ? plan.duration : `${days} gün`}).` : 'İstek reddedildi.');
  };

  const sendDollars = (user: AdminUser, amount: number) =>
    run(`usd-${user.user_id}`, () => adminAddBalance(pin, user.user_id, amount),
      amount > 0
        ? `${user.name} hesabına ${formatUsd(amount)} gönderildi.`
        : `${user.name} hesabından ${formatUsd(-amount)} geri alındı.`);

  const sendHours = (user: AdminUser, hours: number) =>
    run(`hours-${user.user_id}`, () => adminGrantHours(pin, user.user_id, hours),
      `${user.name} kullanıcısına ${hours} saat VIP konuşma hakkı gönderildi.`);

  const findRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (roomCode.length !== 6 || busy) return;
    setBusy('room');
    setError(null);
    setNotice(null);
    setRoomMembers(null);
    try {
      const members = await adminRoomMembers(pin, roomCode);
      if (!members) setError('Şifre artık geçerli değil. Paneli kapatıp yeniden aç.');
      else setRoomMembers(members);
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(null);
    }
  };

  const giveVip = async (member: RoomMember) => {
    const label = GIFT_DURATIONS.find(d => d.days === roomDays)?.label ?? `${roomDays} gün`;
    await run(`vip-${member.user_id}`, () => adminGrantVip(pin, member.user_id, roomDays), `${member.name} artık VIP (${label}).`);
    // Show the new end date
    const members = await adminRoomMembers(pin, roomCode).catch(() => null);
    if (members) setRoomMembers(members);
  };

  const pending = overview?.requests.filter(r => r.status === 'pending') ?? [];
  const decided = overview?.requests.filter(r => r.status !== 'pending').slice(0, 8) ?? [];
  const query = userQuery.trim().toLocaleLowerCase('tr-TR');
  const users = (overview?.users ?? [])
    .filter(u => !query || u.name.toLocaleLowerCase('tr-TR').includes(query) || u.user_id.startsWith(query))
    .slice(0, 30);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 z-50 flex items-end bg-black/40 backdrop-blur-[2px]"
        >
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 260 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Yönetici paneli"
            className="w-full app-page-bg rounded-t-[2rem] border-t border-(--theme-border) px-5 pt-3 pb-8 max-h-[92%] overflow-y-auto"
          >
            <div className="mx-auto mb-5 h-1.5 w-10 rounded-full bg-(--theme-border)" aria-hidden />

            <div className="flex items-center gap-3 mb-5">
              <IconTile tone="accent"><ShieldCheck className="w-5 h-5" /></IconTile>
              <div className="flex-1">
                <h2 className="font-display font-semibold text-xl text-(--theme-ink)">Yönetici paneli</h2>
                <p className="text-[13px] text-(--theme-muted)">
                  {overview ? `${overview.vip_members} aktif VIP üye` : 'Devam etmek için şifreyi gir.'}
                </p>
              </div>
              {overview && (
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => run('refresh', async () => true)} className={softIconButton} aria-label="Yenile" title="Yenile">
                    <RefreshCw className={cn('w-5 h-5', busy === 'refresh' && 'animate-spin')} />
                  </button>
                  <button type="button" onClick={onClose} className={softIconButton} aria-label="Kapat" title="Kapat">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              )}
            </div>

            {!overview ? (
              <form onSubmit={submitPin} className="space-y-3">
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  autoFocus
                  maxLength={4}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="••••"
                  aria-label="Yönetici şifresi"
                  className={cn(fieldClass, 'text-center font-display text-2xl tracking-[0.6em]')}
                />
                {error && <p role="alert" className="text-[13px] font-bold text-red-600 text-center">{error}</p>}
                <button type="submit" disabled={pin.length !== 4 || !!busy} className={primaryButton}>
                  {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Giriş'}
                </button>
              </form>
            ) : (
              <div className="space-y-7">
                {(error || notice) && (
                  <p
                    role={error ? 'alert' : 'status'}
                    className={cn('rounded-2xl px-4 py-2.5 text-[13px] font-bold', error ? 'bg-red-500/10 text-red-600' : 'bg-emerald-500/12 text-emerald-700')}
                  >
                    {error || notice}
                  </p>
                )}

                {/* VIP access for everyone */}
                <section className="space-y-3" role="radiogroup" aria-label="VIP kullanımı">
                  <div className="flex items-center justify-between px-1">
                    <h3 className={sectionTitle}>VIP kullanımı · tüm kullanıcılar</h3>
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-bold text-(--theme-muted)">
                        {overview.vip_access === 'everyone' ? 'Herkes VIP' : 'Sadece üyeler'}
                      </span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={overview.vip_access === 'everyone'}
                        disabled={!!busy}
                        onClick={() => {
                          const next: VipAccess = overview.vip_access === 'everyone' ? 'members' : 'everyone';
                          if (next === 'everyone' && !draft.trim()) setDraft(FREE_ANNOUNCEMENT);
                          void run(`access-${next}`, () => adminSetVipAccess(pin, next), 'Kaydedildi.');
                        }}
                        className={cn(
                          'relative w-11 h-6 rounded-full shrink-0 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-wait',
                          overview.vip_access === 'everyone' ? 'bg-emerald-500' : 'bg-(--theme-border)'
                        )}
                      >
                        <span className={cn(
                          'absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform',
                          overview.vip_access === 'everyone' && 'translate-x-5'
                        )} />
                      </button>
                    </div>
                  </div>
                  
                  {ACCESS_OPTIONS.map(o => {
                    const selected = overview.vip_access === o.id;
                    return (
                      <button
                        key={o.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        disabled={!!busy}
                        onClick={() => {
                          if (selected) return;
                          if (o.id === 'everyone' && !draft.trim()) setDraft(FREE_ANNOUNCEMENT);
                          void run(`access-${o.id}`, () => adminSetVipAccess(pin, o.id), 'Kaydedildi. Tüm kullanıcılarda yeni görüşmelerden itibaren geçerli.');
                        }}
                        className={cn(
                          'w-full text-left rounded-3xl border-2 p-3.5 flex items-center gap-3 transition-colors cursor-pointer disabled:cursor-wait',
                          selected ? 'border-(--theme-accent) bg-(--theme-accent-light)' : 'border-(--theme-border) bg-(--theme-card-bg) hover:border-(--theme-accent)'
                        )}
                      >
                        <span className={cn('w-10 h-10 shrink-0 rounded-2xl flex items-center justify-center', o.tone)}>{o.icon}</span>
                        <span className="flex-1 min-w-0">
                          <span className="block font-bold text-[15px] text-(--theme-ink)">{o.title}</span>
                          <span className="block text-[12.5px] leading-snug text-(--theme-muted) mt-0.5">{o.description}</span>
                        </span>
                        <span className={cn(
                          'w-6 h-6 shrink-0 rounded-full border-2 flex items-center justify-center',
                          selected ? 'border-(--theme-accent) bg-(--theme-accent) text-(--theme-on-accent)' : 'border-(--theme-border)'
                        )}>
                          {busy === `access-${o.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : selected && <Check className="w-4 h-4" />}
                        </span>
                      </button>
                    );
                  })}
                </section>

                {/* Announcement to every user */}
                <section className="space-y-2.5">
                  <h3 className={sectionTitle}>Tüm kullanıcılara duyuru</h3>
                  <form
                    className="rounded-3xl border-2 border-(--theme-border) bg-(--theme-card-bg) p-3.5 space-y-2.5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run('announce', () => adminSetAnnouncement(pin, draft), 'Duyuru yayınlandı. Herkes ana sayfada ve planlarda görür.');
                    }}
                  >
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value.slice(0, 280))}
                      rows={2}
                      placeholder={`Örn. ${FREE_ANNOUNCEMENT}`}
                      aria-label="Duyuru metni"
                      className={cn(fieldClass, 'resize-none')}
                    />
                    <p className="text-[12px] text-(--theme-muted) px-1">
                      {announcement ? `Yayında: “${announcement}”` : 'Şu an yayında duyuru yok.'}
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={!draft.trim() || draft.trim() === announcement || !!busy}
                        className={cn(primaryButton, 'py-3 flex-1')}
                      >
                        {busy === 'announce' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Megaphone className="w-4 h-4" />}
                        Yayınla
                      </button>
                      {announcement && (
                        <button
                          type="button"
                          disabled={!!busy}
                          onClick={() => run('announce-clear', () => adminSetAnnouncement(pin, ''), 'Duyuru kaldırıldı.')}
                          className="px-4 rounded-2xl bg-(--theme-subtle-bg) text-(--theme-ink) text-[14px] font-bold flex items-center gap-1.5 hover:bg-red-500/10 hover:text-red-600 disabled:opacity-50 cursor-pointer"
                        >
                          {busy === 'announce-clear' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                          Kaldır
                        </button>
                      )}
                    </div>
                  </form>
                </section>



                {/* Users: send balance and usage time */}
                <section className="space-y-2.5">
                  <h3 className={sectionTitle}>Kullanıcılar ({overview.users.length})</h3>
                  <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-(--theme-muted)" />
                    <input
                      type="search"
                      value={userQuery}
                      onChange={(e) => setUserQuery(e.target.value)}
                      placeholder="İsim ile ara"
                      aria-label="Kullanıcı ara"
                      className={cn(fieldClass, 'pl-10 py-2.5')}
                    />
                  </div>
                  {users.length === 0 && <p className="text-[13px] text-(--theme-muted) px-1">Kullanıcı bulunamadı.</p>}
                  <ul className="space-y-2">
                    {users.map(u => {
                      const expanded = selectedUser === u.user_id;
                      const amount = Number(customAmount.replace(',', '.'));
                      const hours = Number(customHours);
                      return (
                        <li key={u.user_id} className={cn('rounded-3xl border-2 bg-(--theme-card-bg)', expanded ? 'border-(--theme-accent)' : 'border-(--theme-border)')}>
                          <button
                            type="button"
                            aria-expanded={expanded}
                            onClick={() => { setSelectedUser(expanded ? null : u.user_id); setCustomAmount(''); setCustomHours(''); }}
                            className="w-full flex items-center gap-3 px-3.5 py-3 text-left cursor-pointer"
                          >
                            <span className={cn('w-9 h-9 shrink-0 rounded-2xl flex items-center justify-center', u.vip_until ? 'bg-amber-500/15 text-amber-600' : 'bg-(--theme-subtle-bg) text-(--theme-muted)')}>
                              <Crown className="w-4 h-4" />
                            </span>
                            <span className="flex-1 min-w-0">
                              <span className="block font-bold text-[14.5px] text-(--theme-ink) truncate">
                                {u.name} <span className="font-normal text-[11.5px] text-(--theme-muted)">#{u.user_id.slice(0, 6)}</span>
                              </span>
                              <span className="block text-[12px] text-(--theme-muted)">
                                {u.vip_until ? `VIP · ${formatDate(u.vip_until)} kadar` : 'Ücretsiz'} · Bakiye {formatUsd(u.balance_usd)}
                                {u.vip_seconds > 0 && ` · Konuşma ${formatTalkTime(u.vip_seconds)}`}
                              </span>
                            </span>
                            <ChevronDown className={cn('w-4 h-4 shrink-0 text-(--theme-muted) transition-transform', expanded && 'rotate-180')} />
                          </button>

                          {expanded && (
                            <div className="px-3.5 pb-3.5 space-y-4">
                              <div className="space-y-2">
                                <div className="flex items-center gap-1.5 text-[12.5px] font-bold text-(--theme-muted)">
                                  <Wallet className="w-3.5 h-3.5" /> Bakiyeye dolar gönder
                                </div>
                                <p className="text-[12px] text-(--theme-muted) px-0.5">Paket fiyatını gönder, kullanıcı bakiyesiyle o paketi hemen alabilsin.</p>
                                <div className="space-y-1.5">
                                  {PERIODS.map(period => (
                                    <div key={period.id} className="flex items-center gap-2">
                                      <span className="w-16 shrink-0 text-[12.5px] font-bold text-(--theme-ink)">{period.label}</span>
                                      {PACKAGES.filter(pkg => pkg.id !== 'free').map(pkg => (
                                        <button
                                          key={pkg.id}
                                          type="button"
                                          disabled={!!busy}
                                          onClick={() => sendDollars(u, pkg.basePrices[period.id])}
                                          className="flex-1 px-2 py-2 rounded-2xl bg-(--theme-accent-light) text-(--theme-accent) text-[12.5px] font-bold hover:bg-(--theme-accent) hover:text-(--theme-on-accent) disabled:opacity-50 cursor-pointer"
                                        >
                                          {pkg.name} {formatUsd(pkg.basePrices[period.id])}
                                        </button>
                                      ))}
                                    </div>
                                  ))}
                                </div>
                                <form
                                  className="flex gap-2"
                                  onSubmit={(e) => {
                                    e.preventDefault();
                                    if (amount) void sendDollars(u, amount).then(() => setCustomAmount(''));
                                  }}
                                >
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={customAmount}
                                    onChange={(e) => setCustomAmount(e.target.value.replace(/[^0-9.,-]/g, '').slice(0, 9))}
                                    placeholder="Tutar ($) · geri almak için -5"
                                    aria-label="Özel tutar"
                                    className={cn(fieldClass, 'py-2.5 flex-1 min-w-0')}
                                  />
                                  <button type="submit" disabled={!amount || !!busy} className="px-4 rounded-2xl bg-(--theme-accent) text-(--theme-on-accent) text-[13.5px] font-bold disabled:opacity-50 cursor-pointer">
                                    {busy === `usd-${u.user_id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Gönder'}
                                  </button>
                                </form>
                              </div>

                              <div className="space-y-2">
                                <div className="flex items-center gap-1.5 text-[12.5px] font-bold text-(--theme-muted)">
                                  <Clock className="w-3.5 h-3.5" /> VIP konuşma hakkı gönder (konuştukça düşer)
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  {USAGE_HOURS.map(h => (
                                    <button
                                      key={h.hours}
                                      type="button"
                                      disabled={!!busy}
                                      onClick={() => sendHours(u, h.hours)}
                                      className="px-3.5 py-2 rounded-2xl bg-amber-500/15 text-amber-700 text-[13.5px] font-bold hover:bg-amber-500 hover:text-white disabled:opacity-50 cursor-pointer"
                                    >
                                      +{h.label}
                                    </button>
                                  ))}
                                </div>
                                <form
                                  className="flex gap-2"
                                  onSubmit={(e) => {
                                    e.preventDefault();
                                    if (hours) void sendHours(u, hours).then(() => setCustomHours(''));
                                  }}
                                >
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    value={customHours}
                                    onChange={(e) => setCustomHours(e.target.value.replace(/\D/g, '').slice(0, 4))}
                                    placeholder="Saat sayısı (örn. 3)"
                                    aria-label="Özel süre (saat)"
                                    className={cn(fieldClass, 'py-2.5 flex-1 min-w-0')}
                                  />
                                  <button type="submit" disabled={!hours || !!busy} className="px-4 rounded-2xl bg-amber-500 text-white text-[13.5px] font-bold disabled:opacity-50 cursor-pointer">
                                    {busy === `hours-${u.user_id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Gönder'}
                                  </button>
                                </form>
                              </div>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>


              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
