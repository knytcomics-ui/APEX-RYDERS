/**
 * Front-end shell: owns the DOM overlay above the Phaser canvas, routes between the
 * menu screens, and hands runs to the game through GameBridge. The run itself — the
 * lane, the HUD, the rules — is untouched; menus only appear around it.
 */
import type Phaser from 'phaser';
import type { CharacterId } from '../core/config';
import { GameBridge } from './bridge';
import { CLASSES, SHOP, type ShopItem, type TuneId } from './data';
import { I } from './icons';
import * as S from './screens';
import { buyTune, profile, recordRun, save } from './store';

type Action = (v: string, el: HTMLElement) => void;

export class Menu {
  private root: HTMLElement;
  private layer: HTMLElement;
  private modalEl: HTMLElement;
  private extras: HTMLElement;
  private screen: S.ScreenId = 'splash';
  private stack: S.ScreenId[] = [];
  private bridge: GameBridge;
  private st: S.UIState = {
    garageIdx: 0, classIdx: 0, profileCls: profile.selected, shopTab: 'characters',
    boardTab: 'open', boardCls: profile.selected, onbStep: 0, online: navigator.onLine,
  };
  private progress = 0;
  private toastTimer = 0;
  private overTimer = 0;
  /** A run quit from the pause menu is abandoned: its crash must not open Run Over. */
  private abandoned = false;

  constructor(game: Phaser.Game) {
    this.bridge = new GameBridge(game);
    this.root = document.createElement('div');
    this.root.id = 'ui';
    this.layer = document.createElement('div');
    this.extras = document.createElement('div');
    this.modalEl = document.createElement('div');
    this.root.append(this.layer, this.extras, this.modalEl);
    document.body.appendChild(this.root);
    this.st.classIdx = this.idx(profile.selected);
    this.st.garageIdx = this.st.classIdx;
    this.applySettings();

    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('input', (e) => this.onInput(e));
    this.root.addEventListener('change', (e) => this.onInput(e));
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('online', () => this.setOnline(true));
    window.addEventListener('offline', () => this.setOnline(false));
    window.addEventListener('blur', () => { if (this.screen === 'run' && !this.bridge.paused && this.bridge.mode === 'run') this.pause(); });

    // pick up where the static first-paint splash (index.html) left its bar, then retire it
    const first = document.querySelector<HTMLElement>('#boot-splash .bar i');
    const host = first?.parentElement?.getBoundingClientRect().width;
    if (first && host) this.progress = Math.min(0.4, first.getBoundingClientRect().width / host);
    this.render();
    document.getElementById('boot-splash')?.remove();
    this.boot();
  }

  // ---------- boot ----------

  private async boot() {
    const t0 = performance.now();
    const tick = setInterval(() => {
      // the loader is quick; ease the bar so the splash reads as a deliberate beat
      this.progress = Math.min(this.progress + 0.06, 0.92);
      this.splashProgress();
    }, 80);
    await this.bridge.ready();
    this.bridge.hud(false);
    this.bridge.gameKeys(false);
    this.bridge.onMode((m) => this.onMode(m));
    await new Promise((r) => setTimeout(r, Math.max(0, 1300 - (performance.now() - t0))));
    clearInterval(tick);
    this.progress = 1;
    this.splashProgress();
    setTimeout(() => { this.stack = []; this.show('home'); if (!this.st.online) this.modal(S.errorModal('YOU\'RE OFFLINE', 'Play continues offline. Your scores are kept and upload when you reconnect.')); }, 250);
  }

  // ---------- navigation ----------

  private idx(id: CharacterId) { return CLASSES.findIndex((c) => c.id === id); }

  private show(id: S.ScreenId) {
    this.screen = id;
    this.closeModal();
    this.render();
    this.layer.querySelector('.body')?.scrollTo(0, 0);
  }
  private go(id: S.ScreenId) {
    if (id === this.screen) return;
    if (this.screen !== 'splash' && this.screen !== 'onboarding') this.stack.push(this.screen);
    if (id === 'profile') this.st.profileCls = profile.selected;
    if (id === 'classes') this.st.classIdx = this.idx(profile.selected);
    if (id === 'garage') this.st.garageIdx = this.idx(profile.selected);
    this.show(id);
  }
  private back() {
    const prev = this.stack.pop() ?? 'home';
    this.show(prev);
  }

