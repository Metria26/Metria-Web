import {
  CalendarCheck,
  CalendarDays,
  GraduationCap,
  LayoutDashboard,
  MessageSquare,
  UserRound,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  key: "dashboard" | "courses" | "bookings" | "calendar" | "messages" | "profile";
  href: string;
  icon: LucideIcon;
};

/** Compact desktop sidebar: full navigation (design-system.md L11). */
export const sidebarNav: NavItem[] = [
  { key: "dashboard", href: "/app", icon: LayoutDashboard },
  { key: "courses", href: "/app/offerings", icon: GraduationCap },
  { key: "bookings", href: "/app/bookings", icon: CalendarCheck },
  { key: "calendar", href: "/app/calendar", icon: CalendarDays },
  { key: "messages", href: "/app/messages", icon: MessageSquare },
  { key: "profile", href: "/app/profile", icon: UserRound },
];

/** Persistent mobile bottom nav for core student flows (design-system.md L11). */
export const bottomNav: NavItem[] = [
  { key: "dashboard", href: "/app", icon: LayoutDashboard },
  { key: "courses", href: "/app/offerings", icon: GraduationCap },
  { key: "bookings", href: "/app/bookings", icon: CalendarCheck },
  { key: "calendar", href: "/app/calendar", icon: CalendarDays },
  { key: "messages", href: "/app/messages", icon: MessageSquare },
  { key: "profile", href: "/app/profile", icon: UserRound },
];
