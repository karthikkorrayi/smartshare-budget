/** users/{uid}.settings — budget and alert preferences (read by the app and by Cloud Functions). */
export interface UserSettings {
  /** Overall daily spending limit across expenses + card spends. 0 = none. */
  dailyLimit: number;
  /** Days before a card due date to start reminding (1–10). */
  reminderDays: number;
  /** Show streak / appreciation messages on the dashboard. */
  celebrate: boolean;
  push: {
    /** New Gmail items waiting in the Review Center. */
    reviews: boolean;
    /** Daily 9 AM digest of card payments due / overdue and statements tomorrow. */
    dues: boolean;
  };
}

export const DEFAULT_SETTINGS: UserSettings = {
  dailyLimit: 0,
  reminderDays: 3,
  celebrate: true,
  push: { reviews: true, dues: true },
};

export function withDefaults(s: Partial<UserSettings> | undefined | null): UserSettings {
  return {
    dailyLimit: Math.max(0, Number(s?.dailyLimit) || 0),
    reminderDays: Math.min(10, Math.max(1, Number(s?.reminderDays) || DEFAULT_SETTINGS.reminderDays)),
    celebrate: s?.celebrate !== false,
    push: {
      reviews: s?.push?.reviews !== false,
      dues: s?.push?.dues !== false,
    },
  };
}
