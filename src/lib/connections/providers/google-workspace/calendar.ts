import type { ConnectionToolDefinition } from '../../types';
import { googleAuthFromSecrets, missingGoogleAuth } from './auth';
import { GOOGLE_BASE, googleApiFetch, googleResult } from './client';

const CAL = `${GOOGLE_BASE}/calendar/v3`;

function isMock(args: Record<string, unknown>): boolean {
  return args.mock === true || args.__mock === true;
}

interface MockEvent { id: string; summary: string; start: string; end: string; attendees: string[]; location?: string; description?: string }
const mockEvents = new Map<string, MockEvent>();
function mockId(): string {
  return `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toAttendees(args: Record<string, unknown>): string[] {
  const raw = args.attendees;
  if (Array.isArray(raw)) return raw.map((a) => (typeof a === 'string' ? a : String((a as { email?: string }).email ?? ''))).filter(Boolean);
  if (typeof raw === 'string' && raw.trim()) return raw.split(/[,;\s]+/).filter(Boolean);
  return [];
}

/** Compute free windows of `durationMin` between busy blocks within [timeMin,timeMax]. */
function freeSlots(busy: Array<{ start: string; end: string }>, timeMin: string, timeMax: string, durationMin: number): Array<{ start: string; end: string }> {
  const windowStart = new Date(timeMin).getTime();
  const windowEnd = new Date(timeMax).getTime();
  const durationMs = durationMin * 60_000;
  const blocks = busy
    .map((b) => ({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() }))
    .sort((a, b) => a.start - b.start);
  const slots: Array<{ start: string; end: string }> = [];
  let cursor = windowStart;
  for (const b of blocks) {
    if (b.start - cursor >= durationMs) slots.push({ start: new Date(cursor).toISOString(), end: new Date(b.start).toISOString() });
    cursor = Math.max(cursor, b.end);
  }
  if (windowEnd - cursor >= durationMs) slots.push({ start: new Date(cursor).toISOString(), end: new Date(windowEnd).toISOString() });
  return slots;
}

export const googleCalendarTools: ConnectionToolDefinition[] = [
  {
    name: 'google.calendar.list_calendars',
    description: 'List the user calendar list.',
    risk: 'external_read',
    async run(args, secrets) {
      if (isMock(args)) return { success: true, output: JSON.stringify({ calendars: [{ id: 'primary', summary: 'Primary' }] }), details: { calendars: [{ id: 'primary', summary: 'Primary' }] } };
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      return googleResult(async () => {
        const data = await googleApiFetch('calendar', `${CAL}/users/me/calendarList`, auth.accessToken!) as { items?: Array<Record<string, unknown>> };
        const calendars = (data.items ?? []).map((c) => ({ id: c.id, summary: c.summary, primary: c.primary, accessRole: c.accessRole }));
        return { success: true, output: JSON.stringify({ calendars, count: calendars.length }), details: { calendars } };
      });
    },
  },
  {
    name: 'google.calendar.list_events',
    description: 'List calendar events between time_min and time_max (ISO 8601).',
    risk: 'external_read',
    async run(args, secrets) {
      const calendarId = String(args.calendar_id ?? args.calendarId ?? 'primary');
      const timeMin = String(args.time_min ?? args.timeMin ?? new Date().toISOString());
      const timeMax = String(args.time_max ?? args.timeMax ?? new Date(Date.now() + 7 * 86_400_000).toISOString());
      if (isMock(args)) {
        const events = [...mockEvents.values()].filter((e) => e.start >= timeMin && e.start <= timeMax);
        return { success: true, output: JSON.stringify({ events }), details: { events } };
      }
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      return googleResult(async () => {
        const data = await googleApiFetch(
          'calendar',
          `${CAL}/calendars/${encodeURIComponent(calendarId)}/events?singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`,
          auth.accessToken!,
        ) as { items?: Array<Record<string, unknown>> };
        const events = (data.items ?? []).map((e) => ({
          id: e.id,
          summary: e.summary,
          start: (e.start as { dateTime?: string; date?: string })?.dateTime ?? (e.start as { date?: string })?.date,
          end: (e.end as { dateTime?: string; date?: string })?.dateTime ?? (e.end as { date?: string })?.date,
          attendees: (e.attendees as Array<{ email?: string }> | undefined)?.map((a) => a.email) ?? [],
        }));
        return { success: true, output: JSON.stringify({ events, count: events.length }), details: { events } };
      });
    },
  },
  {
    name: 'google.calendar.search_events',
    description: 'Search calendar events by text query between time_min and time_max.',
    risk: 'external_read',
    async run(args, secrets) {
      const calendarId = String(args.calendar_id ?? args.calendarId ?? 'primary');
      const query = String(args.query ?? args.q ?? '');
      const timeMin = String(args.time_min ?? args.timeMin ?? new Date(Date.now() - 30 * 86_400_000).toISOString());
      const timeMax = String(args.time_max ?? args.timeMax ?? new Date(Date.now() + 30 * 86_400_000).toISOString());
      if (isMock(args)) {
        const q = query.toLowerCase();
        const events = [...mockEvents.values()].filter((e) => e.start >= timeMin && e.start <= timeMax && (!q || `${e.summary} ${e.description ?? ''}`.toLowerCase().includes(q)));
        return { success: true, output: JSON.stringify({ events, count: events.length }), details: { events } };
      }
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      return googleResult(async () => {
        const data = await googleApiFetch(
          'calendar',
          `${CAL}/calendars/${encodeURIComponent(calendarId)}/events?singleEvents=true&orderBy=startTime&q=${encodeURIComponent(query)}&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`,
          auth.accessToken!,
        ) as { items?: Array<Record<string, unknown>> };
        const events = (data.items ?? []).map((e) => ({
          id: e.id,
          summary: e.summary,
          start: (e.start as { dateTime?: string; date?: string })?.dateTime ?? (e.start as { date?: string })?.date,
          end: (e.end as { dateTime?: string; date?: string })?.dateTime ?? (e.end as { date?: string })?.date,
          location: e.location,
          attendees: (e.attendees as Array<{ email?: string }> | undefined)?.map((a) => a.email) ?? [],
        }));
        return { success: true, output: JSON.stringify({ events, count: events.length }), details: { events } };
      });
    },
  },
  {
    name: 'google.calendar.find_free_slots',
    description: 'Find free time windows of duration_minutes between time_min and time_max.',
    risk: 'external_read',
    async run(args, secrets) {
      const calendarId = String(args.calendar_id ?? args.calendarId ?? 'primary');
      const timeMin = String(args.time_min ?? args.timeMin ?? new Date().toISOString());
      const timeMax = String(args.time_max ?? args.timeMax ?? new Date(Date.now() + 7 * 86_400_000).toISOString());
      const durationMin = Number(args.duration_minutes ?? args.durationMinutes ?? 30) || 30;
      if (isMock(args)) {
        const busy = [...mockEvents.values()].map((e) => ({ start: e.start, end: e.end }));
        const slots = freeSlots(busy, timeMin, timeMax, durationMin);
        return { success: true, output: JSON.stringify({ slots }), details: { slots } };
      }
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      return googleResult(async () => {
        const data = await googleApiFetch('calendar', `${CAL}/freeBusy`, auth.accessToken!, {
          method: 'POST',
          body: JSON.stringify({ timeMin, timeMax, items: [{ id: calendarId }] }),
        }) as { calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }> };
        const busy = data.calendars?.[calendarId]?.busy ?? [];
        const slots = freeSlots(busy, timeMin, timeMax, durationMin);
        return { success: true, output: JSON.stringify({ slots, count: slots.length }), details: { slots, busy } };
      });
    },
  },
  {
    name: 'google.calendar.create_event',
    description: 'Create a calendar event. External send (may invite attendees): approval-gated.',
    risk: 'external_send',
    async run(args, secrets) {
      const calendarId = String(args.calendar_id ?? args.calendarId ?? 'primary');
      const summary = String(args.summary ?? args.title ?? 'Event');
      const start = String(args.start ?? '');
      const end = String(args.end ?? '');
      const description = args.description != null ? String(args.description) : undefined;
      const location = args.location != null ? String(args.location) : undefined;
      const attendees = toAttendees(args);
      if (!start || !end) return { success: false, output: '', error: 'missing_start_or_end' };
      if (isMock(args)) {
        const id = mockId();
        mockEvents.set(id, { id, summary, start, end, attendees, location, description });
        return { success: true, output: `Mock event created: ${id}`, details: { eventId: id, summary, attendees, verified: true } };
      }
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      return googleResult(async () => {
        const sendUpdates = attendees.length ? 'all' : 'none';
        const created = await googleApiFetch(
          'calendar',
          `${CAL}/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=${sendUpdates}`,
          auth.accessToken!,
          {
            method: 'POST',
            body: JSON.stringify({
              summary,
              description,
              location,
              start: { dateTime: start },
              end: { dateTime: end },
              ...(attendees.length ? { attendees: attendees.map((email) => ({ email })) } : {}),
            }),
          },
        ) as { id?: string; htmlLink?: string };
        const eventId = String(created.id ?? '');
        // Read-back: GET the event and confirm summary/start.
        let verified = false;
        if (eventId) {
          const check = await googleApiFetch('calendar', `${CAL}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, auth.accessToken!) as {
            summary?: string; start?: { dateTime?: string };
          };
          verified = check.summary === summary;
        }
        return {
          success: true,
          output: `Naptár esemény létrehozva: "${summary}"${attendees.length ? ` (${attendees.length} meghívott)` : ''}. Read-back: ${verified ? 'megerősítve' : 'nem megerősíthető'}.`,
          details: { eventId, htmlLink: created.htmlLink, attendees, verified },
        };
      });
    },
  },
  {
    name: 'google.calendar.update_event',
    description: 'Update a calendar event. External send if attendees are present: approval-gated.',
    risk: 'external_send',
    async run(args, secrets) {
      const calendarId = String(args.calendar_id ?? args.calendarId ?? 'primary');
      const eventId = String(args.event_id ?? args.eventId ?? '');
      if (!eventId) return { success: false, output: '', error: 'missing_event_id' };
      const attendees = toAttendees(args);
      if (isMock(args)) {
        const existing = mockEvents.get(eventId);
        if (!existing) return { success: false, output: '', error: 'mock_event_not_found' };
        const next = {
          ...existing,
          summary: args.summary != null || args.title != null ? String(args.summary ?? args.title) : existing.summary,
          start: args.start != null ? String(args.start) : existing.start,
          end: args.end != null ? String(args.end) : existing.end,
          attendees: attendees.length ? attendees : existing.attendees,
          location: args.location != null ? String(args.location) : existing.location,
          description: args.description != null ? String(args.description) : existing.description,
        };
        mockEvents.set(eventId, next);
        return { success: true, output: `Mock event updated: ${eventId}`, details: { eventId, verified: true } };
      }
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      return googleResult(async () => {
        const current = await googleApiFetch('calendar', `${CAL}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, auth.accessToken!) as Record<string, unknown>;
        const body = {
          ...current,
          ...(args.summary != null || args.title != null ? { summary: String(args.summary ?? args.title) } : {}),
          ...(args.description != null ? { description: String(args.description) } : {}),
          ...(args.location != null ? { location: String(args.location) } : {}),
          ...(args.start != null ? { start: { dateTime: String(args.start) } } : {}),
          ...(args.end != null ? { end: { dateTime: String(args.end) } } : {}),
          ...(attendees.length ? { attendees: attendees.map((email) => ({ email })) } : {}),
        };
        const sendUpdates = attendees.length ? 'all' : 'none';
        await googleApiFetch('calendar', `${CAL}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}?sendUpdates=${sendUpdates}`, auth.accessToken!, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
        const check = await googleApiFetch('calendar', `${CAL}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, auth.accessToken!) as { id?: string; summary?: string };
        const verified = check.id === eventId;
        return { success: true, output: `Naptar esemeny modositva: "${check.summary ?? eventId}". Read-back: ${verified ? 'megerositve' : 'nem megerositheto'}.`, details: { eventId, verified } };
      });
    },
  },
  {
    name: 'google.calendar.delete_event',
    description: 'Delete a calendar event. Destructive calendar write: approval-gated.',
    risk: 'destructive',
    async run(args, secrets) {
      const calendarId = String(args.calendar_id ?? args.calendarId ?? 'primary');
      const eventId = String(args.event_id ?? args.eventId ?? '');
      if (!eventId) return { success: false, output: '', error: 'missing_event_id' };
      if (isMock(args)) {
        const existed = mockEvents.delete(eventId);
        return { success: existed, output: existed ? `Mock event deleted: ${eventId}` : '', error: existed ? undefined : 'mock_event_not_found', details: { eventId, verifiedDeleted: existed } };
      }
      const auth = googleAuthFromSecrets(secrets);
      if (!auth.accessToken) return missingGoogleAuth();
      return googleResult(async () => {
        await googleApiFetch('calendar', `${CAL}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}?sendUpdates=all`, auth.accessToken!, { method: 'DELETE' });
        const verifiedDeleted = await googleApiFetch('calendar', `${CAL}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, auth.accessToken!)
          .then(() => false)
          .catch(() => true);
        return {
          success: verifiedDeleted,
          output: verifiedDeleted ? `Naptar esemeny torolve (${eventId}). Read-back: torles megerositve.` : 'A torlest nem sikerult visszaigazolni.',
          error: verifiedDeleted ? undefined : 'delete_not_verified',
          details: { eventId, verifiedDeleted },
        };
      });
    },
  },
];
