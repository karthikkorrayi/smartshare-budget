import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, FormArray } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatIconModule } from '@angular/material/icon';
import { PlannerService } from '../../services/planner.service';
import { StorageService } from '../../services/storage.service';

type IncomeRange = { label: string; min: number; max: number };

@Component({
  selector: 'app-trip-wizard',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule, MatSlideToggleModule, MatIconModule],
  templateUrl: './trip-wizard.component.html',
  styleUrl: './trip-wizard.component.scss'
})
export class TripWizardComponent {
  step = 0; isEdit=false; editingId:string|null=null;
  incomeRanges: IncomeRange[] = [
    { label: '₹40k – ₹50k', min: 40000, max: 50000 },
    { label: '₹45k – ₹55k', min: 45000, max: 55000 },
    { label: '₹50k – ₹60k', min: 50000, max: 60000 },
  ];
  form!: FormGroup;

  constructor(private fb:FormBuilder, private planner:PlannerService, private store:StorageService, private router:Router, private route:ActivatedRoute){
    this.form = this.fb.group({
      title: ['', Validators.required],
      total: [null, [Validators.required, Validators.min(1)]],
      tripMonth: [null, Validators.required], // type="month" e.g. 2025-12
      range: [null as IncomeRange | null, Validators.required],
      expenses: this.fb.array<FormGroup>([]),
      baseline: [true],
    });
    this.form.patchValue({ range: this.incomeRanges[1] });

    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      const g = this.store.getGoal(id);
      if (g && g.type==='trip') {
        this.isEdit = true; this.editingId=id;
        this.form.patchValue({
          title: g.title, total: g.price, tripMonth: g.tripMonth, range: {label:'custom', min:g.incomeMin, max:g.incomeMax}, baseline: !!g.baselineSavingsOn
        });
        (g.expenses||[]).forEach((e:any)=> this.addExpense(e.name, e.amount));
        this.step = 3;
      }
    }
  }

  get expensesFA(){ return this.form.get('expenses') as FormArray<FormGroup>; }
  addExpense(name='', amount:number|null=null){ this.expensesFA.push(this.fb.group({ name:[name], amount:[amount, [Validators.min(0)]] })); }
  removeExpense(i:number){ this.expensesFA.removeAt(i); }
  next(){ this.step++; }
  back(){ if(this.step>0) this.step--; else if(this.isEdit && this.editingId) this.router.navigate(['/trip', this.editingId]); }

  finish(){
    const v=this.form.value, r=v.range as IncomeRange;
    const expenses = (v.expenses||[]).map((e:any)=>({ name:String(e.name||''), amount:Number(e.amount||0) }));
    const incomeMin=r.min, incomeMax=r.max;

    const base = this.planner.baseline(incomeMin, !!v.baseline);
    const lf = this.planner.leftover(incomeMin, expenses, base);
    const months = this.planner.monthsUntil(String(v.tripMonth));
    const monthly = Math.ceil(Number(v.total)/months);

    const startISO = this.monthISONow();
    const schedule = this.planner.buildFlat(Number(v.total), startISO, monthly);

    const plan = {
      id: this.isEdit ? this.editingId! : ('trip-' + crypto.randomUUID()),
      type: 'trip',
      title: String(v.title),
      price: Number(v.total),
      tripMonth: String(v.tripMonth),
      incomeMin, incomeMax,
      expenses,
      baselineSavingsOn: !!v.baseline,
      leftover: lf,
      chosen: { principle: 'Balanced', monthly, startMonth: startISO },
      monthsRequired: schedule.length,
      schedule,
      createdAt: Date.now(),
    };
    this.store.saveGoal(plan);
    this.router.navigate(['/trip', plan.id]);
  }

  private monthISONow(){ 
    const d=new Date(); 
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; 
  }
}
