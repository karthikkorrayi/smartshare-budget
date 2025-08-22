import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TripWizardComponent } from './trip-wizard.component';

describe('TripWizardComponent', () => {
  let component: TripWizardComponent;
  let fixture: ComponentFixture<TripWizardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TripWizardComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TripWizardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
