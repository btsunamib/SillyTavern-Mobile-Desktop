import { DEFAULTS, normalize, calculateLayout, clamp } from './layout.js';

const KEY = 'mobile_desktop_layout_v1';
const IDS = ['left-nav-panel', 'right-nav-panel'];
let context;
let settings;
let root;
let modal;
let settingsOpener;
let active = false;
let viewport;
let viewportCreated = false;
let originalViewport;
let mobileStyles = [];
let snapshots = [];
let frame;
let abort;
let observers = [];
let dragging = false;
let lastLayout;

const byId = id => document.getElementById(id);
const listen = (target, event, handler, options = {}) => target?.addEventListener(event, handler, { ...options, signal: abort.signal });

function persist() {
    // The settings belong to this extension; never change core layout/pin settings.
    context.extensionSettings[KEY] = { ...settings };
    context.saveSettingsDebounced();
}

function snapshotClasses(element, names) {
    return element ? { element, names: names.map(name => [name, element.classList.contains(name)]) } : null;
}

function setClass(element, name, value) {
    if (element && element.classList.contains(name) !== value) element.classList.toggle(name, value);
}

function syncDrawers() {
    if (!active) return;
    IDS.forEach((id, index) => {
        const panel = byId(id);
        const show = index === 0 ? settings.showLeft : settings.showRight;
        setClass(panel, 'openDrawer', show);
        setClass(panel, 'closedDrawer', !show);
        // Prevent ST's click-outside handler from closing the two columns.
        setClass(panel, 'pinnedOpen', true);
        const icon = byId(index === 0 ? 'leftNavDrawerIcon' : 'rightNavDrawerIcon');
        setClass(icon, 'openIcon', show);
        setClass(icon, 'closedIcon', !show);
        setClass(icon, 'drawerPinnedOpen', true);
    });
}

function setViewport() {
    if (!active || !viewport) return;
    // Native desktop styles do not require shrinking the page: the core mobile
    // stylesheet is suspended separately. Only scale if explicitly requested.
    let content = 'width=device-width, initial-scale=1, user-scalable=yes, viewport-fit=cover, interactive-widget=resizes-content';
    if (settings.scaleDesktop) {
        const physicalWidth = Math.max(1, window.screen.width || window.outerWidth || 390);
        const scale = Math.min(1, physicalWidth / settings.canvas);
        content = `width=${settings.canvas}, initial-scale=${scale.toFixed(5)}, user-scalable=yes, viewport-fit=cover, interactive-widget=resizes-content`;
    }
    if (viewport.content !== content) viewport.content = content;
}

function beginLayout() {
    snapshots = [];
    IDS.forEach((id, index) => {
        snapshots.push(snapshotClasses(byId(id), ['openDrawer', 'closedDrawer', 'pinnedOpen']));
        snapshots.push(snapshotClasses(byId(index === 0 ? 'leftNavDrawerIcon' : 'rightNavDrawerIcon'), ['openIcon', 'closedIcon', 'drawerPinnedOpen']));
    });
    viewport = document.querySelector('meta[name="viewport"]');
    viewportCreated = !viewport;
    originalViewport = viewport?.getAttribute('content');
    if (!viewport) {
        viewport = document.createElement('meta');
        viewport.name = 'viewport';
        document.head.append(viewport);
    }
    active = true;
    // iOS rules in mobile-styles.css also run outside its mobile media query.
    // Temporarily suspend only this core sheet so native desktop styling wins.
    mobileStyles = [...document.querySelectorAll('link[rel="stylesheet"][href]')]
        .filter(link => /\/css\/mobile-styles\.css$/.test(new URL(link.href).pathname))
        .map(link => ({ link, disabled: link.disabled }));
    mobileStyles.forEach(({ link }) => { link.disabled = true; });
    document.body.classList.add('mdl-active');
    setViewport();
    IDS.forEach(id => {
        const element = byId(id);
        if (!element) return;
        const observer = new MutationObserver(syncDrawers);
        observer.observe(element, { attributes: true, attributeFilter: ['class'] });
        observers.push(observer);
    });
    syncDrawers();
}

