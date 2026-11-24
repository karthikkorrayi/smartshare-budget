import { Pipe, PipeTransform } from '@angular/core';
import { SelectOption } from './select.component';

/**
 * Builds <app-select> options in templates.
 *   {{ categories | opts }}                                  string[] → value = label
 *   {{ cards | opts: 'id' : 'name' }}                         objects → value / label fields
 *   {{ accounts | opts: 'key' : 'name' : lead : 'icon' : 'subtitle' }}
 * `lead` = options put first (e.g. [{ value: '', label: 'All accounts' }]).
 */
@Pipe({ name: 'opts', standalone: true })
export class OptsPipe implements PipeTransform {
  transform(
    list: readonly any[] | null | undefined,
    valueKey?: string,
    labelKey?: string | ((x: any) => string),
    lead?: SelectOption[] | null,
    iconKey?: string | ((x: any) => string),
    hintKey?: string | ((x: any) => string)
  ): SelectOption[] {
    const pick = (x: any, k?: string | ((x: any) => string)) => (k == null ? undefined : typeof k === 'function' ? k(x) : x?.[k]);
    const items = (list ?? []).map(x =>
      typeof x !== 'object' || x === null
        ? { value: x, label: String(x) }
        : {
            value: valueKey ? x[valueKey] : x,
            label: String(pick(x, labelKey ?? 'label') ?? ''),
            icon: pick(x, iconKey),
            hint: pick(x, hintKey),
            disabled: !!x.disabled,
          }
    );
    return [...(lead ?? []), ...items];
  }
}
