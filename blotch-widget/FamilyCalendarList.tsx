import { useFetch } from "~lib/use-fetch";
import { useInputs } from "~lib/use-inputs";

type WidgetEvent = {
  readonly title: string;
  readonly location: string | null;
  readonly time_label: string;
  readonly attendees: readonly string[];
};

type WidgetDay = {
  readonly date: string;
  readonly label: string;
  readonly events: readonly WidgetEvent[];
};

type EventsResponse = {
  readonly timezone: string;
  readonly days: readonly WidgetDay[];
};

// TEXT_SIZE input -> Tailwind classes. Larger sizes stack the time under the title
// instead of side-by-side, since a big font next to a right-aligned time would
// squeeze the title down to nothing on a narrow frame.
const SIZES = {
  Normal: { day: "text-2xl", event: "text-lg", stack: false },
  Large: { day: "text-3xl", event: "text-xl", stack: true },
  "Extra Large": { day: "text-4xl", event: "text-2xl", stack: true },
} as const;

export const Widget = () => {
  // RANGE, TEXT_SIZE, API_BASE_URL: Public Inputs. API_TOKEN: Private Input — a
  // FamilyHub device token created at /devices. See blotch-widget/README.md.
  const { RANGE, TEXT_SIZE, API_BASE_URL, API_TOKEN } = useInputs();

  const days = RANGE === "Next Week" ? 7 : 3;
  const size = SIZES[TEXT_SIZE as keyof typeof SIZES] ?? SIZES.Normal;
  // Strips a trailing slash so a base URL like ".../railway.app/" doesn't turn into
  // a double-slash path that 404s.
  const url = `${(API_BASE_URL ?? "").replace(/\/+$/, "")}/api/widget/events?days=${days}`;

  // NOTE: assumes useFetch's second argument accepts fetch-style { headers }.
  // Check the Designer's autocomplete for useFetch's real signature if this errors.
  const { data } = useFetch<EventsResponse>(url, {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
  });

  // useFetch doesn't suspend, so `data` is undefined while loading. If the request
  // fails (bad/missing token, wrong API_BASE_URL, etc.) the backend's JSON error body
  // shows up here instead — truthy, but with no `days` — so check the shape, not
  // just truthiness, and surface whatever the backend said instead of crashing.
  if (!data || !Array.isArray((data as EventsResponse | { detail?: string }).days)) {
    return (
      <div className="size-full flex items-center justify-center bg-white p-4">
        <span className={`${size.event} text-black/50 text-center`}>
          {data ? `Couldn't load the calendar: ${(data as { detail?: string }).detail ?? "unexpected response"}` : "Loading…"}
        </span>
      </div>
    );
  }

  return (
    <div className="size-full flex flex-col bg-white text-black p-4 gap-3">
      <div className="flex-1 flex flex-col gap-3 overflow-hidden">
        {data.days.map((day) => (
          <div key={day.date} className="flex flex-col border-t border-black/30 pt-1">
            <span className={`${size.day} font-semibold`}>{day.label}</span>
            {day.events.length === 0 ? (
              <span className={`${size.event} text-black/50 pl-2`}>No events</span>
            ) : (
              day.events.map((event, i) => {
                const label = `${event.title}${
                  event.attendees.length > 0 ? ` (${event.attendees.join(", ")})` : ""
                }${event.location ? ` — ${event.location}` : ""}`;
                return size.stack ? (
                  <div key={i} className={`pl-2 flex flex-col ${size.event}`}>
                    <span className="font-medium">{label}</span>
                    <span className="text-black/60">{event.time_label}</span>
                  </div>
                ) : (
                  <div key={i} className={`pl-2 flex justify-between gap-2 ${size.event}`}>
                    <span className="font-medium truncate">{label}</span>
                    <span className="text-black/60 whitespace-nowrap">{event.time_label}</span>
                  </div>
                );
              })
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
