import { useFetch } from "~lib/use-fetch";
import { useInputs } from "~lib/use-inputs";

type WidgetEvent = {
  readonly title: string;
  readonly location: string | null;
  readonly time_label: string;
  readonly attendees: readonly string[];
};

type WidgetGridDay = {
  readonly date: string;
  readonly weekday: string;
  readonly in_month: boolean;
  readonly is_today: boolean;
  readonly events: readonly WidgetEvent[];
};

type GridResponse = {
  readonly timezone: string;
  readonly view: "week" | "month";
  readonly weeks: readonly (readonly WidgetGridDay[])[];
};

const shortTime = (label: string) => label.split(" – ")[0];

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .map((word) => word[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

// Sized for a 13in e-ink frame read from ~5ft away, not a phone screen. Week view gets
// one row of 7 cells (lots of vertical room per day) so it carries full detail; month
// view gets 5-6 rows of 7 cells (very little room per day) so it's deliberately trimmed
// to time + title, with attendee presence shown as dots rather than names. There's no
// good way to know the frame's actual physical DPI from here, so these are a starting
// point — nudge TEXT_SIZE up or down once you can see it on the real frame.
const WEEK_SIZES = {
  Normal: { header: "text-sm", dayNum: "text-xl", time: "text-xs", title: "text-sm", meta: "text-xs", chip: "text-[10px]" },
  Large: { header: "text-base", dayNum: "text-2xl", time: "text-sm", title: "text-base", meta: "text-sm", chip: "text-xs" },
  "Extra Large": { header: "text-lg", dayNum: "text-3xl", time: "text-base", title: "text-lg", meta: "text-base", chip: "text-sm" },
} as const;

const MONTH_SIZES = {
  Normal: { header: "text-sm", dayNum: "text-base", event: "text-xs" },
  Large: { header: "text-base", dayNum: "text-lg", event: "text-sm" },
  "Extra Large": { header: "text-lg", dayNum: "text-xl", event: "text-base" },
} as const;

export const Widget = () => {
  // VIEW: Public Select input — "Week" or "Month". TEXT_SIZE: Public Select input —
  // "Normal", "Large", or "Extra Large". API_BASE_URL: Public String. API_TOKEN:
  // Private String — a FamilyHub device token created at /devices.
  const { VIEW, TEXT_SIZE, API_BASE_URL, API_TOKEN } = useInputs();

  const view = VIEW === "Month" ? "month" : "week";
  const weekSize = WEEK_SIZES[TEXT_SIZE as keyof typeof WEEK_SIZES] ?? WEEK_SIZES.Normal;
  const monthSize = MONTH_SIZES[TEXT_SIZE as keyof typeof MONTH_SIZES] ?? MONTH_SIZES.Normal;
  // Week cards are multi-line (time/title/location/attendees) so fewer fit than month's
  // single-line entries. Tuned against visible leftover space in the live frame, not a
  // measured layout — nudge further if a column still has dead space or starts clipping.
  const maxPerCell = view === "week" ? 5 : 6;
  // Strips a trailing slash so a base URL like ".../railway.app/" doesn't turn into
  // a double-slash path that 404s.
  const url = `${(API_BASE_URL ?? "").replace(/\/+$/, "")}/api/widget/grid?view=${view}`;

  const { data } = useFetch<GridResponse>(url, {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
  });

  // useFetch doesn't suspend, so `data` is undefined while loading. If the request
  // fails (bad/missing token, wrong API_BASE_URL, etc.) the backend's JSON error body
  // shows up here instead — truthy, but with no `weeks` — so check the shape, not
  // just truthiness, and surface whatever the backend said instead of crashing.
  if (!data || !Array.isArray((data as GridResponse | { detail?: string }).weeks)) {
    return (
      <div className="size-full flex items-center justify-center bg-white p-4">
        <span className="text-lg text-black/50 text-center">
          {data ? `Couldn't load the calendar: ${(data as { detail?: string }).detail ?? "unexpected response"}` : "Loading…"}
        </span>
      </div>
    );
  }

  return (
    <div className="size-full flex flex-col bg-white text-black p-2 gap-1">
      <div className="grid grid-cols-7 gap-1 border-b-2 border-black pb-1 mb-1">
        {data.weeks[0].map((day) => (
          <div key={day.weekday} className={`${weekSize.header} font-semibold text-center text-black/70`}>
            {view === "week" && day.is_today ? "Today" : day.weekday}
          </div>
        ))}
      </div>
      <div className="flex-1 flex flex-col gap-1">
        {data.weeks.map((week, wi) => (
          <div key={wi} className="flex-1 grid grid-cols-7 gap-1">
            {week.map((day) => {
              const shown = day.events.slice(0, maxPerCell);
              const hidden = day.events.length - shown.length;
              return (
                <div
                  key={day.date}
                  className={`flex flex-col border border-black/30 p-1.5 overflow-hidden ${
                    day.in_month ? "" : "opacity-40"
                  }`}
                >
                  <span
                    className={`${
                      view === "week" ? weekSize.dayNum : monthSize.dayNum
                    } font-semibold self-start size-7 flex items-center justify-center rounded-full shrink-0 ${
                      day.is_today ? "bg-black text-white" : ""
                    }`}
                  >
                    {Number(day.date.slice(-2))}
                  </span>

                  {view === "week" ? (
                    <div className="flex flex-col gap-2 mt-1.5 overflow-hidden">
                      {shown.map((event, i) => (
                        <div key={i} className="flex flex-col border-t border-black/10 pt-1.5">
                          {event.time_label !== "All day" && (
                            <span className={`${weekSize.time} text-black/50`}>{shortTime(event.time_label)}</span>
                          )}
                          <span className={`${weekSize.title} font-semibold leading-tight line-clamp-2`}>
                            {event.title}
                          </span>
                          {event.location && (
                            <span className={`${weekSize.meta} text-black/60 truncate`}>{event.location}</span>
                          )}
                          {event.attendees.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-0.5">
                              {event.attendees.map((name) => (
                                <span
                                  key={name}
                                  className={`${weekSize.chip} font-medium border border-black/40 rounded-full px-1.5 leading-[1.6]`}
                                >
                                  {initials(name)}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                      {hidden > 0 && <span className={`${weekSize.meta} text-black/50`}>+{hidden} more</span>}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-0.5 mt-0.5 overflow-hidden">
                      {shown.map((event, i) => (
                        <div key={i} className={`${monthSize.event} leading-tight`}>
                          <div className="truncate">
                            {event.time_label !== "All day" && (
                              <span className="text-black/50">{shortTime(event.time_label)} </span>
                            )}
                            <span className="font-medium">{event.title}</span>
                          </div>
                          {event.attendees.length > 0 && (
                            <div className="flex items-center gap-0.5 mt-0.5">
                              {event.attendees.slice(0, 4).map((name, ai) => (
                                <span key={ai} className="size-1.5 rounded-full bg-black/70 shrink-0" />
                              ))}
                              {event.attendees.length > 4 && (
                                <span className="text-black/50 leading-none">+{event.attendees.length - 4}</span>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                      {hidden > 0 && <div className={`${monthSize.event} text-black/50`}>+{hidden} more</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};
