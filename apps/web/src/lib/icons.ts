import {
  Brain,
  ClipboardList,
  FileText,
  FlaskConical,
  Gauge,
  Languages,
  LayoutGrid,
  Library,
  MessageCircle,
  MessageSquare,
  NotebookPen,
  Search,
  UserRound,
  Wrench,
} from "@lucide/vue";
import type { Component } from "vue";

/** Icon names used in the kiosk's YAML content (screens, services, journeys). Unknown names show none. */
const ICONS: Record<string, Component> = {
  brain: Brain,
  "clipboard-list": ClipboardList,
  "file-text": FileText,
  "flask-conical": FlaskConical,
  gauge: Gauge,
  languages: Languages,
  "layout-grid": LayoutGrid,
  library: Library,
  "message-circle": MessageCircle,
  "message-square": MessageSquare,
  notebook: NotebookPen,
  search: Search,
  "user-round": UserRound,
  wrench: Wrench,
};

export const iconFor = (name?: string): Component | null => (name ? (ICONS[name] ?? null) : null);
