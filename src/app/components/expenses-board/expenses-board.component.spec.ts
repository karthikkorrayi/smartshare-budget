import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ExpensesBoardComponent } from './expenses-board.component';

describe('ExpensesBoardComponent', () => {
  let component: ExpensesBoardComponent;
  let fixture: ComponentFixture<ExpensesBoardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ExpensesBoardComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ExpensesBoardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