  private render() {
    const st = this.st;
    let html = '';
    switch (this.screen) {
      case 'splash': html = S.splash(this.progress); break;
      case 'home': html = S.home(); break;
      case 'modes': html = S.modes(); break;
      case 'classes': html = S.classes(st); break;
      case 'garage': html = S.garage(st); break;
      case 'onboarding': html = S.onboarding(st); break;
      case 'run': html = S.runLayer(); break;
      case 'over': html = S.over(st); break;
      case 'profile': html = S.profileScreen(st); break;
      case 'board': html = S.board(st); break;
      case 'shop': html = S.shop(st); break;
      case 'settings': html = S.settings(); break;
    }
    const scroll = this.layer.querySelector('.body')?.scrollTop ?? 0;
    this.layer.innerHTML = html;
    const body = this.layer.querySelector('.body');
    if (body) body.scrollTop = scroll;
    this.extras.innerHTML = this.st.online ? '' : S.netBanner();
    if (this.screen === 'run' && this.bridge.paused && !this.modalEl.innerHTML) this.modal(S.pauseModal(this.bridge.stats()));
    // the pause button follows handedness: thumb side away from the utility tap zone
    const pb = this.layer.querySelector<HTMLElement>('.pause-btn');
    if (pb && profile.settings.leftHanded) { pb.style.left = 'auto'; pb.style.right = '50%'; pb.style.transform = 'translateX(50%)'; }
  }

  /** Splash ticks touch only the bar and label: re-rendering would restart its intro animations. */
  private splashProgress() {
    if (this.screen !== 'splash') return;
    const fill = this.layer.querySelector<HTMLElement>('.load .bar > i');
    const pct = this.layer.querySelector<HTMLElement>('.load .pct');
    if (fill) fill.style.width = `calc(${this.progress * 100}% - .36em)`;
    if (pct) pct.textContent = `LOADING ${Math.round(this.progress * 100)}%`;
  }

  private modal(html: string) {
    this.modalEl.innerHTML = `<div class="modal-wrap" data-a="modal-bg">${html}</div>`;
  }
  private closeModal() { this.modalEl.innerHTML = ''; }

  toast(msg: string, kind: '' | 'warn' | 'err' = '') {
    clearTimeout(this.toastTimer);
    const icon = kind === 'err' ? I.close : kind === 'warn' ? I.info : I.check;
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.innerHTML = `${icon}<span>${msg}</span>`;
    this.root.querySelectorAll('.toast').forEach((t) => t.remove());
    this.root.appendChild(el);
    this.toastTimer = window.setTimeout(() => el.remove(), 2200);
  }

  // ---------- runs ----------

  private ride() {
    const c = CLASSES[this.st.classIdx];
    profile.selected = c.id;
    save();
    if (!profile.onboarded) { this.st.onbStep = 0; this.go('onboarding'); return; }
    this.startRun(c.id);
  }

  private startRun(id: CharacterId) {
    clearTimeout(this.overTimer);
    this.abandoned = false;
    this.stack = ['home'];
    this.closeModal();
    this.screen = 'run';
    this.render();
    this.bridge.start(id);
  }

  private onMode(m: string) {
    if (m !== 'over' || this.screen !== 'run' || this.abandoned) return;
    this.bridge.gameKeys(false); // Space would restart the run behind the results
    const id = profile.selected;
    const s = this.bridge.stats();
    // let the crash read for a beat before the results take over
    this.overTimer = window.setTimeout(() => {
      const rankBefore = S.openRank(Math.max(0, ...profile.runs.map((r) => r.score)));
      const reward = recordRun({ cls: id, score: s.score, dist: s.dist, coins: s.coins });
      const rankAfter = S.openRank(Math.max(0, ...profile.runs.map((r) => r.score)));
      this.st.last = { cls: id, ...s, reward, rankBefore, rankAfter, verified: false };
      this.bridge.hud(false);
      this.stack = ['home'];
      this.show('over');
      window.setTimeout(() => { if (this.st.last) { this.st.last.verified = true; if (this.screen === 'over') this.render(); } }, 1600);
    }, 1100);
  }

