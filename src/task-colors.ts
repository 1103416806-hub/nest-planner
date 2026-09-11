import type { CSSProperties } from 'react';

export const taskColorPresets = [
  { name: '蓝色', value: '#3B82F6' },
  { name: '紫色', value: '#8B5CF6' },
  { name: '玫瑰', value: '#D85D8D' },
  { name: '珊瑚', value: '#E8795B' },
  { name: '青色', value: '#208D9C' },
  { name: '琥珀', value: '#C89435' },
] as const;

export function validTaskColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
}

type RGB = [number, number, number];
const hex = (rgb: RGB) => '#' + rgb.map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('');
const luminance = (rgb: RGB) => rgb.map(channel => {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
const contrast = (a: RGB, b: RGB) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);

// Even a very pale custom color keeps readable text and a visible color strip.
export function taskColorStyle(value: string): CSSProperties & Record<'--task-accent', string> {
  const color = validTaskColor(value) ? value : '#3B82F6';
  const base = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16)) as RGB;
  const surface = base.map(channel => Math.round(channel * 0.13 + 255 * 0.87)) as RGB;
  const ink = base.map(channel => Math.round(channel * 0.38)) as RGB;
  let accent = [...base] as RGB;
  while (contrast(accent, surface) < 3) accent = accent.map(channel => Math.floor(channel * 0.9)) as RGB;
  return { backgroundColor: hex(surface), color: hex(ink), borderColor: hex(accent), '--task-accent': hex(accent) };
}
