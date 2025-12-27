import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class PinLockService {

  private readonly PIN_KEY = 'app_pin';
  private readonly UNLOCK_TIME_KEY = 'last_unlock_time';
  private readonly LOCK_DURATION = 10 * 60 * 1000; // 10 minutes

  isLocked = true;

  constructor() {
    this.checkLockStatus();
  }

  setPin(pin: string) {
    localStorage.setItem(this.PIN_KEY, pin);
  }

  verifyPin(input: string): boolean {
    const savedPin = localStorage.getItem(this.PIN_KEY);
    if (savedPin === input) {
      this.unlock();
      return true;
    }
    return false;
  }

  unlock() {
    this.isLocked = false;
    localStorage.setItem(this.UNLOCK_TIME_KEY, Date.now().toString());
  }

  lock() {
    this.isLocked = true;
  }

  checkLockStatus() {
    const lastUnlock = Number(localStorage.getItem(this.UNLOCK_TIME_KEY));
    if (!lastUnlock || Date.now() - lastUnlock > this.LOCK_DURATION) {
      this.lock();
    } else {
      this.isLocked = false;
    }
  }

  refreshLock() {
    this.lock();
    localStorage.removeItem(this.UNLOCK_TIME_KEY);
  }
}