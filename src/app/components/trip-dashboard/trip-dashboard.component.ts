import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { NgxEchartsDirective } from 'ngx-echarts';
import * as XLSX from 'xlsx';
import { StorageService } from '../../services/storage.service';
import { PlannerService } from '../../services/planner.service';

@Component({
  selector: 'app-trip-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, MatCardModule, MatButtonModule, MatCheckboxModule, NgxEchartsDirective],
  templateUrl: './trip-dashboard.component.html',
  styleUrl: './trip-dashboard.component.scss'
})
export class TripDashboardComponent implements OnInit {
  plan:any; pieOptions:any; lineOptions:any; tips:string[]=[];
  constructor(private route:ActivatedRoute, private store:StorageService, private planner:PlannerService){}
  ngOnInit(){ const id=this.route.snapshot.paramMap.get('id')!; this.plan=this.store.getGoal(id); if(this.plan) this.refresh(); }

  nonZeroNames(){ 
    return (this.plan.expenses||[])
    .filter((e:any)=>String(e?.name||'')
    .trim() && Number(e?.amount||0)>0)
    .map((e:any)=>String(e.name).trim()); 
  }

  refresh(){
    const base=this.planner.baseline(this.plan.incomeMin, this.plan.baselineSavingsOn);
    const expTotal=this.planner.sumExpenses(this.plan.expenses||[]);
    const months=this.planner.monthsUntil(this.plan.tripMonth);
    const monthly=Math.ceil(this.plan.price / months);

    // pie: existing payments + baseline + trip monthly
    this.pieOptions={ tooltip:{trigger:'item'}, series:[{ type:'pie', radius:'60%', data:[
      { name:'Existing Payments', value:expTotal }, { name:'Baseline Savings', value:base }, { name:'Trip Contribution', value:monthly }
    ]}]};

    // projection line: cumulative monthly to reach target
    const schedule=this.planner.buildFlat(this.plan.price, this.plan.chosen.startMonth, monthly);
    this.plan.schedule=schedule; this.plan.monthsRequired=schedule.length;
    this.lineOptions={ tooltip:{trigger:'axis'}, xAxis:{type:'category', data:schedule.map((s:any)=>s.monthISO)}, yAxis:{type:'value'},
      series:[{ type:'line', data:schedule.map((s:any)=>s.cum) }] };

    // tips
    this.tips=[];
    const leftover=this.planner.leftover(this.plan.incomeMin, this.plan.expenses||[], base);
    if (monthly > leftover) this.tips.push('Trip monthly saving exceeds safe leftover — adjust trip date or trim expenses.');
    if (!this.tips.length) this.tips.push('You can reach your trip goal with the current timeline.');

    this.store.saveGoal(this.plan);
  }

  toggleDone(r:any){ r.done=!r.done; this.store.saveGoal(this.plan); }
  exportExcel(){
    const rows=this.plan.schedule.map((s:any)=>({ Month:s.monthISO, Amount:s.amount, Cumulative:s.cum, Done:s.done?'Yes':'No' }));
    const ws=XLSX.utils.json_to_sheet(rows); const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Trip Schedule');
    const meta=[[ 'Title', this.plan.title, 'Trip Month', this.plan.tripMonth, 'Monthly', Math.ceil(this.plan.price/this.planner.monthsUntil(this.plan.tripMonth)) ]];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(meta), 'Meta');
    XLSX.writeFile(wb, `Trip_${this.plan.title.replace(/\s+/g,'_')}.xlsx`);
  }
}
