import { Injectable, signal } from '@angular/core';

export const UNDO_MS = 5000;

export interface UndoEntry {
  id: number;
  message: string;
  /** ms epoch when the window closes (drives the countdown bar). */
  expiresAt: number;
  error?: string;
}

interface Pending {
  entry: UndoEntry;
  timer: ReturnType<typeof setTimeout>;
  hideIds: string[];
  commit?: () => Promise<unknown>;
  revert?: () => Promise<unknown>;
  /** UI-only cleanup when a deferred action is undone (e.g. untick a checkbox). */
  onUndo?: () => void;
  done: boolean;
}

/**
 * 5-second Undo for every important action. Two modes:
 *
 *  • defer()  — for deletes / mark paid / approve / reject: the item disappears from the screen
 *               immediately, but the write is HELD for 5 s. Undo simply cancels it, so nothing
 *               is ever written or restored. If the app goes to the background (or the page is
 *               closed), held actions are committed straight away.
 *  • offer()  — for adds and edits made in a dialog: the save happens immediately; Undo runs the
 *               inverse (delete the new record / write the old values back).
 */
@Injectable({ providedIn: 'root' })
export class UndoService {
  private seq = 0;
  private pending = new Map<number, Pending>();

  readonly entries = signal<UndoEntry[]>([]);
  /** Ids of records hidden while their action is held. Lists filter these out. */
  readonly hidden = signal<ReadonlySet<string>>(new Set());

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this.flushAll();
      });
      window.addEventListener('pagehide', () => this.flushAll());
    }
  }

  /** Hold `commit` for 5 s; hide `hideIds` meanwhile. */
  defer(message: string, hideIds: string[], commit: () => Promise<unknown>, onUndo?: () => void): void {
    this.add({ message, hideIds, commit, onUndo });
  }

  /** The change is already saved; offer `revert` for 5 s. */
  offer(message: string, revert: () => Promise<unknown>): void {
    this.add({ message, hideIds: [], revert });
  }

  undo(id: number): void {
    const p = this.pending.get(id);
    if (!p || p.done) return;
    p.done = true;
    clearTimeout(p.timer);
    this.remove(id);
    if (p.revert) {
      p.revert().catch(err => {
        console.error('[Undo] revert failed', err);
        this.toastError('Undo failed — please fix it manually.');
      });
    }
    // Deferred actions: cancelling the timer is the whole undo — just show the items again.
    this.unhide(p.hideIds);
    p.onUndo?.();
  }

  dismiss(id: number): void {
    const p = this.pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    this.finish(p);
  }

  flushAll(): void {
    for (const p of [...this.pending.values()]) {
      clearTimeout(p.timer);
      this.finish(p);
    }
  }

  private add(x: { message: string; hideIds: string[]; commit?: () => Promise<unknown>; revert?: () => Promise<unknown>; onUndo?: () => void }): void {
    // Only the 3 newest stay undoable on screen; older ones are committed now.
    const live = [...this.pending.values()].filter(p => !p.done);
    if (live.length >= 3) {
      const oldest = live[0];
      clearTimeout(oldest.timer);
      this.finish(oldest);
    }
    const id = ++this.seq;
    const entry: UndoEntry = { id, message: x.message, expiresAt: Date.now() + UNDO_MS };
    const p: Pending = { entry, hideIds: x.hideIds, commit: x.commit, revert: x.revert, onUndo: x.onUndo, done: false, timer: setTimeout(() => this.finish(p), UNDO_MS) };
    this.pending.set(id, p);
    this.entries.update(list => [...list, entry]);
    if (x.hideIds.length) this.hidden.update(s => new Set([...s, ...x.hideIds]));
  }

  private finish(p: Pending): void {
    if (p.done) return this.remove(p.entry.id);
    p.done = true;
    this.remove(p.entry.id);
    if (p.commit) {
      p.commit()
        .catch(err => {
          console.error('[Undo] action failed', err);
          this.toastError(`Couldn't complete: ${p.entry.message.toLowerCase()}. It has been put back.`);
        })
        .finally(() => this.unhide(p.hideIds));
    } else {
      this.unhide(p.hideIds);
    }
  }

  private remove(id: number): void {
    this.pending.delete(id);
    this.entries.update(list => list.filter(e => e.id !== id));
  }

  private unhide(ids: string[]): void {
    if (!ids.length) return;
    this.hidden.update(s => {
      const n = new Set(s);
      ids.forEach(i => n.delete(i));
      return n;
    });
  }

  private toastError(message: string): void {
    const id = ++this.seq;
    this.entries.update(list => [...list, { id, message, expiresAt: Date.now() + 6000, error: message }]);
    setTimeout(() => this.entries.update(list => list.filter(e => e.id !== id)), 6000);
  }
}
