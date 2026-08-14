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

const WEEKDAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const shortTime = (label: string) => label.split(" – ")[0];

export const Widget = () => {
  // VIEW: Public Select input — "Week" or "Month". API_BASE_URL: Public String.
  // API_TOKEN: Private String — a FamilyHub device token created at /devices.
  const { VIEW, API_BASE_URL, API_TOKEN } = useInputs();

  const view = VIEW === "Month" ? "month" : "week";
  const maxPerCell = view === "month" ? 3 : 6;
  const url = `${API_BASE_URL}/api/widget/grid?view=${view}`;

  const { data } = useFetch<GridResponse>(url, {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
  });

  if (!data) {
    return (
      <div className="size-full flex items-center justify-center bg-white">
        <span className="text-lg text-black/50">Loading…</span>
      </div>
    );
  }

  return (
    <div className="size-full flex flex-col bg-white text-black p-2 gap-1">
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAY_HEADERS.map((label) => (
          <div key={label} className="text-xs font-semibold text-center text-black/60">
            {label}
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
                  className={`flex flex-col border border-black/20 p-1 overflow-hidden ${
                    day.in_month ? "" : "opacity-40"
                  }`}
                >
                  <span
                    className={`text-xs font-semibold self-start px-1 rounded ${
                      day.is_today ? "bg-black text-white" : ""
                    }`}
                  >
                    {Number(day.date.slice(-2))}
                  </span>
                  <div className="flex flex-col gap-0.5 mt-0.5 overflow-hidden">
                    {shown.map((event, i) => (
                      <div key={i} className="text-[10px] leading-tight truncate">
                        {view === "week" && event.time_label !== "All day" && (
                          <span className="text-black/50">{shortTime(event.time_label)} </span>
                        )}
                        <span className="font-medium">{event.title}</span>
                      </div>
                    ))}
                    {hidden > 0 && <div className="text-[10px] text-black/50">+{hidden} more</div>}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};
