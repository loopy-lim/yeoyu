import React from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/ui/cn";

export const dialogCardVariants = cva("bg-surface-elevated", {
  variants: {
    variant: {
      dialog:
        "w-[92%] max-w-[520px] max-h-[80%] p-xxxl rounded-dialog gap-lg border border-hairline shadow-dialog",
      compact:
        "w-[90%] max-w-[480px] max-h-[78%] p-xxxl rounded-dialog gap-lg border border-hairline shadow-dialog",
      wide:
        "w-[94%] max-w-[1040px] max-h-[94%] rounded-dialog border border-hairline overflow-hidden",
      editor: "w-[92%] max-w-[760px] max-h-[88%] rounded-card p-[20px] gap-xxl",
      sheet:
        "max-h-[62%] p-xxxl gap-lg rounded-tile border-t-hairline-width border-t-hairline shadow-dialog",
      modal:
        "w-full max-w-[480px] max-h-[80%] rounded-dialog p-[18px] border border-hairline shadow-dialog",
      appDialog:
        "w-[90%] max-w-[620px] max-h-[78%] p-xxxl rounded-dialog gap-lg border border-hairline shadow-dialog",
    },
  },
  defaultVariants: {
    variant: "dialog",
  },
});

export type DialogCardVariant = NonNullable<
  VariantProps<typeof dialogCardVariants>["variant"]
>;

/**
 * Shared modal surface card: consolidates surface elevation, border/shadow
 * tokens, responsive width/height caps, and modal accessibility isolation.
 */
export function DialogCard({
  variant = "dialog",
  modal = true,
  className,
  style,
  children,
}: {
  variant?: DialogCardVariant;
  modal?: boolean;
  className?: string;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  return (
    <View
      accessibilityViewIsModal={modal}
      className={cn(dialogCardVariants({ variant }), className)}
      style={style}
    >
      {children}
    </View>
  );
}
