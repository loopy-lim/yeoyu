export interface ProductCommand {
  id: string;
  title: string;
  keywords?: string;
}

export function matchingCommands(
  query: string,
  commands: ProductCommand[]
): ProductCommand[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return commands
    .filter((command) => {
      const text = `${command.title} ${command.keywords ?? ""}`.toLowerCase();
      return words.every((word) => text.includes(word));
    })
    .slice(0, 5);
}

const labels: Record<string, Omit<ProductCommand, "id">> = {
  "tab.new": { title: "New tab", keywords: "open search" },
  "private.newTab": { title: "New private tab", keywords: "incognito" },
  "tab.close": { title: "Close tab" },
  "tab.reopen": { title: "Reopen closed tab", keywords: "restore undo" },
  "tab.next": { title: "Next tab" },
  "tab.prev": { title: "Previous tab" },
  "location.focus": { title: "Edit address", keywords: "url location" },
  "commandPalette.open": { title: "Search commands" },
  "history.open": { title: "Open history", keywords: "visited" },
  "find.open": { title: "Find in page", keywords: "search text" },
  "browser.copyUrl": { title: "Copy page link", keywords: "url share" },
  "browser.back": { title: "Go back" },
  "browser.forward": { title: "Go forward" },
  "browser.reload": { title: "Reload page", keywords: "refresh" },
  "sidebar.toggle": { title: "Show or hide sidebar" },
  "favorites.toggle": {
    title: "Add or remove Favorite",
    keywords: "save global",
  },
  "pins.toggle": { title: "Pin or unpin tab", keywords: "save bookmark space" },
  "tab.reset": {
    title: "Back to saved page",
    keywords: "reset pinned favorite",
  },
  "browser.split": { title: "Open Split View", keywords: "side by side" },
  "browser.split.close": { title: "Close Split View", keywords: "unsplit" },
  "browser.focusPane.1": { title: "Focus first pane" },
  "browser.focusPane.2": { title: "Focus second pane" },
  "space.manage": { title: "Manage Spaces" },
  "settings.open": { title: "Open settings" },
};

/** Native routes stable IDs; product surfaces expose human-readable commands. */
export class CommandRegistry {
  private commands = new Map<string, () => void>();
  register(id: string, handler: () => void) {
    this.commands.set(id, handler);
  }
  execute(id: string) {
    const handler = this.commands.get(id);
    if (!handler) return false;
    handler();
    return true;
  }
  names() {
    return [...this.commands.keys()];
  }
  entries(): ProductCommand[] {
    return this.names().flatMap((id) => {
      if (id === "favorites.addCurrent") return [];
      const entry = labels[id];
      if (entry) return [{ id, ...entry }];
      const position = /^tab\.activate\.(\d+)$/.exec(id);
      return position ? [{ id, title: `Go to tab ${position[1]}` }] : [];
    });
  }
}
