/** users/{uid}.settings — budget and alert preferences (read by the app and by Cloud Functions). */
export interface UserSettings {
  /** Overall daily spending limit across expenses + card spends. 0 = none. */
  dailyLimit: number;
  /** Days before a card due date to start reminding (1–10). */
  reminderDays: number;
  /** Show streak / appreciation messages on the dashboard. */
  celebrate: boolean;
  /** Hour (IST, 6–11) for the morning push: due digest + streak milestones. */
  morningHour: number;
  /** Hour (IST, 17–23) for the evening push: "nothing logged today" check-in (Sundays: weekly recap). */
  eveningHour: number;
  push: {
    /** New Gmail items waiting in the Review Center. */
    reviews: boolean;
    /** Morning digest of card payments / bills due or overdue and statements tomorrow. */
    dues: boolean;
    /** Evening nudge when nothing is logged today (only while you're using the app that week). */
    checkin: boolean;
    /** Morning celebration when a streak reached a milestone yesterday. */
    streaks: boolean;
    /** Sunday evening recap of the week. */
    weekly: boolean;
  };
}

export type PushKind = keyof UserSettings['push'];

export const DEFAULT_SETTINGS: UserSettings = {
  dailyLimit: 0,
  reminderDays: 3,
  celebrate: true,
  morningHour: 9,
  eveningHour: 21,
  push: { reviews: true, dues: true, checkin: true, streaks: true, weekly: true },
};

const hour = (v: unknown, min: number, max: number, def: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : def;
};

export function withDefaults(s: Partial<UserSettings> | undefined | null): UserSettings {
  return {
    dailyLimit: Math.max(0, Number(s?.dailyLimit) || 0),
    reminderDays: Math.min(10, Math.max(1, Number(s?.reminderDays) || DEFAULT_SETTINGS.reminderDays)),
    celebrate: s?.celebrate !== false,
    morningHour: hour(s?.morningHour, 6, 11, DEFAULT_SETTINGS.morningHour),
    eveningHour: hour(s?.eveningHour, 17, 23, DEFAULT_SETTINGS.eveningHour),
    push: {
      reviews: s?.push?.reviews !== false,
      dues: s?.push?.dues !== false,
      checkin: s?.push?.checkin !== false,
      streaks: s?.push?.streaks !== false,
      weekly: s?.push?.weekly !== false,
    },
  };
}
