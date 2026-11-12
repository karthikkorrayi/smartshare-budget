import { Pipe, PipeTransform, inject } from '@angular/core';
import { UndoService } from '../services/undo.service';

/**
 * Hides records whose delete / mark-paid / approve is being held in the 5-second Undo window.
 *   *ngFor="let x of list | visible"      @for (x of list | visible; track x.id)
 * Impure on purpose: it re-checks the (cheap) hidden-id set on every change detection.
 */
@Pipe({ name: 'visible', standalone: true, pure: false })
export class VisiblePipe implements PipeTransform {
  private undo = inject(UndoService);
  private lastIn: readonly any[] | null = null;
  private lastHidden: ReadonlySet<string> | null = null;
  private lastOut: any[] = [];

  transform<T extends { id?: string }>(list: readonly T[] | null | undefined): T[] {
    const hidden = this.undo.hidden();
    if (!list) return [];
    if (list === this.lastIn && hidden === this.lastHidden) return this.lastOut as T[];
    this.lastIn = list;
    this.lastHidden = hidden;
    this.lastOut = hidden.size ? list.filter(x => !x.id || !hidden.has(x.id)) : [...list];
    return this.lastOut as T[];
  }
}
