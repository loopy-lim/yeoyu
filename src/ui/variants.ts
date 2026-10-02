import { cva, type VariantProps } from "class-variance-authority";

export const controlVariants = cva(
  "items-center justify-center rounded-control",
  {
    variants: {
      size: {
        icon: "size-icon-button",
        compact: "h-address px-lg",
        input: "h-input px-xxl",
        action: "h-action-row px-xxl",
      },
      tone: {
        ghost: "bg-transparent",
        sunken: "bg-sunken",
        raised: "bg-white border border-tile-border",
        accent: "bg-accent-strong",
      },
      disabled: { true: "opacity-disabled", false: "" },
      pressed: { true: "opacity-pressed", false: "" },
    },
    defaultVariants: {
      size: "icon",
      tone: "ghost",
      disabled: false,
      pressed: false,
    },
  }
);

export const textVariants = cva("", {
  variants: {
    size: {
      micro: "text-micro",
      small: "text-small",
      body: "text-body",
      bodyPlus: "text-body-plus",
      input: "text-input",
      inputPlus: "text-input-plus",
      icon: "text-icon-size",
      title: "text-title",
    },
    tone: {
      ink: "text-ink",
      muted: "text-ink-muted",
      faint: "text-ink-faint",
      icon: "text-icon",
      accent: "text-accent-strong",
      notice: "text-notice-ink",
      error: "text-error-ink",
    },
    weight: {
      normal: "font-normal",
      medium: "font-medium",
      semibold: "font-semibold",
      bold: "font-bold",
    },
  },
  defaultVariants: { size: "body", tone: "ink" },
});

export const rowVariants = cva("flex-row items-center", {
  variants: {
    density: {
      compact: "h-workspace-row",
      default: "h-row",
      tab: "h-tab-row",
      action: "min-h-action-row",
      bookmark: "min-h-bookmark-row",
    },
    selected: { true: "bg-pill", false: "bg-transparent" },
    disabled: { true: "opacity-disabled", false: "" },
  },
  defaultVariants: { density: "default", selected: false, disabled: false },
});

export type ControlVariants = VariantProps<typeof controlVariants>;
export type TextVariants = VariantProps<typeof textVariants>;
export type RowVariants = VariantProps<typeof rowVariants>;