function endLayout() {
    active = false;
    dragging = false;
    document.body.classList.remove('mdl-dragging');
    observers.forEach(observer => observer.disconnect());
    observers = [];
    document.body.classList.remove('mdl-active');
    delete document.body.dataset.mdlLeft;
    delete document.body.dataset.mdlRight;
    ['left', 'right', 'center', 'top-padding'].forEach(key => document.body.style.removeProperty(`--mdl-${key}`));
    mobileStyles.forEach(({ link, disabled }) => { link.disabled = disabled; });
    mobileStyles = [];
    snapshots.filter(Boolean).forEach(({ element, names }) => names.forEach(([name, present]) => element.classList.toggle(name, present)));
    snapshots = [];
    if (viewportCreated) viewport?.remove();
    else if (viewport) {
        if (originalViewport === null) viewport.removeAttribute('content');
        else viewport.setAttribute('content', originalViewport);
    }
    viewport = null;
    byId('mdl-left-divider')?.setAttribute('hidden', '');
    byId('mdl-right-divider')?.setAttribute('hidden', '');
}

function positionControls() {
    if (!root) return;
    root.style.setProperty('--mdl-screen-top', `${settings?.topInset ?? 32}px`);
    const vv = window.visualViewport;
    const scale = vv?.scale || 1;
    const x = vv?.offsetLeft || 0;
    const y = vv?.offsetTop || 0;
    const width = (vv?.width || window.innerWidth) * scale;
    const height = (vv?.height || window.innerHeight) * scale;
    root.style.width = `${width}px`;
    root.style.height = `${height}px`;
    root.style.transform = scale === 1 && x === 0 && y === 0 ? 'none' : `translate(${x}px, ${y}px) scale(${1 / scale})`;
}

function updateLayout() {
    frame = null;
    positionControls();
    if (!active) return;
    const width = document.documentElement.clientWidth;
    lastLayout = calculateLayout(width, settings);
    // A desktop canvas shrinks visually on mobile. Reserve the requested space
    // at the initial fit scale, without changing the gap during pinch zoom.
    const baseScale = settings.scaleDesktop ? Math.min(1, (window.screen.width || width) / width) : 1;
    document.body.style.setProperty('--mdl-top-padding', `${settings.topInset / baseScale}px`);
    Object.entries(lastLayout).forEach(([key, value]) => {
        if (key !== 'width') document.body.style.setProperty(`--mdl-${key}`, `${value}px`);
    });
    document.body.dataset.mdlLeft = settings.showLeft ? '1' : '0';
    document.body.dataset.mdlRight = settings.showRight ? '1' : '0';
    IDS.forEach((_, index) => {
        const side = index === 0 ? 'left' : 'right';
        const handle = byId(`mdl-${side}-divider`);
        const show = index === 0 ? settings.showLeft : settings.showRight;
        handle.hidden = !show;
        handle.style.left = `${index === 0 ? lastLayout.left : width - lastLayout.right}px`;
        const scale = window.visualViewport?.scale || 1;
        const hitWidth = Math.max(14, 18 / scale);
        handle.style.width = `${hitWidth}px`;
        handle.style.marginLeft = `${-hitWidth / 2}px`;
        handle.style.setProperty('--mdl-grip', String(1 / scale));
        handle.setAttribute('aria-valuenow', String(lastLayout[side]));
    });
    const info = byId('mdl-effective');
    if (info) info.textContent = `固定宽度：左 ${lastLayout.left} / 聊天 ${Math.round(lastLayout.center)} / 右 ${lastLayout.right} px。收起侧栏后保留空白，聊天区位置与宽度不变。`;
}

function schedule() {
    if (!frame) frame = requestAnimationFrame(updateLayout);
}

