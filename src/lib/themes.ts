export type ColorThemeId = 'blush' | 'indigo' | 'emerald' | 'sunset' | 'midnight' | 'amethyst' | 'amber';
export type ChatPatternId = 'none' | 'dots' | 'grid' | 'doodles' | 'waves';
export type BubbleColorId = 'theme' | 'indigo' | 'emerald' | 'rose' | 'amber' | 'violet' | 'cyan' | 'slate';

export interface ThemeConfig {
  id: ColorThemeId;
  name: string;
  emoji: string;
  accent: string;
  previewColors: [string, string];
  primaryButton: string;
  activeNav: string;
  bubbleClass: string;
}

export const THEMES: ThemeConfig[] = [
  {
    id: 'blush',
    name: 'Gül Kurusu',
    emoji: '🌸',
    accent: 'rose',
    previewColors: ['#c8435f', '#f6b8a0'],
    primaryButton: 'bg-(--theme-accent) hover:bg-(--theme-accent-hover) text-(--theme-on-accent)',
    activeNav: 'text-(--theme-accent)',
    bubbleClass: 'bg-(--theme-accent) text-(--theme-on-accent)',
  },
  {
    id: 'indigo',
    name: 'Klasik İndigo',
    emoji: '🌌',
    accent: 'indigo',
    previewColors: ['#6366f1', '#4f46e5'],
    primaryButton: 'bg-indigo-600 hover:bg-indigo-700 text-white',
    activeNav: 'text-indigo-600 dark:text-indigo-400',
    bubbleClass: 'bg-gradient-to-br from-indigo-600 to-indigo-700 text-white',
  },
  {
    id: 'emerald',
    name: 'Zümrüt Doğa',
    emoji: '🌿',
    accent: 'emerald',
    previewColors: ['#10b981', '#059669'],
    primaryButton: 'bg-emerald-600 hover:bg-emerald-700 text-white',
    activeNav: 'text-emerald-600 dark:text-emerald-400',
    bubbleClass: 'bg-gradient-to-br from-emerald-600 to-teal-700 text-white',
  },
  {
    id: 'sunset',
    name: 'Gün Batımı',
    emoji: '🌅',
    accent: 'rose',
    previewColors: ['#f43f5e', '#fb923c'],
    primaryButton: 'bg-gradient-to-r from-rose-500 to-orange-500 hover:from-rose-600 hover:to-orange-600 text-white',
    activeNav: 'text-rose-500 dark:text-rose-400',
    bubbleClass: 'bg-gradient-to-br from-rose-500 to-pink-600 text-white',
  },
  {
    id: 'midnight',
    name: 'Gece Okyanusu',
    emoji: '🌊',
    accent: 'cyan',
    previewColors: ['#06b6d4', '#2563eb'],
    primaryButton: 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700 text-white',
    activeNav: 'text-cyan-600 dark:text-cyan-400',
    bubbleClass: 'bg-gradient-to-br from-cyan-600 to-blue-700 text-white',
  },
  {
    id: 'amethyst',
    name: 'Ametist Moru',
    emoji: '🔮',
    accent: 'purple',
    previewColors: ['#8b5cf6', '#6d28d9'],
    primaryButton: 'bg-purple-600 hover:bg-purple-700 text-white',
    activeNav: 'text-purple-600 dark:text-purple-400',
    bubbleClass: 'bg-gradient-to-br from-violet-600 to-purple-700 text-white',
  },
  {
    id: 'amber',
    name: 'Kehribar & Bal',
    emoji: '🍯',
    accent: 'amber',
    previewColors: ['#f59e0b', '#d97706'],
    primaryButton: 'bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold',
    activeNav: 'text-amber-600 dark:text-amber-400',
    bubbleClass: 'bg-gradient-to-br from-amber-500 to-orange-600 text-white',
  },
];

