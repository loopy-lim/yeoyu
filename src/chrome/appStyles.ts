// Static chrome roles compile through Uniwind. ScopedVariables supplies each
// root/Space palette; geometry and Animated values stay at their native hosts.
export const appClasses = {
  app: "flex-1 bg-chrome",
  body: "flex-1 flex-row",
  sidebar: "w-sidebar bg-transparent rounded-card overflow-hidden",
  sidebarCollapsed: "w-rail",
  sidebarLayer: "absolute inset-0",
  sidebarLayerExpanded: "flex-col px-xl pt-lg pb-md",
  sidebarLayerRail: "flex-col px-sm pt-lg pb-md",
  sidebarResizeHandle:
    "absolute top-0 bottom-0 right-0 w-[12px] items-center justify-center",
  sidebarResizeGrip: "w-[2px] h-[24px] rounded-[2px] bg-hairline-on-chrome opacity-40",
  sidebarTop: "gap-md",
  navigationRow: "flex-row items-center gap-[2px]",
  navSpacer: "flex-1",
  identityRow: "flex-row items-center gap-xs",
  identityRowCollapsed: "justify-center",
  hidden: "hidden",
  iconButton:
    "w-icon-button h-icon-button rounded-[8px] items-center justify-center active:bg-field-on-chrome",
  icon: "text-icon text-icon-size font-semibold",
  pressed: "opacity-pressed",
  disabled: "opacity-disabled",
  favoritesDropTarget: "min-h-[4px]",
  favoritesScroll: "grow-0 max-h-[164px]",
  favorites: "flex-row flex-wrap gap-[6px] pt-xs pb-xs",
  favorite:
    "h-favorite rounded-[10px] items-center justify-center bg-field-on-chrome border border-transparent",
  favoriteActive: "bg-pill border-transparent shadow-favorite-active",
  favoriteIcon: "w-[22px] h-[22px] items-center justify-center",
  favoriteInitial: "text-ink-muted text-body font-bold",
  separator: "h-hairline my-md bg-hairline-on-chrome",
  tabScroll: "flex-1",
  tabScrollWrap: "flex-1",
  tabScrollContent: "pb-md gap-[2px]",
  workspaceCount: "text-ink-faint text-micro font-semibold",
  persistentSection: "gap-[2px] pb-xs",
  ordinarySection: "min-h-[40px]",
  spaceHeader: "min-h-[32px] px-md gap-sm flex-row items-center rounded-[8px] mb-[2px]",
  spaceHeaderTitle:
    "flex-1 text-ink-faint text-[11px] font-semibold tracking-[0.4px]",
  rowPressed: "bg-field-on-chrome",
  tabSelected: "bg-pill border border-transparent",
  tabClose: "w-[26px] h-[26px] justify-center items-center rounded-[6px]",
  sectionRule: "h-hairline bg-hairline-on-chrome mx-sm my-sm",
  privateSection: "mt-sm",
  privateHeader: "min-h-[30px] pl-md pr-xs gap-sm flex-row items-center mb-xs",
  privateHeaderText: "flex-1 text-ink-faint text-small font-medium",
  privateNewTab:
    "w-[28px] h-[28px] justify-center items-center rounded-[7px]",
  privateBadge:
    "flex-row items-center gap-xs px-sm h-[26px] rounded-[8px] bg-field-on-chrome border border-transparent",
  privateBadgeText: "text-ink text-small font-semibold",
  tab: "h-tab-row pl-md pr-xs rounded-[8px] overflow-hidden flex-row items-center gap-sm",
  tabDrag: "flex-1 h-tab-row flex-row items-center gap-md",
  tabFavicon:
    "w-[18px] h-[18px] items-center justify-center",
  tabFaviconText: "text-ink-muted text-micro",
  tabTitle: "flex-1 text-ink text-body font-normal",
  newTab: "h-tab-row px-md rounded-[8px] flex-row items-center gap-md",
  newTabText: "text-ink-muted text-body font-medium",
  button: "py-lg px-xl rounded-control bg-sunken",
  buttonText: "text-ink-muted text-body font-semibold",
  sidebarBottom: "flex-row items-center gap-xs pt-sm",
  sidebarBottomCollapsed: "flex-col items-center gap-xs pt-xs",
  spaceRailScroll: "flex-1",
  spaceRail: "flex-row items-center justify-center grow",
  spaceChip: "w-[24px] h-[24px] rounded-full items-center justify-center border border-transparent",
  spaceChipActive: "bg-pill border-transparent",
  spaceIndicator: "hidden",
  bookmarkTreeRow:
    "h-tab-row px-md rounded-[8px] flex-row items-center gap-md",
  bookmarkTreeActive: "bg-pill border border-transparent",
  bookmarkTreeIndent: "pl-lg",
  folderChildren: "ml-[16px] pl-xs border-l-hairline-width border-l-hairline-on-chrome mb-xs gap-[2px]",
  emptyFolder: "px-xl py-sm text-ink-faint text-body",
  bookmarkDisclosure: "w-[10px] text-ink-faint text-micro font-bold",
  profileInitial: "text-white text-body font-extrabold",
  chevron: "text-ink-faint text-icon-size",
  content:
    "flex-1 ml-sm border border-transparent rounded-card overflow-hidden bg-surface shadow-mini",
  contentFullscreen: "ml-0 border-0 rounded-none",
  contentLittleArc:
    "absolute z-[2] ml-0 rounded-dialog border border-card-border shadow-dialog overflow-hidden bg-surface",
  paneFullscreen: "border-0",
  canvasToolbar:
    "h-toolbar px-xxl flex-row items-center border-b-hairline-width border-b-hairline bg-surface-elevated",
  littleArcToolbar:
    "h-toolbar px-lg gap-lg flex-row items-center border-b-hairline-width border-b-hairline bg-surface-elevated",
  // h-[32px] is explicit: the h-control token does not exist in size (only
  // radius), so the class silently no-ops and the button hugs its content
  // (~20dp). 32dp matches IconButton height inside the 44dp toolbar;
  // hitSlop in App.tsx widens the target horizontally — vertically the
  // toolbar row caps it at 44dp.
  littleArcPromoteButton:
    "h-[32px] px-lg rounded-control bg-accent-strong flex-row items-center gap-xs border border-accent-strong active:opacity-90",
  compactNavigation: "flex-1 flex-row items-center gap-md",
  // Phone compact chrome (issue #19): the toolbar row docks at the screen
  // bottom, mirroring canvasToolbar with the hairline on its top edge. The
  // 48dp rail stays for tab/favorites/settings access.
  phoneBottomBar:
    "h-toolbar px-lg gap-sm flex-row items-center border-t-hairline-width border-t-hairline bg-surface-elevated",
  tabSwipeOverlay:
    "absolute inset-0 items-center justify-center z-[5]",
  tabSwipeBadge:
    "flex-row items-center gap-xs px-lg h-[30px] max-w-[72%] rounded-control bg-surface-elevated border border-hairline shadow-mini",
  tabSwipeBadgeReady: "bg-sunken-strong border-accent-strong",
  tabSwipeBadgeLabel: "text-ink text-small font-semibold",
  phoneHybridTabs: "flex-1",
  phoneHybridTabsContent: "flex-row items-center gap-sm pl-sm pr-md",
  phoneHybridTab:
    "h-[40px] min-w-[44px] max-w-[128px] px-md rounded-control flex-row items-center gap-sm border border-transparent active:opacity-pressed",
  phoneHybridTabActive: "bg-pill border-hairline-on-chrome",
  phoneHybridTabLabel: "text-ink text-small font-semibold",
  panes: "flex-1 flex-row bg-canvas",
  panesVertical: "flex-col",
  pane: "flex-1 basis-0 bg-white border border-transparent overflow-hidden",
  paneFocused: "border-pane-focus",
  paneHeader:
    "h-row px-xl flex-row items-center gap-lg bg-sunken border-b-hairline-width border-b-hairline",
  paneHeaderFocused: "bg-sunken-strong",
  paneHeaderTitle: "flex-1 text-ink-muted text-small font-semibold",
  paneDragHint: "text-ink-faint text-body-plus",
  divider: "w-[10px] -mx-sm z-[3] items-center justify-center bg-transparent",
  dividerVertical: "w-full h-[10px] mx-0 -my-sm",
  dividerHandle: "w-[2px] h-row rounded-[2px] bg-accent",
  dividerHandleVertical: "w-row h-[2px]",
  dropPreview:
    "absolute z-[8] border-[2px] border-drop-border rounded-tile bg-drop-fill",
  dropLeft: "left-lg top-lg bottom-lg w-[48%]",
  dropRight: "right-lg top-lg bottom-lg w-[48%]",
  dropTop: "left-lg right-lg top-lg h-[47%]",
  dropBottom: "left-lg right-lg bottom-lg h-[47%]",
  dragGhost:
    "absolute z-[50] w-[144px] h-[40px] px-xxl justify-center rounded-field bg-ghost shadow-drag-ghost",
  dragGhostText: "text-ink-muted text-small font-bold",
  surface: "flex-1",
  paneContent: "flex-1",
  findOverlay: "absolute inset-0 z-[30]",
  newTabOverlay: "absolute inset-0 items-center justify-center bg-surface",
  newTabPanel: "w-full max-w-[460px] px-xxl items-center gap-xxxl",
  newTabHeading:
    "self-start text-ink-faint text-small font-bold tracking-[0.8px] uppercase",
  newTabGrid: "flex-row flex-wrap gap-xxl",
  newTabTile: "w-[80px] items-center gap-md",
  newTabTileIcon:
    "w-[48px] h-[48px] rounded-tile items-center justify-center bg-sunken border border-hairline",
  newTabTileLabel: "text-ink-muted text-small font-semibold",
  newTabHint: "text-ink-faint text-body text-center",
  quickOpenDialog: "w-[90%] max-w-[560px] gap-xl",
  quickOpenRow: "flex-row gap-xl py-sm",
  quickOpenTile: "w-[86px] items-center gap-sm",
  quickOpenTileIcon:
    "w-[40px] h-[40px] rounded-field items-center justify-center bg-sunken border border-hairline",
  quickOpenTileLabel: "text-ink-muted text-small font-semibold",
  quickOpenHint: "text-ink-faint text-body",
  railContent: "items-center gap-[3px] pb-lg",
  railHeader: "items-center gap-[3px]",
  railItem: "size-[36px] rounded-[9px] items-center justify-center border border-transparent",
  railIcon:
    "size-[20px] items-center justify-center",
  railInitial: "text-ink-muted text-small font-extrabold",
  railTabActive: "bg-pill border-transparent",
  railSeparator: "w-[24px] h-hairline my-xs bg-hairline-on-chrome",
  minis: "absolute right-xxxl bottom-xxxl gap-lg",
  mini: "w-[310px] h-[208px] bg-surface-elevated rounded-tile overflow-hidden border border-card-border shadow-mini",
  miniHeader:
    "h-[36px] pl-xxl pr-sm flex-row items-center bg-white border-b-hairline-width border-b-hairline",
  miniTitle: "flex-1 text-ink-muted text-small font-semibold",
  dialogTitle: "text-ink text-title font-bold",
  dialogHelp: "text-ink-muted text-body leading-xxxl",
  dialogScroll: "grow-0 overflow-hidden",
  bookmarkDialog: "max-w-[560px] max-h-[84%]",
  bookmarkForm: "gap-lg",
  bookmarkActions: "flex-row gap-md",
  bookmarkList: "max-h-[230px]",
  bookmarkRow:
    "min-h-bookmark-row flex-row items-center pl-xl pr-sm border-b-hairline-width border-b-hairline",
  bookmarkCopy: "flex-1 mr-sm",
  folderRow: "flex-1 flex-row items-center gap-lg",
  folderIcon: "text-icon-size",
  dialogHeadingCopy: "flex-1",
  settingsSection: "mt-xxl mb-sm px-xs text-ink-faint text-small font-bold tracking-[0.6px] uppercase",
  optionRow: "flex-row gap-lg",
  appearanceOption:
    "flex-1 p-lg border border-hairline rounded-tile bg-surface-elevated gap-md",
  appearanceOptionSelected: "border-accent-strong bg-sunken-strong",
  appearanceSwatch:
    "h-[36px] rounded-control border-[5px] border-surface-elevated",
  optionTitle: "text-ink text-input-plus leading-[22px] font-semibold",
  optionDescription: "text-ink-muted text-body leading-[19px] mt-xs",
  settingsAction:
    "min-h-[52px] px-xxl py-lg flex-row items-center justify-between flex-wrap gap-lg",
  settingsToggle:
    "min-h-[52px] px-xxl py-lg flex-row items-center justify-between flex-wrap gap-lg",
  settingsToggleCopy: "flex-1 min-w-[120px] mr-lg",
  consentPage: "gap-xl",
  consentChoices: "flex-row flex-wrap gap-md mt-lg",
  consentChoice:
    "min-h-[44px] max-w-full px-xxl py-md flex-row items-center gap-md bg-surface-elevated border border-hairline rounded-control",
  consentChoiceSelected: "border-accent-strong bg-sunken-strong",
  consentIntro: "flex-row items-start gap-xl p-xxl rounded-tile bg-sunken border border-hairline",
  consentCopy: "flex-1 min-w-[120px]",
  consentGroup:
    "mt-md border border-hairline bg-sunken rounded-tile overflow-hidden",
  consentRow:
    "min-h-[52px] flex-row flex-wrap items-center gap-lg py-lg px-xxl border-b-hairline-width border-b-hairline",
  consentButton:
    "min-h-[42px] px-xxl py-md max-w-full justify-center rounded-control bg-surface-elevated border border-hairline active:opacity-pressed",
  consentStatus: "text-ink-muted text-input leading-[20px] mt-sm font-semibold",
  consentOrigin:
    "text-ink text-input-plus leading-[21px] font-semibold bg-sunken p-lg border-b-hairline-width border-b-hairline",
  consentDetails: "px-xxl py-lg gap-lg",
  consentNotice:
    "text-ink bg-sunken p-xxl rounded-tile border border-hairline text-input-plus leading-[21px]",
  consentError:
    "text-error-ink bg-error-bg p-xxl rounded-tile text-input-plus leading-[21px]",
  stepperRow: "flex-row items-center gap-sm",
  stepperValue: "text-ink text-body-plus font-bold min-w-[48px] text-center",
  commandInput:
    "h-input px-xxl rounded-field text-ink bg-surface-elevated border border-hairline text-input-plus",
  keymapInput:
    "h-[170px] p-xxl rounded-field text-ink bg-surface-elevated border border-hairline text-body [text-align-vertical:top]",
  error: "px-xxl py-lg rounded-control text-error-ink bg-error-bg",
  noticeBanner:
    "absolute top-xxxl self-center z-[60] px-xxl py-lg rounded-tile bg-notice-bg shadow-mini",
  noticeText: "text-notice-ink text-body font-semibold",
} as const;