function renderFields() {
    if (!root) return;
    for (const [key, value] of Object.entries(settings)) {
        root.querySelectorAll(`[data-mdl-key="${key}"]`).forEach(input => {
            if (input.type === 'checkbox') input.checked = value;
            else input.value = value;
        });
    }
    byId('mdl-desktop-options').hidden = !settings.scaleDesktop;
    byId('mdl-toolbar').hidden = !settings.showFloating;
    root.querySelectorAll('[data-mdl-side]').forEach(button => {
        const side = button.dataset.mdlSide;
        button.hidden = !settings.enabled;
        button.setAttribute('aria-pressed', String(side === 'left' ? settings.showLeft : settings.showRight));
    });
    byId('mdl-status').textContent = settings.enabled ? '已启用 · 自动保存' : '未启用 · 原生布局';
    byId('mdl-effective').hidden = !settings.enabled;
}

function apply({ save = true, viewportChanged = false } = {}) {
    settings = normalize(settings);
    if (settings.enabled && !active) beginLayout();
    else if (!settings.enabled && active) endLayout();
    else if (viewportChanged) setViewport();
    if (active) syncDrawers();
    renderFields();
    schedule();
    if (save) persist();
}

function toggleSide(side) {
    const key = side === 'left' ? 'showLeft' : 'showRight';
    settings[key] = !settings[key];
    apply();
}

function openSettings() {
    settingsOpener = document.activeElement;
    modal.hidden = false;
    renderFields();
    positionControls();
    byId('mdl-close').focus({ preventScroll: true });
}

function closeSettings() {
    modal.hidden = true;
    const target = [settingsOpener, byId('mdl-launcher'), byId('mdl-settings-entry')?.querySelector('button')]
        .find(element => element?.isConnected && element.getClientRects().length);
    target?.focus({ preventScroll: true });
}

