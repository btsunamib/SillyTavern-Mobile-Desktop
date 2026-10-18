// Pure layout math; no dependency on SillyTavern internals.
export const DEFAULTS = Object.freeze({
    enabled: false,
    mode: 'desktop',
    canvas: 1200,
    scaleDesktop: false,
    left: 260,
    right: 300,
    topInset: 32,
    showLeft: true,
    showRight: true,
    showFloating: true,
});

export function clamp(value, min, max, fallback = min) {
    const n = Number(value);
    return Math.max(min, Math.min(max, Number.isFinite(n) ? n : fallback));
}

export function normalize(input = {}) {
    if (!input || typeof input !== 'object') input = {};
    return {
        enabled: input.enabled === true,
        // Migrate 1.0's compact mode to the native desktop layout as well.
        mode: 'desktop',
        canvas: Math.round(clamp(input.canvas, 1024, 2400, DEFAULTS.canvas)),
        // Older releases forced scaling; migrate them to native device size.
        scaleDesktop: input.scaleDesktop === true,
        left: Math.round(clamp(input.left, 80, 600, DEFAULTS.left)),
        right: Math.round(clamp(input.right, 80, 600, DEFAULTS.right)),
        topInset: Math.round(clamp(input.topInset, 0, 120, DEFAULTS.topInset)),
        showLeft: input.showLeft !== false,
        showRight: input.showRight !== false,
        showFloating: input.showFloating !== false,
    };
}

export function calculateLayout(width, settings) {
    const w = Math.max(1, Number(width) || 1);
    // Visibility never affects column geometry: a closed side stays empty.
    let left = settings.left;
    let right = settings.right;
    const minimumChat = Math.min(w, 320);
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
