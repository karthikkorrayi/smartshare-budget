import { TestBed } from '@angular/core/testing';

import { AiPlannerService } from './ai-planner.service';

describe('AiPlannerService', () => {
  let service: AiPlannerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(AiPlannerService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
