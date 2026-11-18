// 開いている改正案（1件＝1つの Y.Doc）。ブラウザへの控え（y-indexeddb）、サーバーとの同期（y-partyserver）、
// ルールごとの元に戻す履歴を持つ。
// - 控えは通信が切れている間の編集を残し、つながったときにサーバーへ送る（Yjs なので両方の変更が合わさる）。
// - 在席（awareness）には、名前・色と、いま開いているルール（entryKey）を載せる。

import {
  entryFragment,
  readEntries,
  readEntryDoc,
  readProposalMeta,
  touchProposal,
  type EntryInfo,
  type ProposalMeta,
  type TopBlock,
} from '@rule-builder/core';
import { IndexeddbPersistence } from 'y-indexeddb';
import YProvider from 'y-partyserver/provider';
import * as Y from 'yjs';
import { createUndoManager, type KeptUndoManager } from '../editor/ydoc.ts';
import { syncTarget } from '../server/api.ts';
import { markOnServer, putRecent } from '../storage/recent.ts';

/** 改正案ごとの IndexedDB の名前 */
export const persistenceName = (id: string) => `rule-builder-proposal:${id}`;

/** 更新日時の記録（この変更では更新日時を書き換えない） */
const TOUCH = Symbol('touch');

/** サーバーが接続を切る理由（apps/server の ProposalRoom と合わせる） */
export const CLOSE_REAUTH = 4001;
export const CLOSE_FORBIDDEN = 4003;

export type SaveState = 'saved' | 'saving' | 'offline';

/** 在席に載せる自分の情報 */
export type PeerUser = { uid: string; name: string; color: string; avatar: string | null };

export type Peer = PeerUser & { clientId: number; entryKey: string | null };

export type SessionOptions = {
  /** 改正案 ID（サーバーから開くときは、届くまで Y.Doc に ID がない） */
  id?: string;
  persist?: boolean;
};

export class ProposalSession {
  readonly ydoc: Y.Doc;
  readonly id: string;
  private persistence: IndexeddbPersistence | null = null;
  provider: YProvider | null = null;
  private undos = new Map<string, KeptUndoManager>();
  private touchTimer: ReturnType<typeof setTimeout> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private bodyTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  private bodyListeners = new Set<() => void>();
  private closeListeners = new Set<(code: number) => void>();
  private peerListeners = new Set<() => void>();
  private flowListeners = new Set<() => void>();
  private peerCache: Peer[] = [];
  saveState: SaveState = 'saved';

  constructor(ydoc: Y.Doc, options: SessionOptions = {}) {
    this.ydoc = ydoc;
    this.id = options.id ?? readProposalMeta(ydoc).id;
    if (options.persist !== false && typeof indexedDB !== 'undefined') {
      try {
        this.persistence = new IndexeddbPersistence(persistenceName(this.id), ydoc);
      } catch {
        this.persistence = null;
      }
    }
    ydoc.on('update', this.onUpdate);
    ydoc.getMap('meta').observeDeep(this.emit);
    ydoc.getArray('entries').observeDeep(this.emit);
  }

  /** ブラウザに控えてある改正案を開く */
  static async load(id: string): Promise<ProposalSession> {
    const ydoc = new Y.Doc();
    const p = new IndexeddbPersistence(persistenceName(id), ydoc);
    await p.whenSynced;
    await p.destroy();
    return new ProposalSession(ydoc, { id });
  }

  /** この端末の控えが読み込み終わるまで待つ */
  async whenLocalReady(): Promise<void> {
    if (this.persistence) await this.persistence.whenSynced;
  }

