import {
  BookOpen,
  Brain,
  Calendar,
  Check,
  ClipboardList,
  FileText,
  FlaskConical,
  Gauge,
  Languages,
  LayoutGrid,
  Library,
  Lock,
  MessageCircle,
  MessageSquare,
  NotebookPen,
  Search,
  Sparkles,
  UserRound,
  Wrench,
} from "@lucide/vue";
import type { Component } from "vue";

/** Icon names used in the kiosk's YAML content (screens, services, journeys). Unknown names show none. */
const ICONS: Record<string, Component> = {
  "book-open": BookOpen,
  brain: Brain,
  calendar: Calendar,
  check: Check,
  "clipboard-list": ClipboardList,
  "file-text": FileText,
  "flask-conical": FlaskConical,
  gauge: Gauge,
  languages: Languages,
  "layout-grid": LayoutGrid,
  library: Library,
  lock: Lock,
  "message-circle": MessageCircle,
  "message-square": MessageSquare,
  notebook: NotebookPen,
  search: Search,
  sparkles: Sparkles,
  "user-round": UserRound,
  wrench: Wrench,
};

export const iconFor = (name?: string): Component | null => (name ? (ICONS[name] ?? null) : null);
