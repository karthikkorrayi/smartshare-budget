import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { AiPlannerService } from '../../services/ai-planner.service';
import { StorageService } from '../../services/storage.service';
import { BudgetType } from '../../models';

@Component({
  selector: 'app-budget-input',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule
  ],
  templateUrl: './budget-input.component.html',
  styleUrl: './budget-input.component.scss'
})
export class BudgetInputComponent {
  today = new Date();
  monthStr = `${this.today.getFullYear()}-${String(this.today.getMonth()+1).padStart(2,'0')}`;
  priorityOptions: BudgetType[] = ['House','Personal','Loan','Trip','Others','Savings'];

  form!: FormGroup;  // <- declare here, init in constructor

  constructor(
    private fb: FormBuilder,
    private ai: AiPlannerService,
    private store: StorageService
  ) {
    this.form = this.fb.group({
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
  }

  generate() {
    const v = this.form.value;
    const plan = this.ai.generatePlan(
      v.month!, Number(v.income), (v.priorities || []) as BudgetType[],
      {
        house:+(v.fixed_house||0), personal:+(v.fixed_personal||0),
        loan:+(v.fixed_loan||0), trip:+(v.fixed_trip||0),
        others:+(v.fixed_others||0), savings:+(v.fixed_savings||0)
      }
    );
    this.store.save(plan);
    alert('AI plan generated & saved! Open Dashboard to view charts and export.');
  }
}