  private pause() {
    if (this.screen !== 'run' || this.bridge.mode !== 'run') return;
    this.bridge.pause();
    this.modal(S.pauseModal(this.bridge.stats()));
  }
  private resume() { this.closeModal(); this.bridge.resume(); }

  private home() {
    clearTimeout(this.overTimer);
    this.abandoned = true;
    this.bridge.toTitle();
    this.stack = [];
    this.show('home');
  }

  // ---------- input ----------

  private onKey(e: KeyboardEvent) {
    if (e.code !== 'Escape' && e.code !== 'KeyP') return;
    if (this.screen === 'run') {
      if (this.bridge.paused) this.resume(); else this.pause();
      return;
    }
    if (e.code !== 'Escape') return;
    if (this.modalEl.innerHTML) { this.closeModal(); return; }
    if (this.screen !== 'home' && this.screen !== 'splash' && this.screen !== 'over') this.back();
  }

  private onInput(e: Event) {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    const a = el.dataset.a, v = el.dataset.v ?? '';
    if (a === 'set-range') {
      profile.settings[v as 'sound' | 'music'] = Number(el.value);
      (el as HTMLInputElement).style.setProperty('--v', `${el.value}%`);
      const sub = el.closest('.set')?.querySelector('.muted');
      if (sub) sub.textContent = `${el.value}%`;
      if (e.type === 'change') save();
    } else if (a === 'set-lang' && e.type === 'change') {
      profile.settings.language = el.value; save();
      if (el.value !== 'English') this.toast(`${el.value} translation is coming soon`, 'warn');
    } else if (a === 'profile-select' && e.type === 'change') {
      this.st.profileCls = el.value as CharacterId; this.render();
    }
  }

