export interface StageColor {
  hex: string;
  bgGradient: string;
  badgeBg: string;
  badgeText: string;
}

export const EXACT_STAGE_COLORS: Record<string, string> = {
  'G01': '#916e98',   // أول ابتدائي
  'G1': '#916e98',
  'G02': '#b52216',   // ثاني ابتدائي
  'G2': '#b52216',
  'G03': '#9d7733',   // ثالث ابتدائي
  'G3': '#9d7733',
  'G04': '#86972e',   // رابع ابتدائي
  'G4': '#86972e',
  'G05': '#64968a',   // خامس ابتدائي
  'G5': '#64968a',
  'G06': '#9d9678',   // سادس ابتدائي
  'G6': '#9d9678',
  'G07': '#579604',   // أول متوسط
  'G7': '#579604',
  'G08': '#3e6190',   // ثاني متوسط
  'G8': '#3e6190',
  'G09': '#8e2b49',   // ثالث متوسط
  'G9': '#8e2b49',
  'G11': '#57335d',   // أول ثانوي
  'G12': '#732b4c',   // ثاني ثانوي
  'G13': '#377771',   // ثالث ثانوي
};

export const getStageColor = (stageCodeRaw: string): StageColor => {
  if (!stageCodeRaw) {
    return {
      hex: '#6366f1',
      bgGradient: 'linear-gradient(135deg, #6366f1, #4f46e5)',
      badgeBg: 'bg-indigo-50',
      badgeText: 'text-indigo-600',
    };
  }

  const code = stageCodeRaw.trim().toUpperCase();
  // Strip IG / G leading zeros to match keys (e.g. IG07 -> IG7 -> G7)
  let normalized = code
    .replace(/^IG0*(\d+)/, 'G$1') // Treat IG10 and G10 with the same core color scheme for consistency
    .replace(/^G0*(\d+)/, 'G$1');

  // fallback to orange
  const hex = EXACT_STAGE_COLORS[normalized] || EXACT_STAGE_COLORS[code] || '#f97316';

  return {
    hex,
    bgGradient: `linear-gradient(135deg, ${hex}dd, ${hex})`,
    badgeBg: `rgba(${hexToRgb(hex)}, 0.1)`,
    badgeText: hex,
  };
};

// Helper to convert hex to rgb for rgba backgrounds
function hexToRgb(hex: string): string {
  const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
  const parsedHex = hex.replace(shorthandRegex, (_, r, g, b) => r + r + g + g + b + b);
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(parsedHex);
  return result
    ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`
    : '99, 102, 241';
}
