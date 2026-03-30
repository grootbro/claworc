import type { AttachmentRequest } from "@maxhub/max-bot-api/types";
import { reduceInteractiveReply } from "openclaw/plugin-sdk/interactive-runtime";
import type {
  InteractiveButtonStyle,
  InteractiveReply,
} from "openclaw/plugin-sdk/interactive-runtime";

const MAX_INTERACTIVE_ROW_SIZE = 3;

function resolveMaxButtonIntent(
  style?: InteractiveButtonStyle,
): "default" | "positive" | "negative" | undefined {
  if (style === "danger") {
    return "negative";
  }
  if (style === "primary" || style === "success") {
    return "positive";
  }
  return undefined;
}

export function buildMaxInteractiveAttachments(
  interactive?: InteractiveReply,
): AttachmentRequest[] | undefined {
  const buttons = reduceInteractiveReply(
    interactive,
    [] as Array<Array<{ type: "callback"; text: string; payload: string; intent?: "default" | "positive" | "negative" }>>,
    (state, block) => {
      if (block.type === "buttons") {
        for (let index = 0; index < block.buttons.length; index += MAX_INTERACTIVE_ROW_SIZE) {
          const row = block.buttons
            .slice(index, index + MAX_INTERACTIVE_ROW_SIZE)
            .map((button) => {
              const text = button.label.trim();
              const payload = button.value.trim();
              if (!text || !payload) {
                return null;
              }
              return {
                type: "callback" as const,
                text,
                payload,
                intent: resolveMaxButtonIntent(button.style),
              };
            })
            .filter(
              (
                button,
              ): button is {
                type: "callback";
                text: string;
                payload: string;
                intent?: "default" | "positive" | "negative";
              } => Boolean(button),
            );
          if (row.length > 0) {
            state.push(row);
          }
        }
        return state;
      }

      if (block.type === "select") {
        for (let index = 0; index < block.options.length; index += MAX_INTERACTIVE_ROW_SIZE) {
          const row = block.options
            .slice(index, index + MAX_INTERACTIVE_ROW_SIZE)
            .map((option) => {
              const text = option.label.trim();
              const payload = option.value.trim();
              if (!text || !payload) {
                return null;
              }
              return {
                type: "callback" as const,
                text,
                payload,
              };
            })
            .filter(
              (
                button,
              ): button is {
                type: "callback";
                text: string;
                payload: string;
              } => Boolean(button),
            );
          if (row.length > 0) {
            state.push(row);
          }
        }
      }

      return state;
    },
  );

  return buttons.length > 0
    ? [
        {
          type: "inline_keyboard",
          payload: { buttons },
        },
      ]
    : undefined;
}