export const BUBBLE_COLORS: { id: BubbleColorId; name: string; color: string; class: string }[] = [
  { id: 'theme', name: 'Tema Rengi', color: '#c8435f', class: '' },
  { id: 'indigo', name: 'İndigo', color: '#6366f1', class: 'bg-gradient-to-br from-indigo-600 to-indigo-700 text-white' },
  { id: 'emerald', name: 'Zümrüt', color: '#10b981', class: 'bg-gradient-to-br from-emerald-600 to-teal-700 text-white' },
  { id: 'rose', name: 'Mercan', color: '#f43f5e', class: 'bg-gradient-to-br from-rose-500 to-pink-600 text-white' },
  { id: 'amber', name: 'Kehribar', color: '#f59e0b', class: 'bg-gradient-to-br from-amber-500 to-orange-600 text-white' },
  { id: 'violet', name: 'Mor', color: '#8b5cf6', class: 'bg-gradient-to-br from-violet-600 to-purple-700 text-white' },
  { id: 'cyan', name: 'Camgöbeği', color: '#06b6d4', class: 'bg-gradient-to-br from-cyan-600 to-blue-600 text-white' },
  { id: 'slate', name: 'Grafit', color: '#334155', class: 'bg-gradient-to-br from-slate-700 to-slate-800 text-white' },
];

export const CHAT_PATTERNS: { id: ChatPatternId; name: string; icon: string }[] = [
  { id: 'none', name: 'Düz', icon: '◻️' },
  { id: 'dots', name: 'Puantiyeli', icon: '⁖' },
  { id: 'grid', name: 'Izgara', icon: '▦' },
  { id: 'doodles', name: 'Sohbet', icon: '💬' },
  { id: 'waves', name: 'Dalgalar', icon: '〰️' },
];

// Default look per gender: 'midnight' for male, 'indigo' for female/others
export function themeForGender(gender: 'male' | 'female' | null | undefined): ColorThemeId {
  if (gender === 'male') return 'midnight';
  return 'indigo';
}

export function getBubbleClass(bubbleColor: string, colorTheme: ColorThemeId): string {
  if (bubbleColor && bubbleColor !== 'theme') {
    const found = BUBBLE_COLORS.find(b => b.id === bubbleColor);
    if (found?.class) return found.class;
  }
  const theme = THEMES.find(t => t.id === colorTheme) || THEMES[0];
  return theme.bubbleClass;
}

export function getChatPatternStyle(pattern: ChatPatternId, isDark: boolean): React.CSSProperties {
  if (pattern === 'dots') {
    const dotColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';
    return {
      backgroundImage: `radial-gradient(circle, ${dotColor} 1.5px, transparent 1.5px)`,
      backgroundSize: '16px 16px',
    };
  }
  if (pattern === 'grid') {
    const gridColor = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)';
    return {
      backgroundImage: `linear-gradient(to right, ${gridColor} 1px, transparent 1px), linear-gradient(to bottom, ${gridColor} 1px, transparent 1px)`,
      backgroundSize: '20px 20px',
    };
  }
  if (pattern === 'doodles') {
    // Subtle chat iconography SVG pattern
    const svgColor = isDark ? '%23ffffff' : '%23000000';
    const opacity = isDark ? '0.04' : '0.04';
    const svg = `<svg width="60" height="60" viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg"><g fill="${svgColor}" fill-opacity="${opacity}" fill-rule="evenodd"><path d="M12 8a4 4 0 0 0-4 4v8a4 4 0 0 0 4 4h4l4 4v-4h4a4 4 0 0 0 4-4v-8a4 4 0 0 0-4-4h-16zm26 22a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm-14 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm18 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM8 44a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></g></svg>`;
    return {
      backgroundImage: `url("data:image/svg+xml;utf8,${svg}")`,
      backgroundSize: '60px 60px',
    };
  }
  if (pattern === 'waves') {
    const waveColor = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)';
    return {
      backgroundImage: `repeating-linear-gradient(45deg, ${waveColor}, ${waveColor} 2px, transparent 2px, transparent 12px)`,
      backgroundSize: '24px 24px',
    };
  }
  return {};
}
