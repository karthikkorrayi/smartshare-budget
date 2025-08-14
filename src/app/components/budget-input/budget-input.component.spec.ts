import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BudgetInputComponent } from './budget-input.component';

describe('BudgetInputComponent', () => {
  let component: BudgetInputComponent;
  let fixture: ComponentFixture<BudgetInputComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BudgetInputComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(BudgetInputComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