  private onClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    const el = target.closest<HTMLElement>('[data-a]');
    if (!el || el.tagName === 'SELECT' || el.tagName === 'INPUT') return;
    const a = el.dataset.a!;
    if (a === 'modal-bg' && target !== el) return; // clicks inside the dialog
    if (el.tagName === 'A') e.preventDefault();
    this.actions[a]?.(el.dataset.v ?? '', el);
  }

  private actions: Record<string, Action> = {
    go: (v) => this.go(v as S.ScreenId),
    back: () => this.back(),
    home: () => this.home(),
    toast: (v) => this.toast(v, 'warn'),
    'modal-close': () => { this.closeModal(); if (this.screen === 'run' && this.bridge.paused) this.modal(S.pauseModal(this.bridge.stats())); },
    'modal-bg': () => { if (this.screen !== 'run') this.closeModal(); },

    'pick-class': (v) => { profile.selected = v as CharacterId; save(); this.go('classes'); },
    'class-idx': (v) => { this.st.classIdx = Number(v); profile.selected = CLASSES[this.st.classIdx].id; save(); this.render(); },
    ride: () => this.ride(),
    'ride-again': () => this.startRun(this.st.last?.cls ?? profile.selected),

    'onb-next': () => {
      if (this.st.onbStep < S.ONB_STEPS - 1) { this.st.onbStep++; this.render(); return; }
      profile.onboarded = true; save(); this.startRun(profile.selected);
    },
    'onb-skip': () => { profile.onboarded = true; save(); this.startRun(profile.selected); },
    'reset-onb': () => { profile.onboarded = false; save(); this.toast('Tutorial will show before your next run'); },

    pause: () => this.pause(),
    resume: () => this.resume(),
    restart: () => { this.abandoned = true; this.startRun(profile.selected); },
    quit: () => this.home(),

    'garage-step': (v) => { this.st.garageIdx = (this.st.garageIdx + Number(v) + CLASSES.length) % CLASSES.length; this.render(); },
    tune: (v) => {
      const c = CLASSES[this.st.garageIdx];
      if (buyTune(c.id, v as TuneId)) { this.toast(`${v.toUpperCase()} tuned`); this.render(); } else this.toast('Not enough coins', 'err');
    },
    paint: (v) => { profile.paint[CLASSES[this.st.garageIdx].id] = Number(v); save(); this.render(); },

    'profile-cls': (v) => { this.st.profileCls = v as CharacterId; this.render(); },
    rename: () => {
      const name = window.prompt('Rider name (3–16 characters)', profile.name)?.trim();
      if (name && name.length >= 3) { profile.name = name.slice(0, 16); save(); this.render(); }
    },

    'board-tab': (v) => { this.st.boardTab = v as 'open' | 'class'; this.render(); },
    'board-cls': (v) => { this.st.boardCls = v as CharacterId; this.render(); },

    'shop-tab': (v) => { this.st.shopTab = v as S.ShopTab; if (this.screen !== 'shop') this.go('shop'); else this.render(); },
    buy: (v) => {
      const it = this.item(v);
      if (!it || profile.owned.includes(it.id)) return;
      this.modal(S.buyModal(it));
    },
    'buy-confirm': (v) => {
      const it = this.item(v);
      if (!it) return;
      if (it.coins) { if (profile.coins < it.coins) return; profile.coins -= it.coins; }
      else if (it.usdc) { if (!profile.wallet || profile.wallet.usdc < it.usdc) return; profile.wallet.usdc = Math.round((profile.wallet.usdc - it.usdc) * 100) / 100; }
      if (it.amount) profile.coins += it.amount; else profile.owned.push(it.id);
      save();
      this.closeModal();
      this.render();
      this.toast(it.amount ? `+${it.amount.toLocaleString('en-US')} coins` : `${it.name} unlocked`);
    },

    wallet: () => this.modal(S.walletModal(profile.wallet ? 'connected' : 'pick')),
    'wallet-connect': (v) => {
      this.modal(S.walletModal('connecting', v));
      window.setTimeout(() => {
        const A32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        const address = 'G' + Array.from({ length: 55 }, () => A32[Math.floor(Math.random() * 32)]).join('');
        profile.wallet = { kind: v as 'freighter' | 'albedo', address, usdc: 25 };
        save();
        this.render();
        this.modal(S.walletModal('connected'));
      }, 1100);
    },
    'wallet-disconnect': () => { profile.wallet = null; save(); this.closeModal(); this.render(); this.toast('Wallet disconnected', 'warn'); },
    'copy-addr': () => {
      if (!profile.wallet) return;
      navigator.clipboard?.writeText(profile.wallet.address).then(() => this.toast('Address copied'), () => this.toast('Copy failed', 'err'));
    },

    'set-toggle': (v) => {
      const k = v as 'haptics' | 'reducedMotion';
      profile.settings[k] = !profile.settings[k];
      if (k === 'haptics' && profile.settings.haptics) navigator.vibrate?.(30);
      save(); this.applySettings(); this.render();
    },
    'set-hand': (v) => { profile.settings.leftHanded = v === 'left'; save(); this.render(); },

    'net-retry': () => {
      this.setOnline(navigator.onLine);
      if (navigator.onLine) { this.closeModal(); this.toast('Back online'); } else this.toast('Still offline — retrying when the connection returns', 'err');
    },
  };

  private item(id: string): ShopItem | undefined {
    return [...SHOP.characters, ...SHOP.cosmetic, ...SHOP.coins].find((i) => i.id === id);
  }

  private setOnline(on: boolean) {
    if (on === this.st.online) return;
    this.st.online = on;
    if (on) this.toast('Back online — scores synced');
    this.render();
  }

  private applySettings() {
    this.root.classList.toggle('reduced', profile.settings.reducedMotion);
  }
}

export const mountUI = (game: Phaser.Game) => new Menu(game);
