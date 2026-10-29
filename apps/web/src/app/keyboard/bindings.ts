import { NAV_ITEMS, SETTINGS_ITEM } from "../shell/navItems";
import type { KeyBinding } from "./sequence";

export interface ShortcutDoc {
  readonly keys: readonly string[];
  readonly joiner: "plus" | "then";
  readonly label: string;
}

/** Every global binding: the Oracle, the shortcuts sheet and "g <key>" navigation. */
export const GLOBAL_BINDINGS: readonly KeyBinding[] = [
  { id: "oracle", keys: "mod+k" },
  { id: "oracle", keys: "/" },
  { id: "shortcuts", keys: "?" },
  ...[...NAV_ITEMS, SETTINGS_ITEM].filter((item) => item.keys).map((item) => ({ id: `go:${item.href}`, keys: item.keys! })),
];

/** What the "?" sheet lists. */
export const SHORTCUT_DOCS: readonly ShortcutDoc[] = [
  { keys: ["mod", "K"], joiner: "plus", label: "Speak your intent (the Oracle)" },
  { keys: ["/"], joiner: "plus", label: "Open the Oracle" },
  { keys: ["?"], joiner: "plus", label: "Show these shortcuts" },
  { keys: ["Esc"], joiner: "plus", label: "Close a dialog or sheet" },
  ...[...NAV_ITEMS, SETTINGS_ITEM]
    .filter((item) => item.keys)
    .map((item) => ({ keys: item.keys!.split(" ").map((key) => key.toUpperCase()), joiner: "then" as const, label: `Go to ${item.label}` })),
];