function createControls() {
    root = document.createElement('div');
    root.id = 'mdl-root';
    root.innerHTML = `
      <div id="mdl-toolbar" aria-label="桌面布局快捷操作">
        <button type="button" data-mdl-side="left" aria-label="显示或隐藏左栏">左</button>
        <button type="button" id="mdl-launcher" aria-label="打开手机桌面布局设置">布局</button>
        <button type="button" data-mdl-side="right" aria-label="显示或隐藏右栏">右</button>
        <button type="button" id="mdl-hide-floating" aria-label="隐藏悬浮按钮" title="隐藏悬浮按钮；可在扩展设置中重新开启">×</button>
      </div>
      <div id="mdl-modal" hidden>
        <section id="mdl-dialog" role="dialog" aria-modal="true" aria-labelledby="mdl-title" tabindex="-1">
          <header><div><strong id="mdl-title">手机桌面布局</strong><small id="mdl-status"></small></div><button type="button" id="mdl-close" aria-label="关闭设置">×</button></header>
          <label class="mdl-check"><input type="checkbox" data-mdl-key="enabled">启用桌面布局</label>
          <label class="mdl-check"><input type="checkbox" data-mdl-key="showFloating">显示悬浮按钮</label>
          <p>关闭后仍可在“扩展设置 → 手机桌面布局 → 打开布局设置”中重新开启。</p>
          <p>使用酒馆原生 PC 样式。中间聊天区固定，两侧收起后原位置留白。</p>
          <p>默认按设备原始大小显示，不缩放整个页面。左右宽度按当前屏幕分配。</p>
          <label class="mdl-check"><input type="checkbox" data-mdl-key="scaleDesktop">缩小显示完整桌面（可选，文字会变小）</label>
          <div id="mdl-desktop-options" hidden><label class="mdl-field">桌面画布宽度（px）<input type="number" min="1024" max="2400" step="16" data-mdl-key="canvas"></label><p>仅手动开启此选项时缩放整个页面。取消勾选即可恢复原始显示大小。</p></div>
          <div class="mdl-width"><label for="mdl-left-range">左侧宽度（px）</label><input type="number" min="80" max="600" data-mdl-key="left" aria-label="左侧宽度"><input id="mdl-left-range" type="range" min="80" max="600" step="1" data-mdl-key="left"></div>
          <div class="mdl-width"><label for="mdl-right-range">右侧宽度（px）</label><input type="number" min="80" max="600" data-mdl-key="right" aria-label="右侧宽度"><input id="mdl-right-range" type="range" min="80" max="600" step="1" data-mdl-key="right"></div>
          <div class="mdl-width"><label for="mdl-top-range">顶部留白（屏幕 px）</label><input type="number" min="0" max="120" data-mdl-key="topInset" aria-label="顶部留白"><input id="mdl-top-range" type="range" min="0" max="120" step="1" data-mdl-key="topInset"></div>
          <p>默认预留 32 px 给平板时间、状态栏，同时尊重系统安全区域。若仍遮挡，可增加此数值；留白不会被桌面画布缩小。</p>
          <div class="mdl-row"><label class="mdl-check"><input type="checkbox" data-mdl-key="showLeft">显示左栏</label><label class="mdl-check"><input type="checkbox" data-mdl-key="showRight">显示右栏</label></div>
          <p id="mdl-effective" aria-live="polite"></p>
          <p>可拖动分隔线调整宽度。顶部原有左右栏图标可收起、展开；隐藏内容后，两侧宽度仍保留。</p>
          <div class="mdl-row mdl-presets"><button type="button" data-mdl-preset="balanced">均衡三栏</button><button type="button" data-mdl-preset="chat">聊天优先</button></div>
          <footer><button type="button" id="mdl-restore">恢复原生布局</button><button type="button" id="mdl-reset">重置参数</button></footer>
        </section>
      </div>`;
    document.body.append(root);
    modal = byId('mdl-modal');
    listen(root, 'click', event => {
        event.stopPropagation();
        const target = event.target.closest('button');
        if (!target) return;
        if (target.id === 'mdl-launcher') openSettings();
        else if (target.id === 'mdl-close') closeSettings();
        else if (target.id === 'mdl-hide-floating') { settings.showFloating = false; apply(); }
        else if (target.id === 'mdl-restore') { settings.enabled = false; apply(); }
        else if (target.id === 'mdl-reset') { settings = { ...DEFAULTS }; apply(); }
        else if (target.dataset.mdlSide) toggleSide(target.dataset.mdlSide);
        else if (target.dataset.mdlPreset) {
            const preset = target.dataset.mdlPreset;
            settings = { ...settings, enabled: true, showLeft: true, showRight: true,
                mode: 'desktop', canvas: 1200,
                left: preset === 'chat' ? 200 : 260,
                right: preset === 'chat' ? 240 : 300 };
            apply({ viewportChanged: true });
        }
    });
    listen(modal, 'click', event => { if (event.target === modal) closeSettings(); });
    const change = event => {
        const input = event.target;
        const key = input.dataset.mdlKey;
        if (!key) return;
        if (input.type === 'number' && event.type === 'input') return;
        if (input.type === 'range' && event.type === 'change') return;
        settings[key] = input.type === 'checkbox' ? input.checked : input.type === 'number' || input.type === 'range' ? Number(input.value) : input.value;
        apply({ viewportChanged: key === 'scaleDesktop' || key === 'canvas' });
    };
    listen(root, 'input', change);
    listen(root, 'change', change);
    listen(root, 'keydown', event => {
        if (modal.hidden) return;
        if (event.key === 'Escape') { event.preventDefault(); closeSettings(); }
        if (event.key === 'Tab') {
            const items = [...byId('mdl-dialog').querySelectorAll('button, input, select')].filter(el => el.getClientRects().length && !el.disabled);
            const first = items[0];
            const last = items.at(-1);
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
    });
}

function createDivider(side) {
    const handle = document.createElement('div');
    handle.id = `mdl-${side}-divider`;
    handle.className = 'mdl-divider';
    handle.hidden = true;
    handle.tabIndex = 0;
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('aria-label', side === 'left' ? '调整左侧栏宽度' : '调整右侧栏宽度');
    handle.setAttribute('aria-valuemin', '0');
    handle.setAttribute('aria-valuemax', '600');
    document.body.append(handle);
    let start;
    listen(handle, 'click', event => event.stopPropagation());
    listen(handle, 'pointerdown', event => {
        if (!active || event.button > 0) return;
        event.preventDefault();
        event.stopPropagation();
        dragging = true;
        // Begin from effective widths, including any automatic shrink-to-fit.
        settings.left = Math.max(80, lastLayout.left);
        settings.right = Math.max(80, lastLayout.right);
        start = { pointer: event.pointerId, x: event.clientX, width: lastLayout[side] };
        handle.setPointerCapture(event.pointerId);
        document.body.classList.add('mdl-dragging');
    });
    listen(handle, 'pointermove', event => {
        if (!start || start.pointer !== event.pointerId) return;
        const delta = (event.clientX - start.x) * (side === 'left' ? 1 : -1);
        const other = side === 'left' ? lastLayout.right : lastLayout.left;
        const minChat = 320;
        const max = Math.max(80, Math.min(600, lastLayout.width - other - minChat));
        settings[side] = Math.round(clamp(start.width + delta, 80, max));
        apply({ save: false });
    });
    const finish = () => {
        if (!start) return;
        start = null;
        dragging = false;
        document.body.classList.remove('mdl-dragging');
        persist();
    };
    listen(handle, 'pointerup', finish);
    listen(handle, 'pointercancel', finish);
    listen(handle, 'lostpointercapture', finish);
    listen(handle, 'keydown', event => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        settings.left = Math.max(80, lastLayout.left);
        settings.right = Math.max(80, lastLayout.right);
        const delta = (event.key === 'ArrowRight' ? 1 : -1) * (side === 'left' ? 1 : -1) * (event.shiftKey ? 20 : 4);
        settings[side] = clamp(lastLayout[side] + delta, 80, 600);
        apply();
    });
}

