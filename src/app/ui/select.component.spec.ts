import { TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SelectComponent } from './select.component';
import { DateFieldComponent } from './date-field.component';

@Component({
  standalone: true,
  imports: [FormsModule, SelectComponent, DateFieldComponent],
  template: `<app-select [(ngModel)]="v" [options]="opts" ariaLabel="Category" />
             <app-date [(ngModel)]="d" [max]="'2026-11-24'" />`,
})
class Host {
  v = 'b';
  d = '2026-11-20';
  opts = [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Bravo' }, { value: 'c', label: 'Charlie', disabled: true }];
}

describe('themed controls', () => {
  it('app-select shows the model, opens a listbox and writes the picked value back', async () => {
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    const trigger = f.nativeElement.querySelector('app-select button.sel') as HTMLButtonElement;
    expect(trigger.textContent).toContain('Bravo');
    trigger.click();
    f.detectChanges();
    const opts = Array.from(document.querySelectorAll('.sel-panel [role=option]')) as HTMLElement[];
    expect(opts.length).toBe(3);
    opts[2].click(); // disabled → ignored
    f.detectChanges();
    expect(f.componentInstance.v).toBe('b');
    opts[0].click();
    f.detectChanges();
    expect(f.componentInstance.v).toBe('a');
    expect(document.querySelector('.sel-panel')).toBeNull(); // closed after picking
  });

  it('app-date shows a readable day and refuses days after max', async () => {
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    const trigger = f.nativeElement.querySelector('app-date button.sel') as HTMLButtonElement;
    expect(trigger.textContent).toContain('20 Nov');
    trigger.click();
    f.detectChanges();
    const cell = (k: string) => document.querySelector(`.date-panel .cell[aria-label="${k}"]`) as HTMLButtonElement;
    expect(cell('2026-11-25').disabled).toBeTrue();
    cell('2026-11-22').click();
    f.detectChanges();
    expect(f.componentInstance.d).toBe('2026-11-22');
  });
});
