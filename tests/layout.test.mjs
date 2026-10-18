import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, calculateLayout } from '../layout.js';

test('closing either or both sidebars preserves all column geometry', () => {
    for (const width of [320, 768, 1024, 1200, 2400]) {
        for (const [left, right] of [[80, 80], [260, 300], [600, 600]]) {
            const base = normalize({ left, right });
            const expected = calculateLayout(width, base);
            for (const showLeft of [true, false]) for (const showRight of [true, false]) {
                assert.deepEqual(calculateLayout(width, { ...base, showLeft, showRight }), expected);
            }
            assert.equal(expected.left + expected.center + expected.right, width);
            assert.ok(expected.center >= Math.min(width, 320));
        }
    }
});

test('1.0 compact preferences migrate to PC mode with top status-bar spacing', () => {
    const settings = normalize({ enabled: true, mode: 'fit', left: 220, right: 340, showRight: false });
    assert.equal(settings.mode, 'desktop');
    assert.equal(settings.topInset, 32);
    assert.equal(settings.enabled, true);
    assert.equal(settings.left, 220);
    assert.equal(settings.right, 340);
    assert.equal(settings.showRight, false);
});

test('top gap handles zero, oversized and corrupt saved values', () => {
    assert.equal(normalize({ topInset: 0 }).topInset, 0);
    assert.equal(normalize({ topInset: -12 }).topInset, 0);
    assert.equal(normalize({ topInset: 900 }).topInset, 120);
    assert.equal(normalize({ topInset: 'broken' }).topInset, 32);
    assert.deepEqual(normalize(null), normalize());
});
