/** Manual activation: keys move focus; the caller activates on click/Enter/Space. */
export type Tab = "context" | "code" | "outline";

export interface TabControl {
  tab: Tab;
  id: string;
  setHidden(hidden: boolean): void;
  setSelected(selected: boolean): void;
  setTabIndex(index: number): void;
  focus(): void;
}

export function createTabs(controls: readonly TabControl[], labelPanel: (id: string) => void) {
  let visible = controls.map((control) => control.tab);
  let selected: Tab = visible[0];

  function tabStop(tab: Tab): void {
    for (const control of controls) control.setTabIndex(control.tab === tab ? 0 : -1);
  }

  function select(tab: Tab): void {
    if (!visible.includes(tab)) return;
    selected = tab;
    for (const control of controls) control.setSelected(control.tab === tab);
    tabStop(tab);
    labelPanel(controls.find((control) => control.tab === tab)!.id);
  }

  return {
    select,
    resetTabStop: () => tabStop(selected),
    configure(allowed?: readonly Tab[], preferred?: Tab, firstLoad = false, focused?: Tab): Tab {
      visible = controls.filter((control) => !allowed || allowed.includes(control.tab)).map((control) => control.tab);
      // Even a malformed empty metadata list must leave a usable selected tab.
      if (!visible.length) visible = [controls[0].tab];
      for (const control of controls) control.setHidden(!visible.includes(control.tab));
      const next = firstLoad && preferred && visible.includes(preferred)
        ? preferred : visible.includes(selected) ? selected
          : preferred && visible.includes(preferred) ? preferred : visible[0];
      select(next);
      if (focused && !visible.includes(focused)) controls.find((control) => control.tab === next)!.focus();
      return next;
    },
    key(tab: Tab, key: string): boolean {
      const index = visible.indexOf(tab);
      if (index < 0) return false;
      let next: Tab;
      switch (key) {
        case "ArrowLeft": next = visible[(index + visible.length - 1) % visible.length]; break;
        case "ArrowRight": next = visible[(index + 1) % visible.length]; break;
        case "Home": next = visible[0]; break;
        case "End": next = visible[visible.length - 1]; break;
        default: return false;
      }
      tabStop(next);
      controls.find((control) => control.tab === next)!.focus();
      return true;
    },
  };
}
