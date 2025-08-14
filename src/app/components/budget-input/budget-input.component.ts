import { Component } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { AiPlannerService } from '../../services/ai-planner.service';
import { StorageService } from '../../services/storage.service';
import { BudgetPlan, BudgetType } from '../../models';

import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule }     from '@angular/material/input';
import { MatSelectModule }    from '@angular/material/select';
import { MatButtonModule }    from '@angular/material/button';
import { ReactiveFormsModule } from '@angular/forms';

@Component({
  selector: 'app-budget-input',
  templateUrl: './budget-input.component.html',
  styleUrls: ['./budget-input.component.scss'],
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule
  ]
})
export class BudgetInputComponent {
  today = new Date();
  monthStr = `${this.today.getFullYear()}-${String(this.today.getMonth()+1).padStart(2,'0')}`;

  priorityOptions: BudgetType[] = ['House','Personal','Loan','Trip','Others','Savings'];

  form = this.fb.group({
    month: [this.monthStr, Validators.required],
    income: [30000, [Validators.required, Validators.min(0)]],
    priorities: [[] as BudgetType[]],
    fixed_house: [0],
    fixed_personal: [0],
    fixed_loan: [0],
    fixed_trip: [0],
    fixed_others: [0],
    fixed_savings: [0],
  });

  constructor(
    private fb: FormBuilder,
    private ai: AiPlannerService,
    private store: StorageService
  ) {}

  generate() {
    const v = this.form.value;
    const plan = this.ai.generatePlan(
      v.month!,
      Number(v.income),
      (v.priorities ?? []) as BudgetType[],
      {
        house: Number(v.fixed_house),
        personal: Number(v.fixed_personal),
        loan: Number(v.fixed_loan),
        trip: Number(v.fixed_trip),
        others: Number(v.fixed_others),
        savings: Number(v.fixed_savings),
      }
    );

    this.store.save(plan);
    alert('AI plan generated & saved! Open Dashboard to view charts and export.');
  }
}