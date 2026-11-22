import { requireOptionalNativeModule } from 'expo';

/**
 * M262 «أضف إلى التقويم»: a booking is handed to the phone's own calendar through the system's
 * new-event screen (expo-calendar's legacy `createEventInCalendarAsync`) — the member reviews and
 * saves it himself, and the app never reads or writes a calendar on its own, so no permission is
 * declared on Android and iOS 17+ asks for none.
 *
 * The native module ships with the first build after 1.3.5. On an older binary it is missing, and
 * requiring the package there is FATAL in a release build — so nothing touches `expo-calendar`
 * before `requireOptionalNativeModule` has seen the module, and the button hides itself.
 */
export function calendarAvailable(): boolean {
  return requireOptionalNativeModule('ExpoCalendar') !== null;
}

export type CalendarEvent = { title: string; start: string; end: string; location?: string; notes?: string };

/** Opens the system's new-event screen filled with the booking. Resolves when it closes; never throws. */
export async function addToCalendar(event: CalendarEvent): Promise<void> {
  if (!calendarAvailable()) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Calendar = require('expo-calendar/legacy') as typeof import('expo-calendar/legacy');
    await Calendar.createEventInCalendarAsync({
      title: event.title,
      startDate: new Date(event.start),
      endDate: new Date(event.end),
      location: event.location,
      notes: event.notes,
    });
  } catch {
    // A calendar app that refuses the hand-off must never break the booking screen.
  }
}
