import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Custom text-* sizes share a prefix with semantic foreground colors. Register
// them as font sizes so replacing one does not remove the other.
const merge = extendTailwindMerge({
  extend: {
    theme: {
      text: [
        "micro",
        "small",
        "body",
        "body-plus",
        "input",
        "input-plus",
        "icon-size",
        "title",
      ],
      spacing: [
        "hairline",
        "xs",
        "sm",
        "md",
        "lg",
        "xl",
        "xxl",
        "xxxl",
        "frame",
        "sidebar",
        "rail",
        "row",
        "tab-row",
        "workspace-row",
        "rail-item",
        "tile",
        "favorite",
        "icon-button",
        "avatar",
        "toolbar",
        "address",
        "address-compact",
        "input",
        "action-row",
        "bookmark-row",
      ],
    },
    classGroups: {
      "border-w": [{ border: ["hairline-width"] }],
      "border-w-b": [{ "border-b": ["hairline-width"] }],
      "border-w-t": [{ "border-t": ["hairline-width"] }],
      "border-w-l": [{ "border-l": ["hairline-width"] }],
      "border-w-r": [{ "border-r": ["hairline-width"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
