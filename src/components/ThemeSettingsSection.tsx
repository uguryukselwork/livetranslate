import React, { useState } from 'react';
import { RotateCcw, Check } from 'lucide-react';
import { useStore } from '../store/useStore';
import { THEMES, BUBBLE_COLORS, CHAT_PATTERNS, getBubbleClass, getChatPatternStyle, themeForGender, ColorThemeId, BubbleColorId, ChatPatternId } from '../lib/themes';
import { SettingsGroup, focusRing } from './ui';
import { cn } from '../lib/utils';

export default function ThemeSettingsSection() {
  const {
    colorTheme,
    setColorTheme,
    bubbleColor,
    setBubbleColor,
    chatPattern,
    setChatPattern,
    resetThemeSettings,
    theme,
    profile,
  } = useStore();

  const [resetDone, setResetDone] = useState(false);

  const isDark = theme === 'dark';
  const isDefaultTheme = colorTheme === themeForGender(profile.gender) && bubbleColor === 'theme' && chatPattern === 'none';

  const handleReset = () => {
    resetThemeSettings();
    setResetDone(true);
    setTimeout(() => setResetDone(false), 2200);
  };

  return (
    <div className="space-y-6">
      {/* Live preview: the real bubble styles, so every pick below shows up here at once */}
      <div
        className="rounded-3xl border border-(--theme-border) app-page-bg p-4 space-y-2"
        style={getChatPatternStyle(chatPattern, isDark)}
        aria-label="Önizleme"
      >
        <div className="flex items-end gap-2 max-w-[85%]">
          <span className="w-7 h-7 rounded-full bg-(--theme-accent-light) text-(--theme-accent) flex items-center justify-center font-display font-semibold text-xs shrink-0">E</span>
          <div className="bg-(--theme-card-bg) text-(--theme-ink) border border-(--theme-border) rounded-[1.2rem] rounded-bl-md px-3.5 py-2">
            <p className="text-sm">Günaydın! Nasılsın?</p>
            <div className="mt-1.5 rounded-xl bg-(--theme-subtle-bg) px-2.5 py-1.5">
              <p className="text-[10px] font-bold text-(--theme-muted)">English</p>
              <p className="text-xs text-(--theme-muted)">Good morning! How are you?</p>
            </div>
          </div>
        </div>
        <div className="flex justify-end">
          <div className={cn('rounded-[1.2rem] rounded-br-md px-3.5 py-2 max-w-[85%]', getBubbleClass(bubbleColor, colorTheme))}>
            <p className="text-sm">Çok iyiyim, yeni temayı deniyorum</p>
            <p className="text-[10px] opacity-80 text-right mt-0.5">14:00</p>
          </div>
        </div>
      </div>

      <SettingsGroup title="Renk teması">
        <div className="grid grid-cols-3 gap-2 p-3">
          {THEMES.map((item) => {
            const isSelected = colorTheme === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={isSelected}
                onClick={() => {
                  setColorTheme(item.id as ColorThemeId);
                  document.documentElement.setAttribute('data-color-theme', item.id);
                }}
                className={cn(
                  'rounded-2xl border-2 px-2 py-3 flex flex-col items-center gap-2 transition-colors cursor-pointer',
                  isSelected ? 'border-(--theme-accent) bg-(--theme-accent-light)' : 'border-transparent bg-(--theme-subtle-bg) hover:border-(--theme-border)',
                  focusRing
                )}
              >
                <span className="flex -space-x-2" aria-hidden>
                  <span className="w-6 h-6 rounded-full border-2 border-(--theme-card-bg)" style={{ backgroundColor: item.previewColors[0] }} />
                  <span className="w-6 h-6 rounded-full border-2 border-(--theme-card-bg)" style={{ backgroundColor: item.previewColors[1] }} />
                </span>
                <span className={cn('text-xs font-bold leading-tight text-center', isSelected ? 'text-(--theme-accent)' : 'text-(--theme-ink)')}>
                  {item.name}
                </span>
              </button>
            );
          })}
        </div>
      </SettingsGroup>

      <button
        type="button"
        onClick={handleReset}
        disabled={isDefaultTheme && !resetDone}
        className={cn(
          'w-full py-3.5 rounded-[1.75rem] flex items-center justify-center gap-2 text-sm font-bold transition-colors cursor-pointer disabled:cursor-default disabled:opacity-45',
          'bg-(--theme-subtle-bg) text-(--theme-ink) hover:text-(--theme-accent)',
          focusRing
        )}
      >
        {resetDone ? <Check className="w-4 h-4" /> : <RotateCcw className="w-4 h-4" />}
        {resetDone ? 'Varsayılan görünüme dönüldü' : 'Varsayılan görünüme dön'}
      </button>
    </div>
  );
}
