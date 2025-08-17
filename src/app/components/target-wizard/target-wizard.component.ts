import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import {
  ReactiveFormsModule,
  FormBuilder,
  Validators,
  FormArray,
  FormGroup,
} from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatIconModule } from '@angular/material/icon';
import {
  PlannerService,
  Principle,
  TargetGoalInput,
} from '../../services/planner.service';
import { StorageService } from '../../services/storage.service';

type IncomeRange = { label: string; min: number; max: number };
type ExpenseRow = { name: string; amount: number | null; icon: string };

@Component({
  selector: 'app-target-wizard',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatSlideToggleModule,
    MatIconModule,
  ],
  templateUrl: './target-wizard.component.html',
  styleUrl: './target-wizard.component.scss',
})
export class TargetWizardComponent {
  // Steps: 0=what, 1=price, 2=range, 3=expenses+baseline
  step = 0;

  // Edit mode state
  isEdit = false;
  editingId: string | null = null;

  incomeRanges: IncomeRange[] = [
    { label: '₹40k – ₹50k', min: 40000, max: 50000 },
    { label: '₹45k – ₹55k', min: 45000, max: 55000 },
    { label: '₹50k – ₹60k', min: 50000, max: 60000 },
  ];

  private iconMap: Record<string, string> = {
    'rent': 'home',
    'expenses': 'payments',
    'food & dining': 'restaurant',
    'travel': 'flight',
    'entertainment': 'movie',
    'shopping': 'shopping_bag',
    'personal care': 'face',
    'household': 'chair',
    'groceries': 'local_grocery_store',
  };

  private defaultCats: ExpenseRow[] = [
    { name: 'Rent',            amount: null, icon: 'home' },
    { name: 'Food & Dining',   amount: null, icon: 'restaurant' },
    { name: 'Travel',          amount: null, icon: 'flight' },
    { name: 'Entertainment',   amount: null, icon: 'movie' },
    { name: 'Shopping',        amount: null, icon: 'shopping_bag' },
    { name: 'Household & Groceries',       amount: null, icon: 'local_grocery_store' },
  ];

  form!: FormGroup;

  constructor(
    private fb: FormBuilder,
    private planner: PlannerService,
    private store: StorageService,
    private router: Router,
    private route: ActivatedRoute
  ) {
    this.form = this.fb.group({
      title: ['', Validators.required],
      price: [null, [Validators.required, Validators.min(1)]],
      range: [null as IncomeRange | null, Validators.required],
      expenses: this.fb.array<FormGroup>([]),
      baseline: [true],
    });

    // Detect edit mode by :id
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      const goal = this.store.getGoal(id);
      if (goal) {
        this.isEdit = true;
        this.editingId = id;

        // Prefill all steps
        this.form.patchValue({
          title: goal.title,
          price: goal.price,
          range: this.closestRange(goal.incomeMin, goal.incomeMax),
          baseline: !!goal.baselineSavingsOn,
        });

        const rows: ExpenseRow[] = (goal.expenses || []).map((e: any) => ({
          name: e.name,
          amount: e.amount,
          icon: this.iconMap[e.name?.toLowerCase?.() || ''] || 'payments',
        }));
        this.setExpenseArray(rows);

        // Start the user at Step 3 but allow navigating back through steps
        this.step = 3;
      } else {
        // unknown id → new flow
        this.seedDefaultsForNew();
      }
    } else {
      this.seedDefaultsForNew();
    }
  }

  private seedDefaultsForNew() {
    this.form.patchValue({ range: this.incomeRanges[1] }); // 45–55 default
    this.setExpenseArray(this.defaultCats);
  }

  private setExpenseArray(rows: ExpenseRow[]) {
    const fa = this.expensesFA;
    while (fa.length) fa.removeAt(0);
    for (const c of rows) {
      fa.push(
        this.fb.group({
          name: [c.name],
          amount: [c.amount, [Validators.min(0)]],
          icon: [c.icon],
        })
      );
    }
  }

  private closestRange(min: number, max: number): IncomeRange {
    const hit = this.incomeRanges.find(r => r.min === min && r.max === max)
             || this.incomeRanges.find(r => r.min <= min && r.max >= max);
    return hit || this.incomeRanges[1];
  }

  get expensesFA(): FormArray<FormGroup> {
    return this.form.get('expenses') as FormArray<FormGroup>;
  }

  addExpense() {
    this.expensesFA.push(
      this.fb.group({
        name: [''],
        amount: [null, [Validators.min(0)]],
        icon: ['payments'],
      })
    );
  }

  removeExpense(i: number) { this.expensesFA.removeAt(i); }

  iconAt(i: number): string {
    const g = this.expensesFA.at(i) as FormGroup;
    return (g.get('icon')?.value as string) || 'payments';
  }

  next() { this.step++; }

  // UPDATED: In edit mode, Back now moves through steps (3→2→1→0), then returns to dashboard only from step 0.
  back() {
    if (this.step > 0) {
      this.step--;
      return;
    }
    // step === 0
    if (this.isEdit && this.editingId) {
      this.router.navigate(['/target', this.editingId]);
    }
  }

  finish() {
    const v = this.form.value;
    const r = v.range as IncomeRange;

    // map expenses to planner model (name/amount only)
    const expenses = (v.expenses || []).map((e: any) => ({
      name: String(e.name || ''),
      amount: Number(e.amount || 0),
    }));

    const input: TargetGoalInput = {
      title: String(v.title),
      price: Number(v.price),
      incomeMin: Number(r.min),
      incomeMax: Number(r.max),
      expenses,
      baselineSavingsOn: !!v.baseline,
    };

    const base = this.planner.baseline(input.incomeMin, input.baselineSavingsOn);
    const lf = this.planner.leftover(input.incomeMin, input.expenses, base);
    const sugg = this.planner.suggestMonthly(lf);

    // keep original chosen plan if editing; else default to Balanced
    let principle: Principle = 'Balanced';
    let monthly = sugg.balanced;
    let startMonthISO: string;

    if (this.isEdit) {
      const existing = this.store.getGoal(this.editingId!);
      if (existing?.chosen) {
        principle = existing.chosen.principle || 'Balanced';
        monthly   = existing.chosen.monthly  || sugg.balanced;
        startMonthISO = existing.chosen.startMonth;
      } else {
        startMonthISO = this.monthISONow();
      }
    } else {
      startMonthISO = this.monthISONow();
    }

    // Rebuild schedule with updated inputs
    const schedule = (principle === 'Stepping')
      ? this.planner.buildStepping(input.price, startMonthISO, Math.round(lf * 0.60), 0.05)
      : this.planner.buildFlat(input.price, startMonthISO, monthly);

    const plan = {
      id: this.isEdit ? this.editingId! : ('goal-' + crypto.randomUUID()),
      ...input,
      leftover: lf,
      chosen: { principle, monthly, startMonth: startMonthISO },
      monthsRequired: schedule.length,
      schedule,
      createdAt: this.isEdit ? (this.store.getGoal(this.editingId!)?.createdAt || Date.now()) : Date.now(),
    };

    this.store.saveGoal(plan);
    this.router.navigate(['/target', plan.id]);
  }

  private monthISONow() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
}
