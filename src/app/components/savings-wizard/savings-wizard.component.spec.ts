import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SavingsWizardComponent } from './savings-wizard.component';

describe('SavingsWizardComponent', () => {
  let component: SavingsWizardComponent;
  let fixture: ComponentFixture<SavingsWizardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SavingsWizardComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SavingsWizardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