  /** サーバーとつなぐ（運営者としてログインしているとき） */
  connect(user: PeerUser) {
    if (this.provider) return;
    const t = syncTarget(this.id);
    const provider = new YProvider(t.host, this.id, this.ydoc, {
      prefix: t.prefix,
      protocol: t.protocol,
      maxBackoffTime: 10_000,
    });
    this.provider = provider;
    provider.awareness.setLocalStateField('user', user);
    provider.on('status', this.onStatus);
    provider.on('connection-close', this.onClose);
    provider.awareness.on('change', this.onAwareness);
    // 発議・採決の状態が変わったとき、サーバーが独自メッセージで知らせる（apps/server の ProposalRoom）
    provider.on('custom-message', this.onCustomMessage);
    // 同期できたら（自分の内容を送り終えるまで少し待ってから）、サーバーにある改正案として覚える
    provider.on('synced', (synced: boolean) => {
      if (!synced) return;
      setTimeout(() => {
        if (this.provider?.wsconnected && readProposalMeta(this.ydoc).id === this.id)
          markOnServer(this.id);
      }, 1500);
    });
    this.saveState = provider.wsconnected ? 'saved' : 'offline';
  }

  /** サーバーの内容が届くまで待つ（届かなければ ms で諦めて、この端末の控えで開く） */
  whenSynced(ms = 8000): Promise<boolean> {
    const p = this.provider;
    if (!p) return Promise.resolve(false);
    if (p.synced) return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = (ok: boolean) => {
        clearTimeout(timer);
        p.off('synced', onSynced);
        resolve(ok);
      };
      const onSynced = (s: boolean) => {
        if (s) done(true);
      };
      const timer = setTimeout(() => done(false), ms);
      p.on('synced', onSynced);
    });
  }

  /** 送り残しがなくなるまで待つ（サーバーに移すとき） */
  async flush(ms = 5000): Promise<boolean> {
    const end = Date.now() + ms;
    if (!(await this.whenSynced(ms))) return false;
    // 自分の内容は、サーバーからの問い合わせ（同期の step1）への返事として送られる
    await new Promise((r) => setTimeout(r, 300));
    while (Date.now() < end) {
      const ws = this.provider?.ws;
      if (ws && ws.readyState === WebSocket.OPEN && ws.bufferedAmount === 0) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  }

  private onStatus = ({ status }: { status: string }) => {
    const next: SaveState = status === 'connected' ? 'saved' : 'offline';
    if (next === this.saveState) return;
    this.saveState = next;
    this.emit();
  };

  private onClose = (event: CloseEvent | null) => {
    const code = event?.code ?? 0;
    this.closeListeners.forEach((f) => f(code));
  };

  private onCustomMessage = (message: string) => {
    try {
      const m = JSON.parse(message) as { type?: string };
      if (m.type === 'flow') this.flowListeners.forEach((f) => f());
    } catch {
      // 知らないメッセージは捨てる
    }
  };

  /** 発議・採決の状態が変わったとき（サーバーからの知らせ）に呼ぶ */
  onFlowChange(f: () => void): () => void {
    this.flowListeners.add(f);
    return () => this.flowListeners.delete(f);
  }

  private onAwareness = () => {
    // カーソルが動くたびではなく、顔ぶれか開いているルールが変わったときだけ知らせる
    const next = this.readPeers();
    const key = (ps: Peer[]) => ps.map((x) => `${x.uid}:${x.entryKey}:${x.name}`).join('|');
    if (key(next) === key(this.peerCache)) return;
    this.peerCache = next;
    this.peerListeners.forEach((f) => f());
  };

  /** 同じ改正案を開いている人が変わったときに呼ぶ */
  subscribePeers(f: () => void): () => void {
    this.peerListeners.add(f);
    return () => this.peerListeners.delete(f);
  }

  /** 接続が切れたとき（運営者の判定のやり直しなど）に呼ぶ */
  onConnectionClose(f: (code: number) => void): () => void {
    this.closeListeners.add(f);
    return () => this.closeListeners.delete(f);
  }

  /** いま開いているルールを在席に載せる（ほかの人のアイコンを押したときの移動先） */
  setActiveEntry(entryKey: string | null) {
    this.provider?.awareness.setLocalStateField('entryKey', entryKey);
  }

  /** 同じ改正案を開いているほかの人（同じ人がほかのタブで開いている分は除く） */
  peers(): Peer[] {
    return this.peerCache;
  }

  private readPeers(): Peer[] {
    const p = this.provider;
    if (!p) return [];
    const me = (p.awareness.getLocalState()?.user as PeerUser | undefined)?.uid;
    const out = new Map<string, Peer>();
    p.awareness.getStates().forEach((state, clientId) => {
      if (clientId === p.awareness.clientID) return;
      const u = state.user as PeerUser | undefined;
      if (!u?.uid || u.uid === me) return;
      out.set(u.uid, {
        ...u,
        clientId,
        entryKey: typeof state.entryKey === 'string' ? state.entryKey : null,
      });
    });
    return [...out.values()];
  }

  /** 保存の状態や、改正案の情報・ルールの一覧が変わったときに呼ぶ */
  subscribe(f: () => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  /** ほかの人の編集で本文が変わったときに呼ぶ（表示用の写しを作り直すため） */
  subscribeBodies(f: () => void): () => void {
    this.bodyListeners.add(f);
    return () => this.bodyListeners.delete(f);
  }

  private emit = () => {
    this.listeners.forEach((f) => f());
  };

  private onUpdate = (_u: Uint8Array, origin: unknown) => {
    if (origin === this.provider) {
      // ほかの人の変更：本文の写しを少し待ってからまとめて作り直す
      if (this.bodyTimer) clearTimeout(this.bodyTimer);
      this.bodyTimer = setTimeout(() => this.bodyListeners.forEach((f) => f()), 300);
      return;
    }
    if (origin === this.persistence) return;
    if (this.saveState !== 'offline') {
      this.saveState = 'saving';
      this.emit();
      if (this.saveTimer) clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => {
        if (this.saveState === 'saving') this.saveState = 'saved';
        this.emit();
      }, 600);
    }
    if (origin === TOUCH) return;
    // 更新日時と最近使った改正案の一覧は少し待ってからまとめて書く
    if (this.touchTimer) clearTimeout(this.touchTimer);
    this.touchTimer = setTimeout(() => this.touch(), 800);
  };

  /** 更新日時を記録し、最近使った改正案の一覧を更新する */
  touch() {
    this.touchTimer = null;
    this.ydoc.transact(() => touchProposal(this.ydoc), TOUCH);
    void this.saveRecent();
  }

  saveRecent() {
    const meta = this.meta();
    if (!meta.id) return Promise.resolve();
    return putRecent({
      id: meta.id,
      amendingNumber: meta.amendingNumber,
      enforcementDate: meta.enforcementDate,
      rules: readEntries(this.ydoc).map((e) => ({ name: e.meta.name, op: e.op })),
      updatedAt: meta.updatedAt,
    });
  }

  meta(): ProposalMeta {
    return readProposalMeta(this.ydoc);
  }

  entries(): EntryInfo[] {
    return readEntries(this.ydoc);
  }

  fragment(entryId: string): Y.XmlFragment {
    return entryFragment(this.ydoc, entryId);
  }

  /** ルールごとの元に戻す履歴（エディタを作り直しても残る） */
  undoFor(entryId: string): KeptUndoManager {
    let u = this.undos.get(entryId);
    if (!u) {
      u = createUndoManager(this.fragment(entryId));
      this.undos.set(entryId, u);
    }
    return u;
  }

  body(info: EntryInfo): TopBlock[] {
    return readEntryDoc(this.ydoc, info).body;
  }

  async destroy() {
    if (this.touchTimer) {
      clearTimeout(this.touchTimer);
      this.touch();
    }
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (this.bodyTimer) clearTimeout(this.bodyTimer);
    this.ydoc.off('update', this.onUpdate);
    this.undos.forEach((u) => u.dispose());
    this.undos.clear();
    this.listeners.clear();
    this.bodyListeners.clear();
    this.closeListeners.clear();
    this.peerListeners.clear();
    this.flowListeners.clear();
    if (this.provider) {
      this.provider.awareness.off('change', this.onAwareness);
      this.provider.off('custom-message', this.onCustomMessage);
      this.provider.destroy();
      this.provider = null;
    }
    if (this.persistence) await this.persistence.destroy();
    this.ydoc.destroy();
  }
}
