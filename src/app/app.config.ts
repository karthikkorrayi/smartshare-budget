import { ApplicationConfig, importProvidersFrom } from '@angular/core';
import { NgxEchartsModule } from 'ngx-echarts';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { provideAnimations } from '@angular/platform-browser/animations';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideAnimations(),
    importProvidersFrom(NgxEchartsModule.forRoot({ echarts: () => import('echarts') }))
  ]
};
