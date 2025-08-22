import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LoanWizardComponent } from './loan-wizard.component';

describe('LoanWizardComponent', () => {
  let component: LoanWizardComponent;
  let fixture: ComponentFixture<LoanWizardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LoanWizardComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(LoanWizardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
