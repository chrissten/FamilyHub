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

export const Widget = () => {
  // RANGE, API_BASE_URL: Public Inputs. API_TOKEN: Private Input — a FamilyHub
  // device token created at /devices. See blotch-widget/README.md for exact setup.
  const { RANGE, API_BASE_URL, API_TOKEN } = useInputs();

  const days = RANGE === "Next Week" ? 7 : 3;
  const url = `${API_BASE_URL}/api/widget/events?days=${days}`;

  // NOTE: assumes useFetch's second argument accepts fetch-style { headers }.
  // Check the Designer's autocomplete for useFetch's real signature if this errors.
  const { data } = useFetch<EventsResponse>(url, {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
  });

  return (
    <div className="size-full flex flex-col bg-white text-black p-4 gap-2">
      <div className="flex-1 flex flex-col gap-2 overflow-hidden">
        {data.days.map((day) => (
          <div key={day.date} className="flex flex-col border-t border-black/30 pt-1">
            <span className="text-lg font-semibold">{day.label}</span>
            {day.events.length === 0 ? (
              <span className="text-sm text-black/50 pl-2">No events</span>
            ) : (
              day.events.map((event, i) => (
                <div key={i} className="pl-2 flex justify-between gap-2 text-sm">
                  <span className="font-medium truncate">
                    {event.title}
                    {event.attendees.length > 0 ? ` (${event.attendees.join(", ")})` : ""}
                    {event.location ? ` — ${event.location}` : ""}
                  </span>
                  <span className="text-black/60 whitespace-nowrap">{event.time_label}</span>
                </div>
              ))
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