function addSettingsEntry() {
    if (byId('mdl-settings-entry')) return;
    const parent = byId('extensions_settings2') || byId('extensions_settings');
    if (!parent) return;
    const entry = document.createElement('div');
    entry.id = 'mdl-settings-entry';
    entry.innerHTML = '<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>手机桌面布局</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content"><p>手机桌面三栏、左右宽度与拖动调节。</p><button type="button" class="menu_button">打开布局设置</button></div></div>';
    parent.append(entry);
    listen(entry.querySelector('button'), 'click', event => { event.stopPropagation(); openSettings(); });
}

function initialize() {
    if (root || !window.SillyTavern?.getContext) return;
    context = window.SillyTavern.getContext();
    if (!context.extensionSettings || typeof context.saveSettingsDebounced !== 'function') {
        console.error('[Mobile Desktop] SillyTavern extension settings API is unavailable.');
        return;
    }
    settings = normalize(context.extensionSettings[KEY]);
    abort = new AbortController();
    createControls();
    createDivider('left');
    createDivider('right');
    addSettingsEntry();
    listen(document, 'click', event => {
        if (!active) return;
        const toggle = event.target.closest('.drawer-toggle');
        const drawer = toggle?.parentElement;
        const panel = drawer?.querySelector('#left-nav-panel, #right-nav-panel');
        if (!panel) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        toggleSide(panel.id === IDS[0] ? 'left' : 'right');
    }, { capture: true });
    listen(window, 'resize', schedule);
    listen(window.visualViewport, 'resize', schedule);
    listen(window.visualViewport, 'scroll', schedule);
    listen(window.screen.orientation, 'change', () => { if (!dragging) setViewport(); schedule(); });
    apply({ save: false });
}

// New versions call lifecycle hooks; older versions still load this module normally.
export function onDisable() {
    if (active) endLayout();
    abort?.abort();
    if (frame) cancelAnimationFrame(frame);
    frame = null;
    root?.remove();
    root = null;
    ['mdl-left-divider', 'mdl-right-divider', 'mdl-settings-entry'].forEach(id => byId(id)?.remove());
}
export function onEnable() { initialize(); }
export function onDelete() { onDisable(); }

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
else initialize();
