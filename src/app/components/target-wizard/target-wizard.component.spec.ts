import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TargetWizardComponent } from './target-wizard.component';

describe('TargetWizardComponent', () => {
  let component: TargetWizardComponent;
  let fixture: ComponentFixture<TargetWizardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TargetWizardComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TargetWizardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
