import { TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { MASK, PrivacyService } from './privacy.service';
import { AmountComponent } from '../ui/amount.component';
import { OptsPipe } from '../ui/opts.pipe';

describe('PrivacyService — balances hidden by default, revealed one by one', () => {
  it('starts hidden and toggles each key independently', () => {
    const p = new PrivacyService();
    expect(p.isVisible('wealth')).toBeFalse();
    expect(p.text('wealth', '₹1,000')).toBe(MASK);
    p.toggle('bank:a');
    expect(p.isVisible('bank:a')).toBeTrue();
    expect(p.isVisible('bank:b')).toBeFalse();
    expect(p.anyVisible()).toBeTrue();
    p.toggle('bank:a');
    expect(p.isVisible('bank:a')).toBeFalse();
    p.toggle('wallet:x');
    p.toggle('wealth');
    p.hideAll();
    expect(p.anyVisible()).toBeFalse();
  });
});

@Component({
  standalone: true,
  imports: [AmountComponent],
  template: `<div (click)="clicks = clicks + 1"><app-amount [value]="v()" privacyKey="bank:a" label="HDFC" /></div>
             <app-amount id="b" [value]="v()" privacyKey="bank:a" />`,
})
class HostComponent {
  v = signal(12345.6);
  clicks = 0;
}

describe('<app-amount>', () => {
  it('shows the mask, reveals on the eye, stays in sync across copies, never clicks the parent', () => {
    const f = TestBed.createComponent(HostComponent);
    f.detectChanges();
    const el: HTMLElement = f.nativeElement;
    const texts = () => Array.from(el.querySelectorAll('.amt')).map(x => x.textContent!.trim());
    expect(texts()).toEqual([MASK, MASK]);
    (el.querySelector('.eye') as HTMLButtonElement).click();
    f.detectChanges();
    expect(texts()[0]).toContain('12,346');
    expect(texts()[1]).toContain('12,346'); // same key → same state everywhere
    expect(f.componentInstance.clicks).toBe(0);
    expect(el.querySelector('.eye')!.getAttribute('aria-label')).toBe('Hide HDFC');
  });
});

describe('PrivacyService groups (dashboard single eye)', () => {
  it('shows and hides a whole group; allVisible needs every key', () => {
    const p = new PrivacyService();
    const keys = ['wealth', 'bank:a', 'card:b'];
    expect(p.allVisible(keys)).toBeFalse();
    p.toggle('bank:a');
    expect(p.allVisible(keys)).toBeFalse();
    p.setMany(keys, true);
    expect(p.allVisible(keys)).toBeTrue();
    p.setMany(keys, false);
    expect(keys.some(k => p.isVisible(k))).toBeFalse();
    expect(p.allVisible([])).toBeFalse();
  });
});

describe('opts pipe', () => {
  it('maps strings and objects, with lead options', () => {
    const p = new OptsPipe();
    expect(p.transform(['Food', 'Travel'])).toEqual([{ value: 'Food', label: 'Food' }, { value: 'Travel', label: 'Travel' }]);
    const o = p.transform([{ key: 'bank:1', name: 'HDFC', icon: 'landmark' }], 'key', 'name', [{ value: '', label: 'All' }], 'icon');
    expect(o.map(x => x.value)).toEqual(['', 'bank:1']);
    expect(o[1].icon).toBe('landmark');
  });
});
