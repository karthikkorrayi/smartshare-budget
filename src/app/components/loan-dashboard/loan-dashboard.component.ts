import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { NgxEchartsDirective } from 'ngx-echarts';
import * as XLSX from 'xlsx';
import { StorageService } from '../../services/storage.service';
import { PlannerService } from '../../services/planner.service';

@Component({
  selector: 'app-loan-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, MatCardModule, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatSelectModule, MatInputModule, NgxEchartsDirective],
  templateUrl: './loan-dashboard.component.html',
  styleUrl: './loan-dashboard.component.scss'
})
export class LoanDashboardComponent implements OnInit {
  plan: any; // stored with type:'loan'
  pieOptions:any; 
  lineOptions:any; 
  tips:string[]=[];

  constructor(
    private route: ActivatedRoute, 
    private store: StorageService, 
    private planner: PlannerService) 
    {}
  ngOnInit() { 
    const id=this.route.snapshot.paramMap.get('id')!; 
    this.plan=this.store.getGoal(id); 
    if(this.plan) this.refresh(); 
  }

  nonZeroNames(){ 
    return (this.plan.expenses||[])
    .filter((e:any)=> String(e?.name||'')
    .trim() && Number(e?.amount||0)>0)
    .map((e:any)=> String(e.name).trim()); 
  }

  refresh(){
    const base = this.planner.baseline(this.plan.incomeMin, this.plan.baselineSavingsOn);
    const expTotal = this.planner.sumExpenses(this.plan.expenses||[]);
    const emiAmt = this.planner.emi(this.plan.principal, this.plan.apr, this.plan.tenure);

    // pie: existing payments + baseline + EMI
    this.pieOptions = { 
      tooltip:{trigger:'item'}, 
      series:[{ type:'pie', 
        radius:'60%', 
        data:[
          { name:'Existing Payments', value: expTotal },
          { name:'Baseline Savings', value: base },
          { name:'EMI', value: emiAmt },
        ]}]};

    // line: cumulative EMI payments
    const schedule = this.planner.buildEmiSchedule(this.plan.principal, this.plan.apr, this.plan.tenure, this.plan.chosen.startMonth);
    this.plan.schedule = schedule; 
    this.plan.monthsRequired = schedule.length;
    this.lineOptions = { 
      tooltip:{trigger:'axis'}, 
      xAxis:{type:'category', data:schedule.map(s=>s.monthISO)}, 
      yAxis:{type:'value'}, 
      series:[{ type:'line', data:schedule.map(s=>s.cum) }] };

    // simple tips
    this.tips = [];
    const leftover = this.planner.leftover(this.plan.incomeMin, this.plan.expenses||[], base);
    if (emiAmt > leftover) this.tips.push('Your EMI is higher than the safe leftover. Consider longer tenure or reducing other expenses.');
    if (expTotal > this.plan.incomeMin*0.55) this.tips.push('Existing payments exceed ~55% of income; try trimming discretionary items.');
    if (!this.tips.length) this.tips.push('Plan looks feasible on the income floor.');

    this.store.saveGoal(this.plan);
  }

  toggleDone(row:any){ 
    row.done=!row.done; 
    this.store.saveGoal(this.plan); }

  exportExcel(){
    const rows = this.plan.schedule.map((s:any)=>({ 
      Month:s.monthISO, 
      EMI:s.amount, 
      Cumulative:s.cum, 
      Done:s.done?'Yes':'No' 
    }));
    const ws = XLSX.utils.json_to_sheet(rows); 
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'EMI Schedule');
    const meta = [[ 'Title', this.plan.title, 'Principal', this.plan.principal, 'APR %', this.plan.apr, 'Tenure (mo)', this.plan.tenure ]];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(meta), 'Meta');
    XLSX.writeFile(wb, `Loan_${this.plan.title.replace(/\s+/g,'_')}.xlsx`);
  }
}
