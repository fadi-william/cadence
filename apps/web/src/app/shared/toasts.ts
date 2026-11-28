import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastService } from '../core/toast.service';
import { Icon } from './icon';

/**
 * Global toast stack (bottom-right; raised above the mobile bottom bar) rendering {@link ToastService}'s
 * queue with a dismiss button per toast. Mounted once in the root component.
 */
@Component({
  selector: 'app-toasts',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './toasts.html',
})
export class Toasts {
  protected readonly toasts = inject(ToastService);
}
