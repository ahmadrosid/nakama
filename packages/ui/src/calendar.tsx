import {
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
} from "hugeicons-react";
import type { ComponentProps } from "react";
import { useEffect, useRef } from "react";
import {
  type DayButton,
  DayPicker,
  getDefaultClassNames,
} from "react-day-picker";
import { Button } from "./button";
import { buttonVariants } from "./button-variants";
import { cn } from "./utils";

type CalendarChevronProps = {
  className?: string;
  orientation?: "down" | "left" | "right" | "up";
};

function CalendarChevron({
  className,
  orientation = "down",
}: CalendarChevronProps) {
  const Icon =
    orientation === "left"
      ? ArrowLeft01Icon
      : orientation === "right"
        ? ArrowRight01Icon
        : ArrowDown01Icon;
  return <Icon className={cn("size-4", className)} />;
}

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: ComponentProps<typeof DayPicker>) {
  const defaultClassNames = getDefaultClassNames();
  return (
    <DayPicker
      {...props}
      className={cn(
        "group/calendar bg-background p-3 [--cell-size:2rem]",
        className
      )}
      classNames={{
        button_next: cn(
          buttonVariants({ size: "icon", variant: "ghost" }),
          "size-8 aria-disabled:opacity-50",
          defaultClassNames.button_next
        ),
        button_previous: cn(
          buttonVariants({ size: "icon", variant: "ghost" }),
          "size-8 aria-disabled:opacity-50",
          defaultClassNames.button_previous
        ),
        caption_label: cn(
          "select-none font-medium text-sm",
          defaultClassNames.caption_label
        ),
        day: cn(
          "group/day relative aspect-square h-full w-full select-none p-0 text-center",
          defaultClassNames.day
        ),
        disabled: cn(
          "text-muted-foreground opacity-50",
          defaultClassNames.disabled
        ),
        hidden: cn("invisible", defaultClassNames.hidden),
        month: cn("flex w-full flex-col gap-4", defaultClassNames.month),
        month_caption: cn(
          "flex h-8 w-full items-center justify-center px-8",
          defaultClassNames.month_caption
        ),
        month_grid: cn("w-full border-collapse", defaultClassNames.month_grid),
        months: cn("relative flex flex-col gap-4", defaultClassNames.months),
        nav: cn(
          "absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1",
          defaultClassNames.nav
        ),
        outside: cn(
          "text-muted-foreground aria-selected:text-muted-foreground",
          defaultClassNames.outside
        ),
        root: cn("w-fit", defaultClassNames.root),
        today: cn(
          "rounded-md bg-accent text-accent-foreground data-[selected=true]:rounded-none",
          defaultClassNames.today
        ),
        week: cn("mt-2 flex w-full", defaultClassNames.week),
        weekday: cn(
          "flex-1 select-none rounded-md font-normal text-[0.8rem] text-muted-foreground",
          defaultClassNames.weekday
        ),
        weekdays: cn("flex", defaultClassNames.weekdays),
        ...classNames,
      }}
      components={{
        Chevron: CalendarChevron,
        DayButton: CalendarDayButton,
      }}
      showOutsideDays={showOutsideDays}
    />
  );
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  ...props
}: ComponentProps<typeof DayButton>) {
  const defaultClassNames = getDefaultClassNames();
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (modifiers.focused) {
      ref.current?.focus();
    }
  }, [modifiers.focused]);

  return (
    <Button
      className={cn(
        "flex aspect-square h-auto w-full min-w-[--cell-size] font-normal data-[selected-single=true]:bg-primary data-[selected-single=true]:text-primary-foreground",
        defaultClassNames.day,
        className
      )}
      data-day={day.date.toLocaleDateString()}
      data-selected-single={modifiers.selected}
      ref={ref}
      size="icon"
      variant="ghost"
      {...props}
    />
  );
}

export { Calendar, CalendarDayButton };
