import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AddExpense } from './add-expense.component';

describe('AddExpense', () => {
  let component: AddExpense;
  let fixture: ComponentFixture<AddExpense>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AddExpense]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AddExpense);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
