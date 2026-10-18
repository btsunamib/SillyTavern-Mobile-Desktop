// Pure layout math; no dependency on SillyTavern internals.
export const DEFAULTS = Object.freeze({
    enabled: false,
    mode: 'desktop',
    canvas: 1200,
    left: 260,
    right: 300,
    showLeft: true,
    showRight: true,
});

export function clamp(value, min, max, fallback = min) {
    const n = Number(value);
    return Math.max(min, Math.min(max, Number.isFinite(n) ? n : fallback));
}

export function normalize(input = {}) {
    if (!input || typeof input !== 'object') input = {};
    return {
        enabled: input.enabled === true,
        mode: input.mode === 'fit' ? 'fit' : 'desktop',
        canvas: Math.round(clamp(input.canvas, 1024, 2400, DEFAULTS.canvas)),
        left: Math.round(clamp(input.left, 80, 600, DEFAULTS.left)),
        right: Math.round(clamp(input.right, 80, 600, DEFAULTS.right)),
        showLeft: input.showLeft !== false,
        showRight: input.showRight !== false,
    };
}

export function calculateLayout(width, settings) {
    const w = Math.max(1, Number(width) || 1);
    let left = settings.showLeft ? settings.left : 0;
    let right = settings.showRight ? settings.right : 0;
    const minimumChat = Math.min(w, settings.mode === 'desktop' ? 320 : 180);
    const budget = Math.max(0, w - minimumChat);
    if (left + right > budget) {
        const ratio = budget / (left + right);
        left *= ratio;
        right *= ratio;
    }
    left = Math.floor(left);
    right = Math.floor(right);
    return { left, right, center: w - left - right, width: w };
}
